import http from 'node:http';
import { parse } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { generateInvoicePdf } from './invoicePdf.js';
import { formatSmtpError, resolveSmtpSettings, sendInvoiceEmail, validateSmtpSettings } from './emailService.js';
import { apDocuments, arDocuments, branchMaster, creditTerms, customers, glAccounts, itemMaster, journalEntries, vendors, salesOrders, salesOrderLines, shipments, shipmentLines, salesOrderInvoices, inventoryAllocations, salesOrderStatusHistory } from './data/seed.js';

const publicDir = path.resolve('public');
const paymentApplications = [];
const inventoryTransactions = [];
const periodModules = ['AR','AP','GL','Inventory'];
const financialPeriods = [];
const periodHistory = [];
const invoiceEmailHistory = [];
const runtimeEmailSettings = {};
let applicationSeq = 1;
const json=(res,c,d)=>{res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(d));};
const isAuthenticated=(req)=>/erp_session=admin/.test(String(req.headers.cookie||''));
const requireAuthenticated=(req)=>{ if(!isAuthenticated(req)) throw new Error('Authentication required'); };
const body=(req)=>new Promise((resolve,reject)=>{let r='';req.on('data',c=>r+=c);req.on('end',()=>{try{resolve(r?JSON.parse(r):{});}catch{reject(new Error('Invalid JSON'));}});req.on('error',reject);});
const POSTING_ACCOUNTS={arCash:'1079',apCash:'1084',accountsReceivable:'1210',accountsPayable:'2020',returnsAllowances:'4070',bankFees:'6060',defaultSalesRevenue:'4008'};
const PLACEHOLDER_ACCOUNTS=new Set(['Cash','AR','AP','Revenue','Expense','1000','1100','2010','4000','4050','5000']);
const acct=(code)=>glAccounts.find(a=>a.code===String(code));
const accountLabel=(code)=>{const a=acct(code); return a?`${a.code} - ${a.name}`:String(code||'');};
function requireAccount(code,context='Posting account'){
  const accountCode=String(code||'').trim();
  if(!accountCode) throw new Error(`${context} is required`);
  if(PLACEHOLDER_ACCOUNTS.has(accountCode)) throw new Error(`${context} ${accountCode} is a placeholder account. Select an imported Chart of Accounts account.`);
  const a=acct(accountCode);
  if(!a||a.active===false) throw new Error(`${context} ${accountCode} does not exist in the imported Chart of Accounts`);
  return accountCode;
}
const bump=(code,side,amt)=>{const accountCode=requireAccount(code); const a=acct(accountCode); const value=Number(amt||0); if(!value)return; if(side==='Debit'){a.debits=Number(a.debits||0)+value; a.balance=Number(a.balance||0)+value;} if(side==='Credit'){a.credits=Number(a.credits||0)+value; a.balance=Number(a.balance||0)-value;}};
const nextJeNumber=(prefix='JE')=>`${prefix}${String(journalEntries.length+1).padStart(6,'0')}`;
function createPostedJournal({module,description,postPeriod,transactionDate,sourceRef,lines,createdBy='system',reversalOf='',reclassOf='',auditTrail=[]}){
  const normalized=(lines||[]).map(l=>({account:requireAccount(l.account||l.a,'Posting account'),debit:Number(l.debit??l.dr??0),credit:Number(l.credit??l.cr??0),sourceReference:l.sourceReference||sourceRef||'',description:l.description||'',branch:l.branch||'100',branchName:l.branchName||'Chicago HQ'})).filter(l=>l.debit||l.credit);
  const dr=normalized.reduce((s,l)=>s+l.debit,0); const cr=normalized.reduce((s,l)=>s+l.credit,0);
  if(!normalized.length) throw new Error('Journal entry must have at least one line');
  if(Math.round((dr-cr)*100)!==0) throw new Error(`Journal entry is out of balance: debits ${dr} credits ${cr}`);
  normalized.forEach(l=>{ if(l.debit)bump(l.account,'Debit',l.debit); if(l.credit)bump(l.account,'Credit',l.credit); });
  const jeNumber=nextJeNumber();
  journalEntries.push({jeNumber,batchNumber:`BATCH-${String(journalEntries.length+1).padStart(6,'0')}`,module,description,financialPeriod:postPeriod,postPeriod,transactionDate,status:'Posted',sourceRef,createdBy,createdDate:new Date().toISOString(),reversalOf,reclassOf,auditTrail,lines:normalized});
  return jeNumber;
}
function postedReclassCandidates(filters={}){
  const account=String(filters.account||'').trim(); const accountTo=String(filters.accountTo||'').trim(); const from=String(filters.fromPeriod||'').trim(); const to=String(filters.toPeriod||'').trim(); const sourceJe=String(filters.sourceJe||'').trim(); const sourceRef=String(filters.sourceReference||filters.sourceRef||'').trim();
  return journalEntries.filter(j=>j.status==='Posted'&&(!sourceJe||j.jeNumber===sourceJe)&&(!sourceRef||j.sourceRef===sourceRef||(j.lines||[]).some(l=>l.sourceReference===sourceRef))&&(!from||(j.postPeriod||j.financialPeriod)>=from)&&(!to||(j.postPeriod||j.financialPeriod)<=to)).flatMap(j=>(j.lines||[]).map((l,i)=>{ const amount=Number(l.debit||0)||Number(l.credit||0); return {id:`${j.jeNumber}:${i}`,lineIndex:i,checked:false,jeReference:j.jeNumber,sourceModule:j.module,sourceReference:j.sourceRef||l.sourceReference||'',period:j.postPeriod||j.financialPeriod,account:l.account,accountName:accountLabel(l.account),accountTo,accountToName:accountTo?accountLabel(accountTo):'',debit:Number(l.debit||0),credit:Number(l.credit||0),amount,description:l.description||j.description||'',branch:l.branch||'100',branchName:l.branchName||'Chicago HQ'}; })).filter(r=>r.amount&&(!account||r.account===account));
}
function processReclassification({toPeriod,transactionDate,lines=[]}){
  const pp=toPeriod||periodFromDate(transactionDate); validatePeriodOpen('GL',pp);
  const selected=(lines||[]).filter(l=>l.checked!==false);
  if(!selected.length) throw new Error('Select at least one line to process');
  const groups=new Map();
  for(const l of selected){
    const key=l.originalId||l.id||`${l.jeReference}:${l.lineIndex}`; const amt=Number(l.amount||0); if(amt<=0) throw new Error('Split amount must be positive');
    const accountTo=requireAccount(l.accountTo,'Account To');
    const source=postedReclassCandidates({sourceJe:l.jeReference}).find(r=>r.id===key); if(!source) throw new Error(`Source line ${key} was not found`);
    if(accountTo===source.account) throw new Error('Account To must be different from Original Account');
    if(!groups.has(key)) groups.set(key,{source,splits:[]}); groups.get(key).splits.push({...l,amount:amt,accountTo});
  }
  const jeLines=[]; const auditTrail=[];
  for(const [key,g] of groups){
    const total=g.splits.reduce((t,l)=>t+Number(l.amount||0),0); if(Math.round((total-g.source.amount)*100)!==0) throw new Error(`Split total for ${g.source.jeReference} must equal original line amount ${g.source.amount}`);
    for(const split of g.splits){
      const isDebit=Number(g.source.debit||0)>0;
      jeLines.push({account:g.source.account,debit:isDebit?0:split.amount,credit:isDebit?split.amount:0,sourceReference:g.source.sourceReference||g.source.jeReference,branch:g.source.branch,branchName:g.source.branchName,description:`Reclass from ${g.source.jeReference}`});
      jeLines.push({account:split.accountTo,debit:isDebit?split.amount:0,credit:isDebit?0:split.amount,sourceReference:g.source.sourceReference||g.source.jeReference,branch:g.source.branch,branchName:g.source.branchName,description:`Reclass to ${split.accountTo}`});
      auditTrail.push({sourceJe:g.source.jeReference,sourceLine:g.source.lineIndex,sourceReference:g.source.sourceReference,originalAccount:g.source.account,accountTo:split.accountTo,amount:split.amount,periodFrom:g.source.period,periodTo:pp});
    }
  }
  const dr=jeLines.reduce((t,l)=>t+Number(l.debit||0),0), cr=jeLines.reduce((t,l)=>t+Number(l.credit||0),0); if(Math.round((dr-cr)*100)!==0) throw new Error('Reclassification debits and credits must balance');
  const sourceRefs=[...new Set(auditTrail.map(a=>a.sourceJe))]; const jeNumber=createPostedJournal({module:'GL',description:`Reclassification of ${sourceRefs.join(', ')}`,postPeriod:pp,transactionDate:transactionDate||`${pp}-01`,sourceRef:sourceRefs[0]||'RECLASS',lines:jeLines,createdBy:'admin',reclassOf:sourceRefs.join(','),auditTrail});
  for(const ref of sourceRefs){ const orig=journalEntries.find(j=>j.jeNumber===ref); if(orig){ orig.reclassifications=orig.reclassifications||[]; orig.reclassifications.push({jeNumber,createdDate:new Date().toISOString(),lines:auditTrail.filter(a=>a.sourceJe===ref)}); } }
  return journalEntries.find(j=>j.jeNumber===jeNumber);
}
function sourceAccountFromLine(line,keys,defaultAccount){
  for(const key of keys){ if(line?.[key]) return line[key]; }
  const item=itemMaster.find(i=>i.code===(line?.itemCode||line?.item));
  for(const key of keys){ if(item?.[key]) return item[key]; }
  return defaultAccount;
}
const nextId=(prefix)=>`${prefix}-${String(arDocuments.filter(d=>d.id.startsWith(prefix+'-')).length+1001).padStart(4,'0')}`;
const toNumber=(v)=>Number(v||0);

const monthName=(periodId)=>new Date(`${periodId}-01T00:00:00`).toLocaleString('en-US',{month:'long',year:'numeric'});
const periodStart=(periodId)=>`${periodId}-01`;
const periodEnd=(periodId)=>{const [y,m]=periodId.split('-').map(Number); return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};
const periodFromDate=(date)=>String(date||new Date().toISOString().slice(0,10)).slice(0,7);
function serializePeriod(p){ const overall=periodModules.some(m=>p[`${m.toLowerCase()}Status`]==='Open')?'Open':'Closed'; return {...p,overallStatus:overall}; }
function ensurePeriod(periodId){
  if(!/^\d{4}-\d{2}$/.test(String(periodId||''))) throw new Error('Period ID must use YYYY-MM format');
  let p=financialPeriods.find(x=>x.periodId===periodId);
  if(!p){ p={financialYear:periodId.slice(0,4),periodId,periodDescription:monthName(periodId),startDate:periodStart(periodId),endDate:periodEnd(periodId),arStatus:'Open',apStatus:'Open',glStatus:'Open',inventoryStatus:'Open',closedBy:'',closedDate:''}; financialPeriods.push(p); financialPeriods.sort((a,b)=>a.periodId.localeCompare(b.periodId)); }
  return p;
}
function seedFinancialPeriods(){ for(let m=1;m<=12;m++) ensurePeriod(`2026-${String(m).padStart(2,'0')}`); }
seedFinancialPeriods();
function periodModuleField(module){ return `${String(module).toLowerCase()}Status`; }
function periodStatus(periodId,module){ return ensurePeriod(periodId)[periodModuleField(module)]; }
function validatePeriodOpen(module,postPeriod,message='Posting is not allowed.'){ if(!periodModules.includes(module)) throw new Error('Valid module required'); const periodId=postPeriod||new Date().toISOString().slice(0,7); if(periodStatus(periodId,module)==='Closed') throw new Error(`${module} period ${periodId} is closed. ${message}`); return true; }
const assertPeriodOpen=validatePeriodOpen;
const validateReversalPeriodOpen=(module,postPeriod)=>validatePeriodOpen(module,postPeriod,'Reversal cannot be posted.');
const validatePeriodOpenForSave=(module,postPeriod)=>validatePeriodOpen(module,postPeriod,'Save is not allowed.');
function validateSourceAndGlOpen(module,postPeriod){ validatePeriodOpen(module,postPeriod); if(module!=='GL') validatePeriodOpen('GL',postPeriod); }
function validateReversalSourceAndGlOpen(module,postPeriod){ validateReversalPeriodOpen(module,postPeriod); if(module!=='GL') validateReversalPeriodOpen('GL',postPeriod); }
function auditPeriod(periodId,module,action,previousStatus,newStatus,notes=''){ periodHistory.unshift({periodId,module,action,previousStatus,newStatus,user:'admin',dateTime:new Date().toISOString(),notes}); }
const linkFor=(module,id)=>module==='AR'?`/ar/doc/${id}`:module==='AP'?`/ap/bills/${id}`:module==='GL'?`/finance/journal/${id}`:`/inventory/transactions/${id}`;
function closeBlockers(periodId,module){
  const inPeriod=(d)=>periodFromDate(d.postDate||d.date||d.transactionDate||d.applicationDate||d.createdDate)===periodId;
  if(module==='AR') return [
    ...arDocuments.filter(d=>['Invoice','Credit Memo','Debit Memo','Payment'].includes(d.type)&&inPeriod(d)&&(!d.posted||d.status==='Saved')).map(d=>({module:'AR',id:d.id,type:d.type,status:d.status,description:d.customerName||'',href:linkFor('AR',d.id)})),
    ...paymentApplications.filter(a=>periodFromDate(a.applicationDate)===periodId&&a.status==='Saved').map(a=>({module:'AR',id:a.applicationId,type:'Application',status:a.status,description:`${a.paymentId} -> ${a.appliedDocumentId}`,href:linkFor('AR',a.paymentId)}))
  ];
  if(module==='AP') return apDocuments.filter(d=>['Bill','Debit Adjustment','Credit Adjustment','Payment'].includes(d.type)&&inPeriod(d)&&(!d.posted||d.status==='Saved')).map(d=>({module:'AP',id:d.id,type:d.type,status:d.status,description:d.vendorName||'',href:linkFor('AP',d.id)}));
  if(module==='GL') return journalEntries.flatMap(j=>{ const out=[]; const dr=(j.lines||[]).reduce((s,l)=>s+Number(l.debit||0),0), cr=(j.lines||[]).reduce((s,l)=>s+Number(l.credit||0),0); if(j.financialPeriod===periodId&&j.status!=='Posted') out.push({module:'GL',id:j.jeNumber,type:'Journal Entry',status:j.status,description:j.description||'Unposted journal entry',href:linkFor('GL',j.jeNumber)}); if(j.financialPeriod===periodId&&j.status==='Posted'&&dr!==cr) out.push({module:'GL',id:j.jeNumber,type:'Journal Entry',status:'Out of Balance',description:`Debits ${dr} Credits ${cr}`,href:linkFor('GL',j.jeNumber)}); return out; });
  if(module==='Inventory') return inventoryTransactions.filter(t=>periodFromDate(t.date)===periodId&&t.status!=='Released').map(t=>({module:'Inventory',id:t.id,type:t.type,status:t.status,description:t.description||'',href:linkFor('Inventory',t.id)}));
  return [];
}
function changePeriodStatus(periodId,module,newStatus,action,notes=''){
  const p=ensurePeriod(periodId); const f=periodModuleField(module); const prev=p[f]; p[f]=newStatus;
  if(periodModules.every(m=>p[periodModuleField(m)]==='Closed')){ p.closedBy='admin'; p.closedDate=new Date().toISOString(); }
  if(newStatus==='Open'){ p.closedBy=''; p.closedDate=''; }
  auditPeriod(periodId,module,action,prev,newStatus,notes); return serializePeriod(p);
}



function savedEmailSettings(){
  const settings=resolveSmtpSettings(runtimeEmailSettings);
  return {smtpHost:settings.SMTP_HOST||'',smtpPort:settings.SMTP_PORT||'',smtpUser:settings.SMTP_USER||'',fromEmail:settings.SMTP_FROM||settings.SMTP_USER||'',hasPassword:Boolean(settings.SMTP_PASS),configured:Boolean(settings.SMTP_HOST&&settings.SMTP_PORT&&settings.SMTP_USER&&settings.SMTP_PASS),gmailWarning:'Gmail requires App Passwords when 2FA is enabled.'};
}
function updateRuntimeEmailSettings(input={}){
  if('smtpHost' in input || 'SMTP_HOST' in input) runtimeEmailSettings.SMTP_HOST=input.smtpHost??input.SMTP_HOST??'';
  if('smtpPort' in input || 'SMTP_PORT' in input) runtimeEmailSettings.SMTP_PORT=input.smtpPort??input.SMTP_PORT??'';
  if('smtpUser' in input || 'SMTP_USER' in input) runtimeEmailSettings.SMTP_USER=input.smtpUser??input.SMTP_USER??'';
  if('smtpPass' in input || 'SMTP_PASS' in input){ const pass=input.smtpPass??input.SMTP_PASS??''; if(pass) runtimeEmailSettings.SMTP_PASS=pass; }
  if('fromEmail' in input || 'SMTP_FROM' in input) runtimeEmailSettings.SMTP_FROM=input.fromEmail??input.SMTP_FROM??'';
  return resolveSmtpSettings(runtimeEmailSettings);
}

const companyName=()=>process.env.COMPANY_NAME||'Company';
function emailHistoryFor(invoiceId){ const h=invoiceEmailHistory.filter(x=>x.invoiceNumber===invoiceId).at(-1); return h?{lastSentDate:h.sentDate,emailStatus:h.emailStatus}:{}; }
async function sendArInvoices({invoiceIds=[]},req){
  requireAuthenticated(req);
  const ids=[...new Set((invoiceIds||[]).map(String).filter(Boolean))]; const results=[];
  if(!ids.length) throw new Error('Select at least one invoice to send');
  const now=new Date().toISOString(); const sentBy='admin'; const failures=[]; const groups=new Map();
  for(const id of ids){
    const invoice=arDocuments.find(d=>d.id===id&&['Invoice','Credit Memo','Debit Memo'].includes(d.type));
    if(!invoice){ const row={invoiceNumber:id,customer:'',customerEmail:'',sentDate:now,sentBy,emailStatus:'Failed',errorMessage:`Invoice ${id} was not found`,attachmentName:''}; results.push(row); failures.push(row); continue; }
    const customer=customers.find(c=>c.id===invoice.customerId);
    if(!customer?.email){ const row={invoiceNumber:invoice.id,customer:invoice.customerName||customer?.name||'',customerEmail:'',sentDate:now,sentBy,emailStatus:'Failed',errorMessage:`Customer email is missing for invoice ${invoice.id}.`,attachmentName:`Invoice-${invoice.id}.pdf`}; invoiceEmailHistory.push(row); results.push(row); failures.push(row); continue; }
    const key=customer.id||customer.email; if(!groups.has(key)) groups.set(key,{customer,email:customer.email,invoices:[]}); groups.get(key).invoices.push(invoice);
  }
  let sent=0;
  for(const group of groups.values()){
    const attachments=group.invoices.map(invoice=>({filename:`Invoice-${invoice.id}.pdf`,contentType:'application/pdf',content:generateInvoicePdf({invoice,customer:group.customer,companyName:companyName()})}));
    const invoiceList=group.invoices.map(i=>i.id).join(', ');
    const subject=group.invoices.length===1?`Invoice ${invoiceList} from ${companyName()}`:`Invoices ${invoiceList} from ${companyName()}`;
    const bodyText=group.invoices.length===1?`Hello ${group.customer.name},\n\nPlease find attached invoice ${invoiceList}.\n\nThank you,\n${companyName()}`:`Hello ${group.customer.name},\n\nPlease find attached invoices ${invoiceList}.\n\nThank you,\n${companyName()}`;
    try{
      await sendInvoiceEmail({to:group.email,subject,body:bodyText,attachments,settings:resolveSmtpSettings(runtimeEmailSettings)});
      for(const invoice of group.invoices){ const row={invoiceNumber:invoice.id,customer:invoice.customerName||group.customer.name,customerEmail:group.email,sentDate:now,sentBy,emailStatus:'Sent',errorMessage:'',attachmentName:`Invoice-${invoice.id}.pdf`}; invoiceEmailHistory.push(row); results.push(row); sent++; }
    }catch(e){
      for(const invoice of group.invoices){ const row={invoiceNumber:invoice.id,customer:invoice.customerName||group.customer.name,customerEmail:group.email,sentDate:now,sentBy,emailStatus:'Failed',errorMessage:formatSmtpError(e),attachmentName:`Invoice-${invoice.id}.pdf`}; invoiceEmailHistory.push(row); results.push(row); failures.push(row); }
    }
  }
  const failureDetails=failures.map(f=>`${f.invoiceNumber}: ${f.errorMessage}`).join(' | ');
  return {sent,failed:failures.length,message:`${sent} invoices sent successfully. ${failures.length} failed.${failureDetails?' '+failureDetails:''}`,results};
}
function normalizeArStatus(doc){
  if(!doc) return;
  const old=doc.status;
  if(['Draft','Balanced'].includes(old)) doc.status='Saved';
  if(['Partially Applied'].includes(old)) doc.status='Open';
  if(['Fully Applied','Paid'].includes(old)) doc.status='Closed';
  if(doc.status==='Voided') return;
  if(!doc.posted){ doc.status='Saved'; return; }
  const basis=doc.type==='Payment' ? toNumber(doc.unappliedBalance ?? (toNumber(doc.amount)-toNumber((doc.applications||[]).reduce((s,a)=>s+toNumber(a.amount),0)))) : toNumber(doc.balance ?? doc.amount);
  doc.status=basis===0?'Closed':'Open';
}
const normalizeAllArStatuses=()=>arDocuments.forEach(normalizeArStatus);
function arPostingLines(doc){
  const amt=Number(doc.amount||doc.grandTotal||0); const lines=[];
  if(doc.type==='Invoice'){
    lines.push({account:POSTING_ACCOUNTS.accountsReceivable,debit:amt,credit:0,sourceReference:doc.id});
    const docLines=(doc.lines||[]).length?doc.lines:[{lineTotal:amt}];
    const lineTotal=docLines.reduce((s,l)=>s+Number(l.lineTotal||l.amount||0),0)||amt;
    for(const line of docLines){
      const revenueAccount=requireAccount(sourceAccountFromLine(line,['revenueAccount','salesAccount','incomeAccount','account'],POSTING_ACCOUNTS.defaultSalesRevenue),'AR revenue account');
      const lineAmount=Number(line.lineTotal||line.amount||0)||amt*(Number(lineTotal)?Number(line.lineTotal||line.amount||0)/lineTotal:1);
      if(lineAmount) lines.push({account:revenueAccount,debit:0,credit:lineAmount,sourceReference:doc.id});
    }
  }
  if(doc.type==='Debit Memo') lines.push({account:POSTING_ACCOUNTS.accountsReceivable,debit:amt,credit:0,sourceReference:doc.id},{account:requireAccount(doc.revenueAccount||POSTING_ACCOUNTS.defaultSalesRevenue,'AR debit memo revenue account'),debit:0,credit:amt,sourceReference:doc.id});
  if(doc.type==='Credit Memo') lines.push({account:POSTING_ACCOUNTS.returnsAllowances,debit:amt,credit:0,sourceReference:doc.id},{account:POSTING_ACCOUNTS.accountsReceivable,debit:0,credit:amt,sourceReference:doc.id});
  if(doc.type==='Payment'){
    const cash=Number(doc.amount||0); const fc=Number(doc.financeChargeAmount||0); const wo=Number(doc.writeOffAmount||0);
    lines.push({account:requireAccount(doc.cashAccount||POSTING_ACCOUNTS.arCash,'AR cash account'),debit:cash,credit:0,sourceReference:doc.id});
    if(fc>0) lines.push({account:POSTING_ACCOUNTS.bankFees,debit:fc,credit:0,sourceReference:doc.id});
    if(wo>0) lines.push({account:POSTING_ACCOUNTS.returnsAllowances,debit:wo,credit:0,sourceReference:doc.id});
    lines.push({account:POSTING_ACCOUNTS.accountsReceivable,debit:0,credit:cash+fc+wo,sourceReference:doc.id});
  }
  return lines;
}
function postJE(doc,reverse=false){
  const postDate=doc.postDate||doc.date||new Date().toISOString().slice(0,10); const postPeriod=doc.postPeriod||periodFromDate(postDate); validatePeriodOpen('GL',postPeriod);
  let lines=arPostingLines(doc);
  if(reverse) lines=lines.map(l=>({...l,debit:l.credit,credit:l.debit,sourceReference:doc.id}));
  return createPostedJournal({module:'AR',description:`${reverse?'Reversal of':'Auto from'} ${doc.id}`,postPeriod,transactionDate:postDate,sourceRef:doc.id,lines,reversalOf:reverse?doc.id:''});
}
function apPostingLines(doc){
  const amt=Number(doc.amount||0);
  if(doc.type==='Payment') return [
    {account:POSTING_ACCOUNTS.accountsPayable,debit:amt,credit:0,sourceReference:doc.id},
    {account:requireAccount(String(doc.cashAccount||POSTING_ACCOUNTS.apCash).trim().split(/\s+/)[0],'AP cash account'),debit:0,credit:amt,sourceReference:doc.id}
  ];
  if(doc.type==='Credit Adjustment') return [
    {account:POSTING_ACCOUNTS.accountsPayable,debit:amt,credit:0,sourceReference:doc.id},
    {account:POSTING_ACCOUNTS.returnsAllowances,debit:0,credit:amt,sourceReference:doc.id}
  ];
  const docLines=(doc.lines||[]).length?doc.lines:[{amount:amt,expenseAccount:doc.expenseAccount}];
  const lineTotal=docLines.reduce((s,l)=>s+Number(l.amount||l.lineTotal||0),0)||amt;
  const lines=[];
  for(const line of docLines){
    const expenseAccount=requireAccount(sourceAccountFromLine(line,['expenseAccount','account'],''),'AP bill expense account');
    const lineAmount=Number(line.amount||line.lineTotal||0)||amt*(Number(lineTotal)?Number(line.amount||line.lineTotal||0)/lineTotal:1);
    if(lineAmount) lines.push({account:expenseAccount,debit:lineAmount,credit:0,sourceReference:doc.id});
  }
  lines.push({account:POSTING_ACCOUNTS.accountsPayable,debit:0,credit:amt,sourceReference:doc.id});
  return lines;
}

function syncApPaymentReview(doc){
  if(!doc||doc.type!=='Payment') return doc;
  const applied=(doc.applications||[]).reduce((t,a)=>t+Number(a.amount||a.amountPaid||0),0);
  doc.appliedAmount=applied;
  doc.unappliedBalance=Math.max(0,Number(doc.amount||0)-applied);
  doc.balance=doc.unappliedBalance;
  return doc;
}
function releaseApPaymentApplications(doc,appliedOn=new Date().toISOString().slice(0,10)){
  if(!doc||doc.type!=='Payment') return;
  const apps=(doc.applications||[]).map(a=>({documentId:a.documentId||a.billId,amount:Number(a.amount||a.amountPaid||0)})).filter(a=>a.documentId&&a.amount>0);
  const total=apps.reduce((t,a)=>t+a.amount,0);
  if(total>Number(doc.amount||0)) throw new Error('Applied amount cannot exceed payment amount');
  for(const app of apps){ const b=apDocuments.find(d=>d.id===app.documentId&&['Bill','Credit Adjustment','Debit Adjustment'].includes(d.type)&&d.vendorId===doc.vendorId&&d.status!=='Voided'); if(!b) throw new Error(`Applied document ${app.documentId} is not available`); if(app.amount>Number(b.balance||0)) throw new Error(`Applied amount exceeds open balance for ${app.documentId}`); }
  doc.history=doc.history||[];
  doc.applications=apps.map(app=>{ const b=apDocuments.find(d=>d.id===app.documentId); b.balance=Number(b.balance||0)-app.amount; b.status=b.balance===0?'Closed':'Open'; const hist={reference:`APP-${String(applicationSeq++).padStart(6,'0')}`,appliedDocument:b.id,paymentReference:doc.id,date:appliedOn,amount:app.amount,reversalEntry:'',user:'system'}; doc.history.push(hist); return {billId:b.id,documentId:b.id,amount:app.amount,date:appliedOn,status:'Applied'}; });
  syncApPaymentReview(doc);
}
function postApJE(doc,reverse=false){
  const postDate=doc.postDate||doc.date||new Date().toISOString().slice(0,10); const postPeriod=doc.postPeriod||periodFromDate(postDate); validatePeriodOpen('GL',postPeriod);
  let lines=apPostingLines(doc);
  if(reverse) lines=lines.map(l=>({...l,debit:l.credit,credit:l.debit,sourceReference:doc.id}));
  return createPostedJournal({module:'AP',description:`${reverse?'Reversal of':'Auto from'} ${doc.id}`,postPeriod,transactionDate:postDate,sourceRef:doc.id,lines,reversalOf:reverse?doc.id:''});
}


const SO_STATUSES = ['Draft','Saved','Open','On Hold','Credit Hold','Partially Shipped','Shipped','Partially Invoiced','Invoiced','Closed','Cancelled','Voided'];
const soNextId=(prefix,collection)=>`${prefix}-${String(collection.length+1001).padStart(4,'0')}`;
const customerExposure=(customerId,excludeOrderId='')=>arDocuments.filter(d=>d.customerId===customerId&&['Invoice','Debit Memo'].includes(d.type)&&d.status!=='Voided').reduce((s,d)=>s+Number(d.balance||0),0)+salesOrders.filter(o=>o.customerId===customerId&&o.id!==excludeOrderId&&!['Closed','Cancelled','Voided','Invoiced'].includes(o.status)).reduce((s,o)=>s+Number(o.openBalance||o.orderTotal||0),0);
function addSoHistory(salesOrderId,oldStatus,newStatus,action,note=''){
  if(oldStatus===newStatus&&!action) return;
  salesOrderStatusHistory.unshift({id:`SOH-${String(salesOrderStatusHistory.length+1001).padStart(4,'0')}`,salesOrderId,date:new Date().toISOString(),user:'admin',oldStatus,newStatus,action,note});
}
function enrichCustomer(c){ if(!c) return c; const openArBalance=arDocuments.filter(d=>d.customerId===c.id&&['Invoice','Debit Memo'].includes(d.type)&&d.status!=='Voided').reduce((s,d)=>s+Number(d.balance||0),0); return {...c,creditHold:!!c.creditHold||c.status==='On Hold',openArBalance}; }
function calcSoLine(l,idx=0){ const item=itemMaster.find(i=>i.code===(l.itemId||l.inventoryId||l.itemCode))||{}; const qty=Number(l.qtyOrdered??l.quantityOrdered??l.qty??0); const unitPrice=Number(l.unitPrice??item.salesPrice??0); const ext=qty*unitPrice; const discPct=Number(l.discountPct??l.discountPercent??0); const discountAmount=Number(l.discountAmount??(ext*(discPct/100))); const tax=Number(l.tax||0); const total=ext-discountAmount+tax; return {id:l.id||`SOL-TMP-${idx+1}`,lineNumber:Number(l.lineNumber||idx+1),branch:l.branch||'100',warehouse:l.warehouse||'MAIN',itemId:l.itemId||l.inventoryId||l.itemCode,inventoryId:l.inventoryId||l.itemId||l.itemCode,description:l.description||item.description||item.name||'',qtyOrdered:qty,qtyAllocated:Number(l.qtyAllocated||0),qtyShipped:Number(l.qtyShipped||0),qtyInvoiced:Number(l.qtyInvoiced||0),qtyBackordered:Number(l.qtyBackordered||0),uom:l.uom||item.uom||'EA',unitPrice,discountPct:discPct,discountAmount,tax,extendedPrice:ext,lineTotal:total,revenueAccount:l.revenueAccount||item.revenueAccount||POSTING_ACCOUNTS.defaultSalesRevenue,cogsAccount:l.cogsAccount||item.cogsAccount||'',inventoryAccount:l.inventoryAccount||item.inventoryAccount||'',status:l.status||'Open'}; }
function recalcSo(order){ const lines=salesOrderLines.filter(l=>l.salesOrderId===order.id); order.lineTotal=lines.reduce((s,l)=>s+Number(l.extendedPrice||0),0); order.discountTotal=lines.reduce((s,l)=>s+Number(l.discountAmount||0),0); order.taxTotal=lines.reduce((s,l)=>s+Number(l.tax||0),0); order.freight=Number(order.freight||0); order.orderTotal=order.lineTotal-order.discountTotal+order.taxTotal+order.freight; order.invoicedAmount=salesOrderInvoices.filter(i=>i.salesOrderId===order.id).reduce((s,i)=>s+Number(i.invoiceAmount||0),0); order.openBalance=Math.max(0,order.orderTotal-order.invoicedAmount); order.shippedAmount=lines.reduce((s,l)=>s+Number(l.qtyShipped||0)*Number(l.unitPrice||0),0); return order; }
function allocateSo(order){ for(const l of salesOrderLines.filter(x=>x.salesOrderId===order.id)){ const item=itemMaster.find(i=>i.code===l.itemId); if(!item||item.type!=='Inventory') continue; const open=Math.max(0,Number(l.qtyOrdered||0)-Number(l.qtyShipped||0)); const alreadyOther=salesOrderLines.filter(x=>x.id!==l.id&&x.itemId===l.itemId).reduce((s,x)=>s+Number(x.qtyAllocated||0),0); const available=Math.max(0,Number(item.qtyOnHand||0)-alreadyOther); l.qtyAllocated=Math.min(open,available); l.qtyBackordered=Math.max(0,open-l.qtyAllocated); inventoryAllocations.push({id:`ALLOC-${String(inventoryAllocations.length+1001).padStart(4,'0')}`,salesOrderId:order.id,salesOrderLineId:l.id,itemId:l.itemId,warehouse:l.warehouse,qtyAvailable:available,qtyAllocated:l.qtyAllocated,qtyBackordered:l.qtyBackordered,status:l.qtyBackordered?'Backordered':'Allocated'}); } }
function soCreditCheck(order){ const c=customers.find(x=>x.id===order.customerId); if(!c) return ''; const exposure=customerExposure(c.id,order.id)+Number(order.orderTotal||0); if(c.status==='On Hold'||c.creditHold){ order.status='Credit Hold'; return 'Customer is on credit hold. Order placed on credit hold.'; } if(Number(c.creditLimit||0)>0&&exposure>Number(c.creditLimit)){ order.status='Credit Hold'; return 'Customer exceeds credit limit. Order placed on credit hold.'; } return ''; }
function validateSo(order,lines){ if(!order.customerId) throw new Error('Customer required'); if(!order.orderDate) throw new Error('Order date required'); if(!lines.length) throw new Error('At least one line required'); for(const l of lines){ if(!l.itemId&&!l.inventoryId) throw new Error('Inventory ID required for each line'); if(Number(l.qtyOrdered)<=0) throw new Error('Quantity must be greater than 0'); if(Number(l.unitPrice)<0) throw new Error('Unit price must be greater than or equal to 0'); } }
function serializeSo(order){ recalcSo(order); return {...order,customer:enrichCustomer(customers.find(c=>c.id===order.customerId)),lines:salesOrderLines.filter(l=>l.salesOrderId===order.id),shipments:shipments.filter(s=>s.salesOrderId===order.id).map(s=>({...s,lines:shipmentLines.filter(l=>l.shipmentId===s.id)})),invoices:salesOrderInvoices.filter(i=>i.salesOrderId===order.id),allocations:inventoryAllocations.filter(a=>a.salesOrderId===order.id),statusHistory:salesOrderStatusHistory.filter(h=>h.salesOrderId===order.id)}; }
function setSoStatusFromQty(order){ const lines=salesOrderLines.filter(l=>l.salesOrderId===order.id); const ordered=lines.reduce((s,l)=>s+Number(l.qtyOrdered||0),0), shipped=lines.reduce((s,l)=>s+Number(l.qtyShipped||0),0), invoiced=lines.reduce((s,l)=>s+Number(l.qtyInvoiced||0),0); if(shipped>0&&shipped<ordered) order.status='Partially Shipped'; else if(shipped>=ordered&&ordered>0) order.status='Shipped'; if(invoiced>0&&invoiced<ordered) order.status='Partially Invoiced'; else if(invoiced>=ordered&&ordered>0) order.status=(shipped>=ordered?'Closed':'Invoiced'); }
function createShipmentFromOrder(orderId,payload={}){ const order=salesOrders.find(o=>o.id===orderId||o.orderNumber===orderId); if(!order) throw new Error('Sales order not found'); if(!['Open','Partially Shipped'].includes(order.status)) throw new Error('Order must be Open or Partially Shipped before shipment'); const c=customers.find(x=>x.id===order.customerId); if(order.status==='Credit Hold'||c?.status==='On Hold'||c?.creditHold) throw new Error('Customer cannot be on credit hold'); const id=payload.shipmentNumber||soNextId('SHIP',shipments); const selected=payload.lines?.length?payload.lines:salesOrderLines.filter(l=>l.salesOrderId===order.id&&Number(l.qtyOrdered)>Number(l.qtyShipped)&&itemMaster.find(i=>i.code===l.itemId)?.type==='Inventory').map(l=>({salesOrderLineId:l.id,shippedQty:Math.max(0,Number(l.qtyAllocated||0)||Number(l.qtyOrdered||0)-Number(l.qtyShipped||0))})); if(!selected.length) throw new Error('No shippable inventory quantity exists'); const sh={id,shipmentNumber:id,salesOrderId:order.id,salesOrderNumber:order.orderNumber,customerId:order.customerId,customerName:order.customerName,shipDate:payload.shipDate||new Date().toISOString().slice(0,10),warehouse:payload.warehouse||order.warehouse||'MAIN',shipVia:payload.shipVia||order.shipVia||'',trackingNumber:payload.trackingNumber||'',status:payload.confirm?'Confirmed':'Open',freightAmount:Number(payload.freightAmount||0),jeNumber:''}; shipments.push(sh); for(const x of selected){ const sol=salesOrderLines.find(l=>l.id===x.salesOrderLineId); if(!sol) continue; const open=Number(sol.qtyOrdered||0)-Number(sol.qtyShipped||0); const qty=Number(x.shippedQty||0); if(qty<=0) continue; if(qty>open) throw new Error('Shipped quantity cannot exceed open quantity'); shipmentLines.push({id:`SHL-${String(shipmentLines.length+1001).padStart(4,'0')}`,shipmentId:id,salesOrderId:order.id,salesOrderLineId:sol.id,itemId:sol.itemId,inventoryId:sol.inventoryId,description:sol.description,orderedQty:sol.qtyOrdered,shippedQty:qty,backorderQty:Math.max(0,open-qty),uom:sol.uom,warehouse:sol.warehouse,location:x.location||'MAIN'}); if(payload.confirm){ sol.qtyShipped+=qty; sol.qtyAllocated=Math.max(0,Number(sol.qtyAllocated||0)-qty); sol.qtyBackordered=Math.max(0,Number(sol.qtyOrdered||0)-Number(sol.qtyShipped||0)-Number(sol.qtyAllocated||0)); const item=itemMaster.find(i=>i.code===sol.itemId); if(item?.type==='Inventory') item.qtyOnHand=Math.max(0,Number(item.qtyOnHand||0)-qty); } }
 if(payload.confirm) confirmShipment(sh); return serializeSo(order); }
function confirmShipment(sh){ if(sh.status==='Confirmed'&&sh.jeNumber) return sh; const lines=shipmentLines.filter(l=>l.shipmentId===sh.id); const jeLines=[]; for(const l of lines){ const sol=salesOrderLines.find(x=>x.id===l.salesOrderLineId); const item=itemMaster.find(i=>i.code===l.itemId); if(!item||item.type!=='Inventory') continue; const cogs=requireAccount(sol?.cogsAccount||item.cogsAccount,'COGS account'); const inv=requireAccount(sol?.inventoryAccount||item.inventoryAccount,'Inventory account'); const amt=Number(item.cost||0)*Number(l.shippedQty||0); if(amt){ jeLines.push({account:cogs,debit:amt,credit:0,sourceReference:sh.id,description:`COGS ${sh.id}`}); jeLines.push({account:inv,debit:0,credit:amt,sourceReference:sh.id,description:`Inventory issue ${sh.id}`}); } }
 if(jeLines.length) sh.jeNumber=createPostedJournal({module:'Inventory',description:`Shipment release ${sh.id}`,postPeriod:periodFromDate(sh.shipDate),transactionDate:sh.shipDate,sourceRef:sh.id,lines:jeLines,createdBy:'admin'}); sh.status='Confirmed'; const order=salesOrders.find(o=>o.id===sh.salesOrderId); const old=order.status; for(const l of lines){ const sol=salesOrderLines.find(x=>x.id===l.salesOrderLineId); if(sol&&Number(sol.qtyShipped)<Number(l.shippedQty)) sol.qtyShipped=Number(l.shippedQty); } setSoStatusFromQty(order); addSoHistory(order.id,old,order.status,'Confirm Shipment',`${sh.id} confirmed.`); return sh; }
function prepareSoInvoice(orderId,payload={}){ const order=salesOrders.find(o=>o.id===orderId||o.orderNumber===orderId); if(!order) throw new Error('Sales order not found'); if(order.status==='Credit Hold') throw new Error('Credit-hold orders cannot be invoiced'); const shipmentId=payload.shipmentId; const lines=salesOrderLines.filter(l=>l.salesOrderId===order.id).map(l=>{ const item=itemMaster.find(i=>i.code===l.itemId)||{}; const max=(item.type==='Service'||item.invoiceWithoutShipment)?Number(l.qtyOrdered||0):Number(l.qtyShipped||0); const qty=Math.max(0,max-Number(l.qtyInvoiced||0)); return {source:l,qty,item}; }).filter(x=>x.qty>0); if(!lines.length) throw new Error('Invoiceable quantity must exist'); const invId=payload.invoiceNumber||`INV-SO-${order.orderNumber.replace(/^SO-/,'')}`; if(arDocuments.some(d=>d.id===invId)) throw new Error('Invoice already exists'); const invLines=lines.map(({source,qty,item})=>{ const ext=qty*Number(source.unitPrice||0); source.qtyInvoiced+=qty; return {itemCode:source.itemId,item:source.itemId,description:source.description,qty,unitPrice:source.unitPrice,lineTotal:ext,revenueAccount:source.revenueAccount||item.revenueAccount||POSTING_ACCOUNTS.defaultSalesRevenue,sourceSalesOrderLineId:source.id}; }); const amount=invLines.reduce((s,l)=>s+Number(l.lineTotal||0),0); const inv={id:invId,type:'Invoice',customerId:order.customerId,customerName:order.customerName,date:payload.date||new Date().toISOString().slice(0,10),postDate:payload.postDate||payload.date||new Date().toISOString().slice(0,10),postPeriod:periodFromDate(payload.postDate||payload.date||new Date().toISOString().slice(0,10)),dueDate:order.dueDate,terms:order.terms,status:'Saved',posted:false,createdDate:new Date().toISOString().slice(0,10),amount,balance:amount,lines:invLines,sourceSalesOrderId:order.id,sourceSalesOrderNumber:order.orderNumber,sourceShipmentId:shipmentId||'',customerPO:order.customerPO,salesOrderReference:order.orderNumber,shipmentNumber:shipmentId||'',applications:[]}; arDocuments.push(inv); salesOrderInvoices.push({id:`SOI-${String(salesOrderInvoices.length+1001).padStart(4,'0')}`,salesOrderId:order.id,salesOrderNumber:order.orderNumber,shipmentId:shipmentId||'',invoiceId:inv.id,invoiceNumber:inv.id,invoiceDate:inv.date,invoiceAmount:amount,openBalance:amount,status:inv.status,arReference:inv.id}); const old=order.status; recalcSo(order); setSoStatusFromQty(order); addSoHistory(order.id,old,order.status,'Prepare Invoice',`${inv.id} prepared from sales order.`); return {invoice:inv,salesOrder:serializeSo(order)}; }

async function serve(p,res){ if(p==='/app.js'||p==='/styles.css'){const c=await readFile(path.join(publicDir,p.slice(1)));res.writeHead(200,{'Content-Type':p.endsWith('.css')?'text/css':'application/javascript'});res.end(c);return true;} if(!p.startsWith('/api')){const c=await readFile(path.join(publicDir,'index.html'));res.writeHead(200,{'Content-Type':'text/html'});res.end(c);return true;} return false; }

const server=http.createServer(async(req,res)=>{const {pathname,query}=parse(req.url,true); const method=req.method||'GET'; try{
 if(method==='GET'&&await serve(pathname,res)) return;
 if(method==='POST'&&pathname==='/api/auth/login'){const b=await body(req); if(b.username==='admin'&&b.password==='admin'){res.setHeader('Set-Cookie','erp_session=admin; HttpOnly; SameSite=Lax; Path=/'); return json(res,200,{ok:true});} return json(res,401,{error:'Invalid'});}
 if(method==='GET'&&pathname==='/api/ar/customers') return json(res,200,customers);
 if(method==='GET'&&pathname==='/api/ar/credit-terms') return json(res,200,creditTerms);
 if(method==='POST'&&pathname==='/api/ar/customers'){ const b=await body(req); if(!b.name) return json(res,400,{error:'Customer Name required'}); const next=`CUST-${String(customers.reduce((m,c)=>Math.max(m,Number(String(c.id||'').split('-')[1]||1000)),1000)+1).padStart(4,'0')}`; const id=b.id||next; if(customers.find(c=>c.id===id)) return json(res,400,{error:'Customer ID must be unique'}); const c={id,name:b.name,status:b.status||'Active',billingAddress:b.billingAddress||'',shippingAddress:b.shippingAddress||'',phone:b.phone||'',email:b.email||'',terms:b.terms||'NET30',taxZone:b.taxZone||'DEFAULT',currency:b.currency||'USD',contactPerson:b.contactPerson||''}; customers.push(c); return json(res,201,c); }
 if(method==='PUT'&&pathname.startsWith('/api/ar/customers/')){ const id=pathname.split('/').pop(); const c=customers.find(x=>x.id===id); if(!c) return json(res,404,{error:'Customer not found'}); Object.assign(c,await body(req)); return json(res,200,c); }
 if(method==='DELETE'&&pathname.startsWith('/api/ar/customers/')){ const id=pathname.split('/').pop(); if(arDocuments.some(d=>d.customerId===id)) return json(res,400,{error:'Cannot delete customer with transactions'}); const i=customers.findIndex(c=>c.id===id); if(i<0) return json(res,404,{error:'Customer not found'}); customers.splice(i,1); return json(res,200,{ok:true}); }


 // AP APIs
 if(method==='GET'&&pathname==='/api/ap/vendors') return json(res,200,vendors);
 if(method==='POST'&&pathname==='/api/ap/vendors'){ const b=await body(req); const id=`VEND-${String(vendors.length+1001).padStart(4,'0')}`; const v={id,name:b.name,status:'Active',address:b.address||'',phone:b.phone||'',email:b.email||'',terms:b.terms||'NET30',taxId:b.taxId||'',currency:b.currency||'USD',paymentMethod:b.paymentMethod||'Check'}; vendors.push(v); return json(res,201,v); }
 if(method==='PUT'&&pathname.startsWith('/api/ap/vendors/')){ const id=pathname.split('/').pop(); const v=vendors.find(x=>x.id===id); if(!v) return json(res,404,{error:'Vendor not found'}); Object.assign(v,await body(req)); return json(res,200,v); }
 if(method==='DELETE'&&pathname.startsWith('/api/ap/vendors/')){ const id=pathname.split('/').pop(); if(apDocuments.some(d=>d.vendorId===id)) return json(res,400,{error:'This vendor has transactions and cannot be deleted. Please inactivate the vendor instead.'}); const i=vendors.findIndex(v=>v.id===id); if(i<0) return json(res,404,{error:'Vendor not found'}); vendors.splice(i,1); return json(res,200,{ok:true}); }
 if(method==='GET'&&pathname==='/api/ap/documents'){ let d=[...apDocuments]; if(query.type)d=d.filter(x=>x.type===query.type); if(query.vendorId)d=d.filter(x=>x.vendorId===query.vendorId); if(query.status)d=d.filter(x=>x.status===query.status); return json(res,200,d); }
 if(method==='GET'&&pathname.startsWith('/api/ap/documents/')){ const id=pathname.split('/').pop(); const d=apDocuments.find(x=>x.id===id); return d?json(res,200,d):json(res,404,{error:'Not found'}); }
 if(method==='POST'&&pathname==='/api/ap/documents'){ const b=await body(req); const vendor=vendors.find(v=>v.id===b.vendorId); if(!vendor) return json(res,400,{error:'Vendor required'}); const prefix=b.type==='Payment'?'PAY-AP':b.type==='Debit Adjustment'?'DADJ':'BILL'; const pp=periodFromDate(b.postDate||b.date); validatePeriodOpenForSave('AP',pp); const id=`${prefix}-${String(apDocuments.length+1001).padStart(4,'0')}`; const d={id,type:b.type||'Bill',vendorId:vendor.id,vendorName:vendor.name,date:b.date||new Date().toISOString().slice(0,10),postDate:b.postDate||b.date||new Date().toISOString().slice(0,10),postPeriod:pp,dueDate:b.dueDate||b.date,terms:b.terms||vendor.terms,status:'Saved',posted:false,hold:!!b.hold,amount:Number(b.amount||0),balance:Number(b.amount||0),method:b.method,checkNumber:b.checkNumber,paymentRef:b.paymentRef||'',branch:b.branch||'MAIN',cashAccount:String(b.cashAccount||POSTING_ACCOUNTS.apCash).trim().split(/\s+/)[0],currency:b.currency||'USD',description:b.description||'',unappliedBalance:Number(b.amount||0),appliedAmount:0,applications:b.applications||[],history:b.history||[],lines:b.lines||[]}; syncApPaymentReview(d); apDocuments.push(d); return json(res,201,d); }
 if(method==='PUT'&&pathname.startsWith('/api/ap/documents/')){ const id=pathname.split('/').pop(); const d=apDocuments.find(x=>x.id===id); if(!d) return json(res,404,{error:'Not found'}); if(['Open','Closed','Voided'].includes(d.status)) return json(res,400,{error:'Cannot edit released docs'}); const b=await body(req); delete b.postPeriod; const nextPostDate=b.postDate||b.date||d.postDate||d.date; validatePeriodOpenForSave('AP',periodFromDate(nextPostDate)); Object.assign(d,b); d.postPeriod=periodFromDate(d.postDate||d.date); syncApPaymentReview(d); return json(res,200,d); }
 if(method==='DELETE'&&pathname.startsWith('/api/ap/documents/')){ const id=pathname.split('/').pop(); const i=apDocuments.findIndex(x=>x.id===id); if(i<0) return json(res,404,{error:'Not found'}); if(['Open','Closed','Voided'].includes(apDocuments[i].status)) return json(res,400,{error:'Open/Closed documents cannot be deleted'}); apDocuments.splice(i,1); return json(res,200,{ok:true}); }
 if(method==='POST'&&pathname==='/api/ap/documents/post'){ const {id}=await body(req); const d=apDocuments.find(x=>x.id===id); if(!d) return json(res,404,{error:'Not found'}); const pp=d.postPeriod||periodFromDate(d.postDate||d.date); validateSourceAndGlOpen('AP',pp); if(d.hold) return json(res,400,{error:'Document is on hold and cannot be released'}); if(d.status!=='Saved') return json(res,400,{error:'Only Saved transactions can be posted'}); if(d.type==='Payment') syncApPaymentReview(d); if(d.type==='Payment') releaseApPaymentApplications(d,d.postDate||d.date); postApJE(d,false); d.posted=true; d.status=(d.type==='Payment'&&Number(d.unappliedBalance||0)===0)?'Closed':'Open'; return json(res,200,d); }
 if(method==='POST'&&pathname==='/api/ap/documents/void'){ const {id,reversalDate}=await body(req); const d=apDocuments.find(x=>x.id===id); if(!d) return json(res,404,{error:'Not found'}); const appliedOn=reversalDate||new Date().toISOString().slice(0,10); validateReversalSourceAndGlOpen('AP',periodFromDate(appliedOn)); if(!['Open','Closed'].includes(d.status)) return json(res,400,{error:'Only Open/Closed can be voided'}); const revJe=postApJE({...d,postDate:appliedOn,postPeriod:periodFromDate(appliedOn)},true); if(d.type==='Payment'){ for(const app of d.applications||[]){ const b=apDocuments.find(x=>x.id===(app.billId||app.documentId)); if(b&&b.status!=='Voided'){ b.balance=Number(b.balance||0)+Number(app.amount||0); b.status='Open'; }} d.history=d.history||[]; (d.applications||[]).forEach(a=>d.history.push({reference:`REV-${d.id}`,appliedDocument:a.billId||a.documentId,amount:-Number(a.amount||0),date:appliedOn,reversalEntry:revJe,user:'system'})); } d.status='Voided'; return json(res,200,{document:d,reversalJournalEntry:revJe}); }
 if(method==='POST'&&pathname==='/api/ap/payments/apply'){ const {paymentId,applications=[],applicationDate}=await body(req); const appliedOn=applicationDate||new Date().toISOString().slice(0,10); const p=apDocuments.find(x=>x.id===paymentId&&x.type==='Payment'); if(!p) return json(res,404,{error:'Payment not found'}); validatePeriodOpen('AP',periodFromDate(applicationDate||p.postDate||p.date)); let rem=Number(p.amount||0); p.applications=[]; p.history=p.history||[]; applications.forEach(a=>{const b=apDocuments.find(d=>d.id===a.documentId&&['Bill','Credit Adjustment','Debit Adjustment'].includes(d.type)&&d.vendorId===p.vendorId&&d.status!=='Voided'); const amt=Math.min(Number(a.amount||0),rem,Number(b?.balance||0)); if(b&&amt>0){b.balance-=amt; b.status=b.balance===0?'Closed':'Open'; rem-=amt; p.applications.push({billId:b.id,documentId:b.id,amount:amt,date:new Date().toISOString().slice(0,10),status:'Applied'}); p.history.push({reference:`APP-${String(applicationSeq++).padStart(6,'0')}`,appliedDocument:b.id,paymentReference:p.id,date:new Date().toISOString().slice(0,10),amount:amt,reversalEntry:'',user:'system'});}}); p.appliedAmount=Number(p.amount||0)-rem; p.unappliedBalance=rem; p.status=rem===0?'Closed':'Open'; return json(res,200,p); }
 if(method==='POST'&&pathname==='/api/ap/release/post-selected'){ const {ids=[]}=await body(req); const docs=ids.map(id=>apDocuments.find(x=>x.id===id)).filter(d=>d&&d.status==='Saved'); docs.forEach(d=>validateSourceAndGlOpen('AP',d.postPeriod||periodFromDate(d.postDate||d.date))); let posted=0; for(const d of docs){ d.posted=true; d.status=Number(d.balance||d.unappliedBalance||0)===0?'Closed':'Open'; posted++; } return json(res,200,{posted}); }
 if(method==='GET'&&pathname==='/api/ap/reports/aging'){ const asOf=new Date(query.date||new Date().toISOString().slice(0,10)); const rows=[]; vendors.forEach(v=>{const open=apDocuments.filter(d=>d.vendorId===v.id&&d.type==='Bill'&&d.status!=='Voided'&&Number(d.balance||0)>0); if(!open.length) return; const r={vendorId:v.id,vendorName:v.name,current:0,b1_30:0,b31_60:0,b61_90:0,b90p:0}; open.forEach(b=>{const days=Math.floor((asOf-new Date(b.dueDate||b.date))/86400000); const bal=Number(b.balance||0); if(days<=0) r.current+=bal; else if(days<=30) r.b1_30+=bal; else if(days<=60) r.b31_60+=bal; else if(days<=90) r.b61_90+=bal; else r.b90p+=bal;}); rows.push(r); }); return json(res,200,rows); }


 if(method==='GET'&&pathname==='/api/finance/financial-periods') return json(res,200,financialPeriods.map(serializePeriod));
 if(method==='GET'&&pathname==='/api/finance/financial-period-history') return json(res,200,periodHistory);
 if(method==='GET'&&pathname==='/api/finance/financial-periods/blockers'){ const periodId=query.periodId; const module=query.module; if(!periodModules.includes(module)) return json(res,400,{error:'Module required'}); ensurePeriod(periodId); return json(res,200,{blockers:closeBlockers(periodId,module)}); }
 if(method==='POST'&&pathname==='/api/finance/financial-periods/action'){
   const b=await body(req); const periodId=b.periodId; ensurePeriod(periodId); const modules=b.module==='All'?periodModules:[b.module]; if(modules.some(m=>!periodModules.includes(m))) return json(res,400,{error:'Valid module required'});
   const results=[]; const blockers=[];
   if(b.action==='Close') modules.forEach(m=>blockers.push(...closeBlockers(periodId,m)));
   if(blockers.length) return json(res,409,{error:'Period cannot be closed because blocking documents exist.',blockers});
   for(const m of modules){
     if(b.action==='Close') results.push(changePeriodStatus(periodId,m,'Closed',modules.length>1?'Close All Modules':'Close Period',b.notes||''));
     else if(b.action==='Open') results.push(changePeriodStatus(periodId,m,'Open','Open Period',b.notes||''));
     else if(b.action==='Reopen') results.push(changePeriodStatus(periodId,m,'Open',modules.length>1?'Reopen All Modules':'Reopen Period',b.notes||''));
     else return json(res,400,{error:'Invalid period action'});
   }
   return json(res,200,{period:serializePeriod(ensurePeriod(periodId)),results});
 }

 if(method==='GET'&&pathname==='/api/finance/email-settings'){ if(!isAuthenticated(req)) return json(res,401,{error:'Authentication required'}); return json(res,200,savedEmailSettings()); }
 if(method==='POST'&&pathname==='/api/finance/email-settings'){ if(!isAuthenticated(req)) return json(res,401,{error:'Authentication required'}); const b=await body(req); const settings=updateRuntimeEmailSettings(b); validateSmtpSettings(settings); return json(res,200,savedEmailSettings()); }
 if(method==='POST'&&pathname==='/api/finance/email-settings/test'){ if(!isAuthenticated(req)) return json(res,401,{error:'Authentication required'}); const b=await body(req); if(!b.to) return json(res,400,{error:'Test email address is required'}); const settings=updateRuntimeEmailSettings(b); try{ await sendInvoiceEmail({to:b.to,subject:`Test email from ${companyName()}`,body:`This is a test email from ${companyName()} ERP.\n\nGmail note: use an App Password when 2FA is enabled.`,attachments:[],settings}); return json(res,200,{ok:true,message:`Test email sent to ${b.to}.`,settings:savedEmailSettings()}); }catch(e){ return json(res,400,{error:formatSmtpError(e),settings:savedEmailSettings()}); } }
 if(method==='GET'&&pathname==='/api/finance/branches') return json(res,200,branchMaster);
 if(method==='GET'&&pathname==='/api/finance/chart-of-accounts'){ return json(res,200,glAccounts.map(a=>({accountType:a.accountType||'Asset/Liability',accountNumber:a.code,accountTitle:a.name,normalBalance:a.normal,active:a.active!==false,currentBalance:Number(a.balance||0),debits:Number(a.debits??(Number(a.balance||0)>0?Number(a.balance):0)),credits:Number(a.credits??(Number(a.balance||0)<0?Math.abs(Number(a.balance)):0)),balance:Number(a.balance||0)}))); }
 if(method==='GET'&&pathname==='/api/finance/trial-balance'){ const rows=glAccounts.map(a=>({accountType:a.accountType||'Asset/Liability',accountNumber:a.code,accountTitle:a.name,debit:Number(a.debits??(Number(a.balance||0)>0?Number(a.balance):0)),credit:Number(a.credits??(Number(a.balance||0)<0?Math.abs(Number(a.balance)):0)),balance:Number(a.balance||0)})); return json(res,200,{rows,totals:{totalDebits:rows.reduce((t,r)=>t+r.debit,0),totalCredits:rows.reduce((t,r)=>t+r.credit,0),netDifference:rows.reduce((t,r)=>t+r.debit-r.credit,0)}}); }



 if(method==='GET'&&pathname==='/api/inventory/transactions') return json(res,200,inventoryTransactions);
 if(method==='POST'&&pathname==='/api/inventory/transactions'){ const b=await body(req); const pp=periodFromDate(b.postDate||b.date); validatePeriodOpenForSave('Inventory',pp); const id=`IN-${String(inventoryTransactions.length+1001).padStart(4,'0')}`; const t={id,type:b.type||'Adjustment',date:b.date||new Date().toISOString().slice(0,10),postDate:b.postDate||b.date||new Date().toISOString().slice(0,10),postPeriod:pp,status:'Saved',description:b.description||'',lines:b.lines||[]}; inventoryTransactions.push(t); return json(res,201,t); }
 if(method==='POST'&&pathname==='/api/inventory/transactions/post'){ const {id}=await body(req); const t=inventoryTransactions.find(x=>x.id===id); if(!t) return json(res,404,{error:'Inventory transaction not found'}); const pp=t.postPeriod||periodFromDate(t.postDate||t.date); validateSourceAndGlOpen('Inventory',pp); if(t.status!=='Saved') return json(res,400,{error:'Only Saved inventory transactions can be posted'}); const postingLines=(t.lines||[]).filter(l=>l.account&&(Number(l.debit||0)||Number(l.credit||0))); if(postingLines.length) t.jeNumber=createPostedJournal({module:'Inventory',description:`Inventory posting ${t.id}`,postPeriod:pp,transactionDate:t.postDate||t.date,sourceRef:t.id,lines:postingLines}); t.status='Released'; return json(res,200,t); }
 if(method==='GET'&&pathname==='/api/inventory/items') return json(res,200,itemMaster);


 if(method==='GET'&&pathname==='/api/sales-orders/statuses') return json(res,200,SO_STATUSES);
 if(method==='GET'&&pathname==='/api/sales-orders/customers') return json(res,200,customers.map(enrichCustomer));
 if(method==='GET'&&pathname==='/api/sales-orders'){ let rows=salesOrders.map(o=>serializeSo(o)); if(query.status) rows=rows.filter(o=>o.status===query.status); if(query.customerId) rows=rows.filter(o=>o.customerId===query.customerId); return json(res,200,rows); }
 if(method==='GET'&&pathname==='/api/sales-orders/process-orders'){ return json(res,200,salesOrders.map(o=>{ const so=serializeSo(o); const lines=so.lines||[]; return {checked:false,orderNumber:so.orderNumber,customer:so.customerName,customerName:so.customerName,orderDate:so.orderDate,requestedShipDate:so.requestedShipDate,status:so.status,orderTotal:so.orderTotal,openAmount:so.openBalance,qtyOrdered:lines.reduce((s,l)=>s+Number(l.qtyOrdered||0),0),qtyShipped:lines.reduce((s,l)=>s+Number(l.qtyShipped||0),0),qtyBackordered:lines.reduce((s,l)=>s+Number(l.qtyBackordered||0),0),creditHold:so.status==='Credit Hold'||so.customer?.creditHold,warehouse:so.warehouse}; })); }
 if(method==='POST'&&pathname==='/api/sales-orders'){ const b=await body(req); const customer=customers.find(c=>c.id===b.customerId); if(!customer) return json(res,400,{error:'Customer required'}); const id=b.orderNumber||soNextId('SO',salesOrders); const rawLines=(b.lines||[]).map(calcSoLine); validateSo({...b,customerId:customer.id,orderDate:b.orderDate||new Date().toISOString().slice(0,10)},rawLines); const order={id,orderNumber:id,orderType:b.orderType||'SO',status:b.status||'Saved',orderDate:b.orderDate||new Date().toISOString().slice(0,10),requestedShipDate:b.requestedShipDate||b.orderDate||new Date().toISOString().slice(0,10),postDate:b.postDate||b.orderDate||new Date().toISOString().slice(0,10),postPeriod:periodFromDate(b.postDate||b.orderDate||new Date().toISOString().slice(0,10)),customerPO:b.customerPO||'',description:b.description||'',customerId:customer.id,customerName:customer.name,branch:b.branch||'100',warehouse:b.warehouse||'MAIN',currency:b.currency||customer.currency||'USD',terms:b.terms||customer.terms,dueDate:b.dueDate||b.orderDate,shipVia:b.shipVia||'',fobPoint:b.fobPoint||'',freight:Number(b.freight||0),shippingInstructions:b.shippingInstructions||'',internalComments:b.internalComments||'',notes:b.notes||'',attachments:b.attachments||[]}; salesOrders.push(order); rawLines.forEach((l,i)=>salesOrderLines.push({...l,id:`SOL-${id}-${i+1}`,salesOrderId:id})); recalcSo(order); const old=order.status; const warning=soCreditCheck(order); if(order.status==='Open') allocateSo(order); addSoHistory(id,'Draft',order.status,'Save',warning||'Sales order saved.'); return json(res,201,{...serializeSo(order),warning}); }
 if(method==='GET'&&pathname==='/api/sales-orders/shipments') return json(res,200,shipments.map(sh=>({...sh,lines:shipmentLines.filter(l=>l.shipmentId===sh.id)})));
 if(method==='GET'&&pathname==='/api/sales-orders/invoices') return json(res,200,salesOrderInvoices);
 if(method==='GET'&&pathname.startsWith('/api/sales-orders/')){ const id=pathname.split('/').pop(); const o=salesOrders.find(x=>x.id===id||x.orderNumber===id); return o?json(res,200,serializeSo(o)):json(res,404,{error:'Sales order not found'}); }
 if(method==='PUT'&&pathname.startsWith('/api/sales-orders/')){ const id=pathname.split('/').pop(); const order=salesOrders.find(o=>o.id===id||o.orderNumber===id); if(!order) return json(res,404,{error:'Sales order not found'}); const b=await body(req); if(b.lines){ const rawLines=b.lines.map(calcSoLine); validateSo({...order,...b},rawLines); for(let i=salesOrderLines.length-1;i>=0;i--) if(salesOrderLines[i].salesOrderId===order.id) salesOrderLines.splice(i,1); rawLines.forEach((l,i)=>salesOrderLines.push({...l,id:l.id?.startsWith('SOL-')?l.id:`SOL-${order.id}-${i+1}`,salesOrderId:order.id})); }
 const old=order.status; Object.assign(order,b); delete order.lines; const c=customers.find(x=>x.id===order.customerId); if(c){ order.customerName=c.name; order.terms=order.terms||c.terms; } order.postPeriod=periodFromDate(order.postDate||order.orderDate); recalcSo(order); const warning=soCreditCheck(order); if(['Open','Saved'].includes(order.status)) allocateSo(order); addSoHistory(order.id,old,order.status,'Save',warning||'Sales order saved.'); return json(res,200,{...serializeSo(order),warning}); }
 if(method==='DELETE'&&pathname.startsWith('/api/sales-orders/')){ const id=pathname.split('/').pop(); const idx=salesOrders.findIndex(o=>o.id===id||o.orderNumber===id); if(idx<0) return json(res,404,{error:'Sales order not found'}); const o=salesOrders[idx]; if(o.status!=='Saved'||shipments.some(s=>s.salesOrderId===o.id)||salesOrderInvoices.some(i=>i.salesOrderId===o.id)) return json(res,400,{error:'Delete only allowed for Saved documents with no shipment or invoice. Reverse/cancel processed documents instead.'}); salesOrders.splice(idx,1); for(let i=salesOrderLines.length-1;i>=0;i--) if(salesOrderLines[i].salesOrderId===o.id) salesOrderLines.splice(i,1); return json(res,200,{ok:true}); }
 if(method==='POST'&&pathname==='/api/sales-orders/action'){ const b=await body(req); const order=salesOrders.find(o=>o.id===b.id||o.orderNumber===b.id); if(!order) return json(res,404,{error:'Sales order not found'}); const old=order.status; if(b.action==='Hold') order.status='On Hold'; else if(b.action==='Remove Hold') order.status='Open'; else if(b.action==='Confirm'){ order.status='Open'; const warning=soCreditCheck(order); if(!warning) allocateSo(order); else addSoHistory(order.id,old,order.status,b.action,warning); return json(res,200,{...serializeSo(order),warning}); } else if(b.action==='Cancel'){ if(['Shipped','Invoiced','Closed'].includes(order.status)) return json(res,400,{error:'Cancel Order only if not fully shipped/invoiced'}); order.status='Cancelled'; } else if(b.action==='Void') order.status='Voided'; else return json(res,400,{error:'Invalid action'}); addSoHistory(order.id,old,order.status,b.action,b.note||''); return json(res,200,serializeSo(order)); }
 if(method==='POST'&&pathname==='/api/sales-orders/create-shipment'){ const b=await body(req); return json(res,201,createShipmentFromOrder(b.salesOrderId,b)); }
 if(method==='POST'&&pathname==='/api/sales-orders/confirm-shipment'){ const b=await body(req); const sh=shipments.find(s=>s.id===b.shipmentId||s.shipmentNumber===b.shipmentId); if(!sh) return json(res,404,{error:'Shipment not found'}); return json(res,200,confirmShipment(sh)); }
 if(method==='POST'&&pathname==='/api/sales-orders/prepare-invoice'){ const b=await body(req); return json(res,201,prepareSoInvoice(b.salesOrderId,b)); }
 if(method==='POST'&&pathname==='/api/sales-orders/release-documents'){ const b=await body(req); const ids=b.ids||[]; const posted=[]; for(const id of ids){ const inv=arDocuments.find(d=>d.id===id&&d.type==='Invoice'); if(inv&&inv.status==='Saved'){ validateSourceAndGlOpen('AR',inv.postPeriod||periodFromDate(inv.postDate||inv.date)); inv.posted=true; postJE(inv,false); normalizeArStatus(inv); const rel=salesOrderInvoices.find(x=>x.invoiceId===inv.id); if(rel){ rel.status=inv.status; rel.openBalance=inv.balance; } posted.push(inv.id); } } return json(res,200,{posted}); }

 if(method==='GET'&&pathname==='/api/ar/invoices/send-history'){ return json(res,200,invoiceEmailHistory); }
 if(method==='POST'&&pathname==='/api/ar/invoices/send'){ if(!isAuthenticated(req)) return json(res,401,{error:'Authentication required'}); const result=await sendArInvoices(await body(req),req); return json(res,200,result); }
 if(method==='GET'&&pathname==='/api/ar/open-invoices'){ normalizeAllArStatuses(); const cid=query.customerId; const data=arDocuments.filter(d=>d.type==='Invoice'&&d.customerId===cid&&d.balance>0&&d.status!=='Voided'&&d.status!=='Closed'); return json(res,200,data); }
 if(method==='GET'&&pathname==='/api/ar/documents'){ normalizeAllArStatuses(); let data=[...arDocuments]; if(query.type)data=data.filter(d=>d.type===query.type); if(query.customerId)data=data.filter(d=>d.customerId===query.customerId); if(query.status)data=data.filter(d=>d.status===query.status); return json(res,200,data); }
 if(method==='GET'&&pathname.startsWith('/api/ar/documents/')){const id=pathname.split('/').pop(); const d=arDocuments.find(x=>x.id===id); normalizeArStatus(d); return d?json(res,200,d):json(res,404,{error:'Not found'});}
 if(method==='POST'&&pathname==='/api/ar/documents'){ const b=await body(req); if(!b.customerId) return json(res,400,{error:'Customer required'}); const customer=customers.find(c=>c.id===b.customerId); if(!customer) return json(res,400,{error:'Invalid customer'}); if(customer.status==='Inactive') return json(res,400,{error:'Inactive customers cannot be selected for new invoices/payments'}); if(customer.status==='On Hold') return json(res,400,{error:'Customer on credit hold'}); if(Number(b.amount)<=0) return json(res,400,{error:'Positive amount only'});
 const prefix=b.type==='Payment'?'PAY':b.type==='Credit Memo'?'CM':b.type==='Debit Memo'?'DM':'INV';
 const lines=(b.lines||[]).map(l=>{ const item=itemMaster.find(i=>i.code===l.itemCode)||{}; const qty=Number(l.qty||0); const unitPrice=Number(l.unitPrice??item.salesPrice??0); const discountPct=Number(l.discountPct||0); const base=qty*unitPrice; const discount=base*(discountPct/100); const taxable=(l.taxable??item.taxable)?1:0; const tax=taxable?(base-discount)*0.1:0; const lineTotal=base-discount+tax; return {itemCode:l.itemCode,description:l.description||item.name||'',qty,unitPrice,discountPct,taxable:!!taxable,tax,lineTotal,cost:Number(item.cost||0),revenueAccount:l.revenueAccount||l.salesAccount||item.revenueAccount||item.salesAccount||''}; });
 const subtotal=lines.reduce((s,l)=>s+l.qty*l.unitPrice,0); const discountTotal=lines.reduce((s,l)=>s+(l.qty*l.unitPrice*(l.discountPct/100)),0); const taxTotal=lines.reduce((s,l)=>s+l.tax,0); const grandTotal=lines.reduce((s,l)=>s+l.lineTotal,0); const cogsTotal=lines.filter(l=>(itemMaster.find(i=>i.code===l.itemCode)?.type||'')==='Inventory').reduce((s,l)=>s+(l.cost*l.qty),0); const pp=periodFromDate(b.postDate||b.date); validatePeriodOpenForSave('AR',pp);
 const doc={id:nextId(prefix),type:b.type||'Invoice',customerId:customer.id,customerName:customer.name,date:b.date||new Date().toISOString().slice(0,10),postDate:b.postDate||b.date||new Date().toISOString().slice(0,10),postPeriod:pp,dueDate:b.dueDate,terms:b.terms||customer.terms,status:'Saved',posted:false,createdDate:new Date().toISOString().slice(0,10),amount:Number(b.amount||grandTotal),balance:Number(b.amount||grandTotal),lines,subtotal,discountTotal,taxTotal,grandTotal,cogsTotal,applications:b.applications||[],method:b.method,checkNumber:b.checkNumber,cashAccount:b.cashAccount||'1079',financeChargeAmount:Number(b.financeChargeAmount||0),writeOffAmount:Number(b.writeOffAmount||0)}; if(doc.type==='Payment'){ if(!doc.date) return json(res,400,{error:'Payment date required'}); if(!doc.method) return json(res,400,{error:'Payment method required'}); if(doc.method==='Check'&&!doc.checkNumber) return json(res,400,{error:'Check number required'}); const totalApplied=(doc.applications||[]).reduce((s,a)=>s+Number(a.amount||0),0); const totalAvail=Number(doc.amount||0)+Number(doc.financeChargeAmount||0)+Number(doc.writeOffAmount||0); if(totalApplied>totalAvail) return json(res,400,{error:'Total applied cannot exceed available payment amount'}); for(const app of doc.applications){const inv=arDocuments.find(d=>d.id===app.invoiceId&&(d.type==='Invoice'||d.type==='Debit Memo')); if(!inv) return json(res,400,{error:'Invalid document application'}); if(Number(app.amount)>inv.balance) return json(res,400,{error:'Applied payment cannot exceed document balance'});} doc.unappliedBalance=(Number(doc.amount||0)+Number(doc.financeChargeAmount||0)+Number(doc.writeOffAmount||0))-totalApplied; }
 if(doc.type==='Payment'){ for(const app of doc.applications||[]){ const appDate=app.applicationDate||new Date().toISOString().slice(0,10); validatePeriodOpenForSave('AR',periodFromDate(appDate)); const inv=arDocuments.find(d=>d.id===app.invoiceId); paymentApplications.push({applicationId:`APP-${String(applicationSeq++).padStart(6,'0')}`,paymentRef:doc.id,paymentId:doc.id,customerId:doc.customerId,appliedDocumentType:'Invoice',appliedDocumentRef:inv?.id||app.invoiceId,appliedDocumentId:inv?.id||app.invoiceId,applicationDate:appDate,applicationPeriod:appDate.slice(0,7),invoiceOriginalAmount:Number(inv?.amount||0),invoiceOpenBalanceBefore:Number(inv?.balance||0),cashApplied:Number((app.cashApplied??app.amount)||0),financeCharge:Number(app.financeCharge||0),writeOffAmount:Number(app.writeOffAmount||0),appliedAmount:Number(app.amount||0),invoiceOpenBalanceAfter:Number((inv?.balance||0)-Number(app.amount||0)),status:'Saved'}); } } arDocuments.push(doc); return json(res,201,doc);} 
 if(method==='PUT'&&pathname.startsWith('/api/ar/documents/')){ const id=pathname.split('/').pop(); const d=arDocuments.find(x=>x.id===id); if(!d)return json(res,404,{error:'Not found'}); if(['Open','Closed','Voided'].includes(d.status)) return json(res,400,{error:'Cannot edit non-saved docs'}); const b=await body(req); if(b.customerId){ const customer=customers.find(c=>c.id===b.customerId); if(!customer) return json(res,400,{error:'Invalid customer'}); b.customerName=customer.name; if(!b.terms) b.terms=customer.terms; } delete b.postPeriod; const nextPostDate=b.postDate||b.date||d.postDate||d.date; validatePeriodOpenForSave('AR',periodFromDate(nextPostDate)); Object.assign(d,b); d.postPeriod=periodFromDate(d.postDate||d.date); return json(res,200,d);}
 if(method==='DELETE'&&pathname.startsWith('/api/ar/documents/')){ const id=pathname.split('/').pop(); const idx=arDocuments.findIndex(x=>x.id===id); if(idx<0)return json(res,404,{error:'Not found'}); const d=arDocuments[idx]; normalizeArStatus(d); if(['Open','Closed','Voided'].includes(d.status)) return json(res,400,{error:'Posted transactions cannot be deleted. Please void the transaction instead.'}); const hasApps=(d.applications&&d.applications.length>0)||arDocuments.some(x=>(x.applications||[]).some(a=>a.invoiceId===id||a.paymentId===id||a.reference===id))||paymentApplications.some(a=>a.paymentId===id||a.appliedDocumentId===id); if(hasApps) return json(res,400,{error:'This transaction has applications and cannot be deleted. Please void it instead.'}); arDocuments.splice(idx,1); return json(res,200,{ok:true}); }

 if(method==='POST'&&pathname==='/api/ar/payments/apply'){ const b=await body(req); validateSourceAndGlOpen('AR',periodFromDate(b.applicationDate)); const payment=arDocuments.find(x=>x.id===b.paymentId&&x.type==='Payment'); if(!payment) return json(res,404,{error:'Payment not found'}); normalizeArStatus(payment); if(!payment.posted||!['Open','Closed'].includes(payment.status)) return json(res,400,{error:'Only posted payments can be applied'}); const applications=(b.applications||[]).map(a=>{ const cashApplied=Number(a.cashApplied??a.amount??0); const financeCharge=Number(a.financeCharge||0); const writeOffAmount=Number(a.writeOffAmount||0); return {invoiceId:a.invoiceId,amount:cashApplied+financeCharge+writeOffAmount,cashApplied,financeCharge,writeOffAmount}; }).filter(a=>a.amount>0); if(!applications.length) return json(res,400,{error:'Select at least one invoice to apply'}); const available=toNumber(payment.unappliedBalance ?? (toNumber(payment.amount)-toNumber((payment.applications||[]).reduce((s,a)=>s+toNumber(a.cashApplied??a.amount),0)))); const totalCash=applications.reduce((s,a)=>s+a.cashApplied,0); if(totalCash>available) return json(res,400,{error:'Cash applied cannot exceed unapplied payment balance'}); const appliedOn=b.applicationDate||new Date().toISOString().slice(0,10); for(const app of applications){ const inv=arDocuments.find(x=>x.id===app.invoiceId&&(x.type==='Invoice'||x.type==='Debit Memo')&&x.customerId===payment.customerId); if(!inv) return json(res,400,{error:'Invalid document application'}); normalizeArStatus(inv); if(inv.status!=='Open'||toNumber(inv.balance)<=0) return json(res,400,{error:'Only open invoices can be applied'}); if(app.amount>toNumber(inv.balance)) return json(res,400,{error:'Applied payment cannot exceed document balance'}); }
  const feeLines=[]; const feeTotal=applications.reduce((s,a)=>s+a.financeCharge+a.writeOffAmount,0); if(feeTotal>0){ const fc=applications.reduce((s,a)=>s+a.financeCharge,0); const wo=applications.reduce((s,a)=>s+a.writeOffAmount,0); if(fc) feeLines.push({account:POSTING_ACCOUNTS.bankFees,debit:fc,credit:0,sourceReference:payment.id}); if(wo) feeLines.push({account:POSTING_ACCOUNTS.returnsAllowances,debit:wo,credit:0,sourceReference:payment.id}); feeLines.push({account:POSTING_ACCOUNTS.accountsReceivable,debit:0,credit:feeTotal,sourceReference:payment.id}); }
  const feeJeRef=feeLines.length?createPostedJournal({module:'AR',description:`Payment application adjustments ${payment.id}`,postPeriod:periodFromDate(appliedOn),transactionDate:appliedOn,sourceRef:payment.id,lines:feeLines}):'';
  payment.applications=payment.applications||[];
  for(const app of applications){ const inv=arDocuments.find(x=>x.id===app.invoiceId); const applicationId=`APP-${String(applicationSeq++).padStart(6,'0')}`; const before=toNumber(inv.balance); inv.balance=before-app.amount; inv.applications=inv.applications||[]; inv.applications.push({applicationId,reference:payment.id,paymentId:payment.id,amount:app.amount,date:appliedOn,status:'Applied',type:'Payment',appliedFromReference:inv.id,remainingBalance:inv.balance}); payment.applications.push({invoiceId:inv.id,amount:app.amount,cashApplied:app.cashApplied,financeCharge:app.financeCharge,writeOffAmount:app.writeOffAmount,applicationId,date:appliedOn,status:'Applied'}); paymentApplications.push({applicationId,paymentRef:payment.id,paymentId:payment.id,customerId:payment.customerId,appliedDocumentType:inv.type,appliedDocumentRef:inv.id,appliedDocumentId:inv.id,applicationDate:appliedOn,applicationPeriod:appliedOn.slice(0,7),invoiceOriginalAmount:Number(inv.amount||0),invoiceOpenBalanceBefore:before,cashApplied:app.cashApplied,financeCharge:app.financeCharge,writeOffAmount:app.writeOffAmount,appliedAmount:app.amount,invoiceOpenBalanceAfter:inv.balance,status:'Applied',jeRef:feeJeRef||journalEntries.find(j=>j.sourceRef===payment.id)?.jeNumber||''}); normalizeArStatus(inv); }
  payment.unappliedBalance=available-totalCash; normalizeArStatus(payment); return json(res,200,payment); }
if(method==='POST'&&pathname==='/api/ar/documents/post'){ const {id}=await body(req); const d=arDocuments.find(x=>x.id===id); if(!d)return json(res,404,{error:'Not found'}); const pp=d.postPeriod||periodFromDate(d.postDate||d.date); validateSourceAndGlOpen('AR',pp); normalizeArStatus(d); if(d.status==='Voided') return json(res,400,{error:'Voided doc'}); if(d.status!=='Saved') return json(res,400,{error:'Only Saved transactions can be posted'}); d.posted=true; if(d.reversalOf){ const orig=arDocuments.find(x=>x.id===d.reversalOf); postJE({...orig||d,postDate:d.postDate||d.date,postPeriod:pp},true); if(orig) orig.status='Voided'; } else { postJE(d,false); } if(d.type==='Payment'){ let totalApplied=0; for(const a of d.applications||[]){const inv=arDocuments.find(x=>x.id===a.invoiceId); if(inv){ inv.balance-=Number(a.amount); totalApplied+=Number(a.amount); inv.applications=inv.applications||[]; inv.applications.push({reference:d.id,paymentId:d.id,amount:Number(a.amount),date:d.date,status:'Applied',type:'Payment',appliedFromReference:inv.id,remainingBalance:inv.balance}); normalizeArStatus(inv); } } d.unappliedBalance=(Number(d.amount||0)+Number(d.financeChargeAmount||0)+Number(d.writeOffAmount||0))-totalApplied; paymentApplications.filter(pa=>pa.paymentId===d.id).forEach(pa=>{pa.status='Applied'; const inv=arDocuments.find(x=>x.id===pa.appliedDocumentId); pa.invoiceOpenBalanceAfter=Number(inv?.balance||pa.invoiceOpenBalanceAfter);}); } normalizeArStatus(d); return json(res,200,d); }
 if(method==='POST'&&pathname==='/api/ar/documents/void'){ const {id,reversalDate}=await body(req); const appliedOn=reversalDate||new Date().toISOString().slice(0,10); const d=arDocuments.find(x=>x.id===id); if(!d)return json(res,404,{error:'Not found'}); validateReversalSourceAndGlOpen('AR',periodFromDate(appliedOn)); normalizeArStatus(d); if(!['Open','Closed'].includes(d.status)) return json(res,400,{error:'Only open/closed docs can be voided'}); if(d.type==='Payment'){ const revRef=`REV-${d.id}`; const apps=paymentApplications.filter(a=>a.paymentId===d.id&&a.status==='Applied'); const revJe=postJE({...d,postDate:appliedOn,postPeriod:periodFromDate(appliedOn)},true); d.applications=d.applications||[]; for(const a of apps){ const amt=toNumber(a.appliedAmount); const inv=arDocuments.find(x=>x.id===a.appliedDocumentId); if(inv&&inv.status!=='Voided'){ inv.balance=toNumber(inv.balance)+amt; normalizeArStatus(inv); inv.applications=inv.applications||[]; inv.applications.push({applicationId:`APP-${String(applicationSeq++).padStart(6,'0')}`,reference:revRef,reversalReference:revRef,jeRef:revJe,paymentId:d.id,amount:-amt,date:appliedOn,status:'Reversed',type:'Payment Reversal',appliedFromReference:inv.id,remainingBalance:inv.balance}); } const reversalApplicationId=`APP-${String(applicationSeq++).padStart(6,'0')}`; d.applications.push({applicationId:reversalApplicationId,invoiceId:a.appliedDocumentId,paymentId:d.id,amount:-amt,date:appliedOn,status:'Reversed',reference:revRef,reversalReference:revRef,jeRef:revJe}); paymentApplications.push({...a,applicationId:reversalApplicationId,status:'Reversed',paymentRef:d.id,reversalReference:revRef,jeRef:revJe,cashApplied:-toNumber(a.cashApplied||amt),financeCharge:-toNumber(a.financeCharge||0),writeOffAmount:-toNumber(a.writeOffAmount||0),appliedAmount:-amt,reversalAmount:-amt,applicationDate:appliedOn,applicationPeriod:appliedOn.slice(0,7),invoiceOpenBalanceBefore:toNumber(inv?.balance||0)-amt,invoiceOpenBalanceAfter:toNumber(inv?.balance||0)}); } d.status='Voided'; d.posted=true; d.unappliedBalance=0; return json(res,200,{message:'Payment voided and applications reversed',document:d,reversalJournalEntry:revJe}); }
 if(['Invoice','Credit Memo','Debit Memo'].includes(d.type)){
  const originalApps=[...(d.applications||[])].filter(app=>toNumber(app.amount)>0&&app.paymentId);
  for(const app of originalApps){
   const pay=arDocuments.find(x=>x.id===app.paymentId&&x.type==='Payment');
   if(pay&&pay.status!=='Voided'){
    const amt=toNumber(app.amount);
    d.applications=d.applications||[];
    d.applications.push({reference:`REV-${d.id}`,paymentId:pay.id,amount:-amt,date:new Date().toISOString().slice(0,10),status:'Reversed',type:'Payment Reversal',appliedFromReference:d.id,remainingBalance:toNumber(d.balance)});
    pay.unappliedBalance=toNumber(pay.unappliedBalance)+amt;
    pay.applications=pay.applications||[];
    pay.applications.push({reference:`REV-${d.id}`,invoiceId:d.id,paymentId:pay.id,amount:-amt,date:new Date().toISOString().slice(0,10),status:'Reversed',type:`${d.type} Reversal`,appliedFromReference:d.id,remainingBalance:pay.unappliedBalance});
    paymentApplications.push({applicationId:`APP-${String(applicationSeq++).padStart(6,'0')}`,paymentRef:pay.id,paymentId:pay.id,customerId:pay.customerId,appliedDocumentType:d.type,appliedDocumentRef:d.id,appliedDocumentId:d.id,applicationDate:appliedOn,applicationPeriod:appliedOn.slice(0,7),invoiceOriginalAmount:toNumber(d.amount),invoiceOpenBalanceBefore:toNumber(d.balance),appliedAmount:amt,invoiceOpenBalanceAfter:toNumber(d.balance),status:'Reversed',reversalReference:`REV-${d.id}`,reversalAmount:amt});
    normalizeArStatus(pay);
   }
  }
 }
 d.status='Voided'; d.posted=true; postJE({...d,postDate:appliedOn,postPeriod:periodFromDate(appliedOn)},true); return json(res,200,{message:'Document voided',document:d}); }
 if(method==='POST'&&pathname==='/api/ar/release/post-selected'){ const b=await body(req); const ids=b.ids||[]; const docs=ids.map(id=>arDocuments.find(x=>x.id===id)).filter(Boolean); docs.forEach(normalizeArStatus); const toPost=docs.filter(d=>d.status==='Saved'); toPost.forEach(d=>validateSourceAndGlOpen('AR',d.postPeriod||periodFromDate(d.postDate||d.date))); const updated=[]; for(const d of toPost){ d.posted=true; postJE(d,false); normalizeArStatus(d); updated.push(d);} return json(res,200,{posted:updated.length,documents:updated}); }
 if(method==='POST'&&pathname==='/api/ar/memos/apply'){ const {memoId,applications=[],applicationDate}=await body(req); validatePeriodOpen('AR',periodFromDate(applicationDate)); const memo=arDocuments.find(x=>x.id===memoId&&(x.type==='Credit Memo'||x.type==='Debit Memo')); if(!memo) return json(res,404,{error:'Memo not found'}); normalizeArStatus(memo); if(memo.status!=='Open') return json(res,400,{error:'Only open memos can be applied'}); let rem=toNumber(memo.balance); for(const app of applications){ const amt=toNumber(app.amount); const doc=arDocuments.find(x=>x.id===app.documentId&&x.customerId===memo.customerId&&(x.type==='Invoice'||x.type==='Payment')); if(!doc||doc.status!=='Open'||toNumber(doc.balance)<=0) return json(res,400,{error:'Invalid application target'}); if(amt<=0) continue; if(amt>rem||amt>toNumber(doc.balance)) return json(res,400,{error:'Invalid application amount'}); const before=toNumber(doc.balance); doc.balance=before-amt; rem-=amt; doc.applications=doc.applications||[]; doc.applications.push({reference:memo.id,paymentId:memo.id,amount:amt,date:new Date().toISOString().slice(0,10),status:'Applied',type:memo.type,appliedFromReference:doc.id,remainingBalance:doc.balance}); memo.applications=memo.applications||[]; memo.applications.push({reference:doc.id,paymentId:memo.id,amount:amt,date:new Date().toISOString().slice(0,10),status:'Applied',type:doc.type,appliedFromReference:memo.id,remainingBalance:rem}); normalizeArStatus(doc); } memo.balance=rem; normalizeArStatus(memo); return json(res,200,{memo}); }

 if(method==='GET'&&pathname==='/api/ar/reports/aging'){
   const asOf=new Date(query.date||new Date().toISOString().slice(0,10));
   const customerFilter=query.customerId;
   const bucketFilter=query.bucket;
   const invoices=arDocuments.filter(d=>d.type==='Invoice'&&d.status!=='Voided'&&d.balance>0&&(customerFilter?d.customerId===customerFilter:true));
   const map={};
   for(const inv of invoices){
     const days=Math.floor((asOf-new Date(inv.dueDate||inv.date))/86400000);
     const key=inv.customerName;
     if(!map[key]) map[key]={customerName:key,current:0,b1_30:0,b31_60:0,b61_90:0,b90p:0,items:[]};
     if(days<=0) map[key].current+=inv.balance;
     else if(days<=30) map[key].b1_30+=inv.balance;
     else if(days<=60) map[key].b31_60+=inv.balance;
     else if(days<=90) map[key].b61_90+=inv.balance;
     else map[key].b90p+=inv.balance;
     map[key].items.push({invoice:inv.id,balance:inv.balance,daysPastDue:days});
   }
   let rows=Object.values(map);
   if(bucketFilter){
     rows=rows.filter(r=>bucketFilter==='30'?r.b1_30>0:bucketFilter==='60'?r.b31_60>0:bucketFilter==='90'?r.b61_90>0:bucketFilter==='120'?r.b90p>0:true);
   }
   return json(res,200,rows);
 }


 if(method==='GET'&&pathname==='/api/ar/payment-applications'){ let data=[...paymentApplications]; if(query.paymentId) data=data.filter(x=>x.paymentId===query.paymentId); if(query.invoiceId) data=data.filter(x=>x.appliedDocumentId===query.invoiceId); return json(res,200,data); }
 if(method==='GET'&&pathname==='/api/finance/reclassify/search'){ return json(res,200,postedReclassCandidates(query)); }
 if(method==='POST'&&pathname==='/api/finance/reclassify/process'){ const je=processReclassification(await body(req)); return json(res,201,je); }
 if(method==='GET'&&pathname==='/api/finance/journal-transactions'){ return json(res,200,journalEntries); }
 if(method==='GET'&&pathname.startsWith('/api/finance/journal-transactions/')){ const id=pathname.split('/').pop(); const je=journalEntries.find(j=>j.jeNumber===id); return je?json(res,200,je):json(res,404,{error:'JE not found'}); }
 if(method==='POST'&&pathname==='/api/finance/journal-transactions'){ const b=await body(req); const lines=b.lines||[]; const dr=lines.reduce((s,l)=>s+Number(l.debit||0),0); const cr=lines.reduce((s,l)=>s+Number(l.credit||0),0); if(dr!==cr) return json(res,400,{error:'Total debits must equal total credits'}); const postDate=b.postDate||b.transactionDate||new Date().toISOString().slice(0,10); const pp=periodFromDate(postDate); validatePeriodOpenForSave('GL',pp); const je={jeNumber:`JE${String(journalEntries.length+1).padStart(6,'0')}`,batchNumber:`BATCH-${String(journalEntries.length+1).padStart(6,'0')}`,module:'GL',description:b.description||'',financialPeriod:pp,postPeriod:pp,transactionDate:postDate,status:'Saved',sourceRef:b.sourceRef||'',createdBy:'admin',createdDate:new Date().toISOString(),lines:lines.map(l=>{ const account=requireAccount(l.account,'Journal line account'); return {branch:l.branch||'100',branchName:(branchMaster.find(b=>b.code===String(l.branch||'100'))?.name)||'Custom Branch',account,debit:Number(l.debit||0),credit:Number(l.credit||0),sourceReference:l.sourceReference||''}; })}; journalEntries.push(je); return json(res,201,je); }
 if(method==='POST'&&pathname==='/api/finance/journal-transactions/post'){ const {jeNumber}=await body(req); const je=journalEntries.find(j=>j.jeNumber===jeNumber); if(!je) return json(res,404,{error:'JE not found'}); validatePeriodOpen('GL',je.postPeriod||je.financialPeriod||periodFromDate(je.transactionDate)); if(je.status!=='Saved') return json(res,400,{error:'Only Saved transactions can be posted'}); const dr=je.lines.reduce((s,l)=>s+l.debit,0), cr=je.lines.reduce((s,l)=>s+l.credit,0); if(dr!==cr) return json(res,400,{error:'Out-of-balance JE'}); if(je.status!=='Posted'){ je.status='Posted'; je.lines.forEach(l=>{ if(l.debit) bump(l.account,'Debit',l.debit); if(l.credit) bump(l.account,'Credit',l.credit);}); if(je.reversalOf){ const orig=journalEntries.find(x=>x.jeNumber===je.reversalOf); if(orig) orig.status='Reversed'; } } return json(res,200,je); }
 if(method==='DELETE'&&pathname.startsWith('/api/finance/journal-transactions/')){ const id=pathname.split('/').pop(); const idx=journalEntries.findIndex(j=>j.jeNumber===id); if(idx<0) return json(res,404,{error:'JE not found'}); if(['Posted','Open','Closed','Voided','Reversed'].includes(journalEntries[idx].status)) return json(res,400,{error:'Posted transactions cannot be deleted. Please void the transaction instead.'}); journalEntries.splice(idx,1); return json(res,200,{ok:true}); }
 if(method==='POST'&&pathname==='/api/finance/journal-transactions/reverse'){ const {jeNumber,reversalDate}=await body(req); const je=journalEntries.find(j=>j.jeNumber===jeNumber); if(!je) return json(res,404,{error:'JE not found'}); const postDate=reversalDate||new Date().toISOString().slice(0,10); const pp=periodFromDate(postDate); validateReversalPeriodOpen('GL',pp); const rev={...je,jeNumber:`RJE${String(journalEntries.length+1).padStart(6,'0')}`,batchNumber:`RBATCH-${String(journalEntries.length+1).padStart(6,'0')}`,financialPeriod:pp,postPeriod:pp,transactionDate:postDate,description:`Reversal of ${je.jeNumber}`,status:'Saved',sourceRef:je.jeNumber,reversalOf:je.jeNumber,lines:je.lines.map(l=>({...l,debit:l.credit,credit:l.debit,sourceReference:je.jeNumber}))}; journalEntries.push(rev); return json(res,201,rev); }
 if(method==='POST'&&pathname==='/api/finance/journal-transactions/copy'){ const {jeNumber}=await body(req); const je=journalEntries.find(j=>j.jeNumber===jeNumber); if(!je) return json(res,404,{error:'JE not found'}); validatePeriodOpenForSave('GL',je.postPeriod||je.financialPeriod||periodFromDate(je.transactionDate)); const c={...je,jeNumber:`JE${String(journalEntries.length+1).padStart(6,'0')}`,batchNumber:`BATCH-${String(journalEntries.length+1).padStart(6,'0')}`,status:'Saved',description:`Copy of ${je.jeNumber}`}; journalEntries.push(c); return json(res,201,c); }

 if(method==='GET'&&pathname==='/api/gl/journal-entries') return json(res,200,journalEntries);
 return json(res,404,{error:'Not found'});
 }catch(e){return json(res,400,{error:e.message});}});
server.listen(process.env.PORT||3000);
