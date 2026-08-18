from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
server_path = ROOT / 'src' / 'server.js'
index_path = ROOT / 'public' / 'index.html'
server = server_path.read_text()
index = index_path.read_text()


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def regex_once(text, pattern, replacement, label):
    out, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one regex match, found {count}')
    return out

# Load the responsive override after the existing application stylesheet.
index = replace_once(
    index,
    "<link rel='stylesheet' href='/styles.css'>",
    "<link rel='stylesheet' href='/styles.css'><link rel='stylesheet' href='/responsive.css?v=erp-responsive-20260817'>",
    'responsive stylesheet link'
)

# Serve the additional static stylesheet through the same static-file path as app.js/styles.css.
server = replace_once(
    server,
    "async function serve(p,res){ if(p==='/app.js'||p==='/styles.css'){const c=await readFile(path.join(publicDir,p.slice(1)));res.writeHead(200,{'Content-Type':p.endsWith('.css')?'text/css':'application/javascript'});res.end(c);return true;}",
    "async function serve(p,res){ if(['/app.js','/styles.css','/responsive.css'].includes(p)){const c=await readFile(path.join(publicDir,p.slice(1)));res.writeHead(200,{'Content-Type':p.endsWith('.css')?'text/css':'application/javascript'});res.end(c);return true;}",
    'responsive static asset serving'
)

# System-generated posted journals should never store a blank line description. Manual journal
# creation uses normalizeManualJournalLine and is intentionally not changed here.
old_normalized = "const normalized=(lines||[]).map(l=>({account:requireAccount(l.account||l.a,'Posting account'),debit:Number(l.debit??l.dr??0),credit:Number(l.credit??l.cr??0),sourceReference:l.sourceReference||sourceRef||'',lineDescription:l.lineDescription||l.description||'',description:l.lineDescription||l.description||'',branch:l.branch||'100',branchName:l.branchName||'Chicago HQ'})).filter(l=>l.debit||l.credit);"
new_normalized = "const normalized=(lines||[]).map(l=>{const sourceReference=l.sourceReference||sourceRef||'';const lineDescription=String(l.lineDescription||l.description||([module,sourceReference].filter(Boolean).join(' ')||description||'System posting')).trim().slice(0,255);return{account:requireAccount(l.account||l.a,'Posting account'),debit:Number(l.debit??l.dr??0),credit:Number(l.credit??l.cr??0),sourceReference,lineDescription,description:lineDescription,branch:l.branch||'100',branchName:l.branchName||'Chicago HQ'};}).filter(l=>l.debit||l.credit);"
server = replace_once(server, old_normalized, new_normalized, 'journal description fallback')

new_ap_posting_lines = r'''function apDocumentLabel(doc){
  if(doc.type==='Payment') return 'AP Payment';
  if(doc.type==='Prepayment') return 'AP Prepayment';
  if(doc.type==='Credit Adjustment') return 'AP Credit Adjustment';
  if(doc.type==='Debit Adjustment') return 'AP Debit Adjustment';
  return 'AP Bill';
}
function apPostingLineDescription(doc,line={},role=''){
  const parts=[`${apDocumentLabel(doc)} ${doc.id}`];
  const vendorInvoice=String(doc.vendorRef||doc.invoiceNumber||'').trim();
  const po=String(line.poNumber||line.sourcePoId||line.poId||'').trim();
  const receipt=String(line.receiptNumber||line.sourceReceiptId||line.receiptId||'').trim();
  const detail=String(line.lineDescription||line.description||line.inventoryId||line.itemId||'').trim();
  if(vendorInvoice) parts.push(`Vendor Invoice ${vendorInvoice}`);
  if(po) parts.push(`PO ${po}`);
  if(receipt) parts.push(`Receipt ${receipt}`);
  if(detail&&detail!==role) parts.push(detail);
  if(role) parts.push(role);
  return parts.filter(Boolean).join(' | ').slice(0,255);
}
function apPostingLines(doc){
  const amt=Number(doc.amount||0),branch=doc.branch||'100';
  if(doc.type==='Payment') return [
    {account:POSTING_ACCOUNTS.accountsPayable,debit:amt,credit:0,sourceReference:doc.id,lineDescription:apPostingLineDescription(doc,{},'Accounts Payable'),branch},
    {account:requireAccount(String(doc.cashAccount||POSTING_ACCOUNTS.apCash).trim().split(/\s+/)[0],'AP cash account'),debit:0,credit:amt,sourceReference:doc.id,lineDescription:apPostingLineDescription(doc,{},'Cash'),branch}
  ];
  if(doc.type==='Prepayment') return [
    {account:POSTING_ACCOUNTS.vendorDeposit,debit:amt,credit:0,sourceReference:doc.id,lineDescription:apPostingLineDescription(doc,{},'Vendor Deposit'),branch},
    {account:requireAccount(String(doc.cashAccount||POSTING_ACCOUNTS.apCash).trim().split(/\s+/)[0],'AP cash account'),debit:0,credit:amt,sourceReference:doc.id,lineDescription:apPostingLineDescription(doc,{},'Cash'),branch}
  ];
  if(doc.type==='Credit Adjustment') return [
    {account:POSTING_ACCOUNTS.accountsPayable,debit:amt,credit:0,sourceReference:doc.id,lineDescription:apPostingLineDescription(doc,{},'Accounts Payable'),branch},
    {account:POSTING_ACCOUNTS.returnsAllowances,debit:0,credit:amt,sourceReference:doc.id,lineDescription:apPostingLineDescription(doc,{},'Returns / Allowances'),branch}
  ];
  const docLines=(doc.lines||[]).length?doc.lines:[{amount:amt,expenseAccount:doc.expenseAccount,description:doc.description||''}];
  const baseAmounts=docLines.map(line=>Number(line.amount??line.lineTotal??line.extendedCost??apLineAmount(line)??0));
  const baseTotal=Number(baseAmounts.reduce((sum,value)=>sum+value,0).toFixed(2));
  const headerExtra=Number((amt-baseTotal).toFixed(2));
  let allocatedExtra=0;
  const lines=[];
  for(let index=0;index<docLines.length;index++){
    const line=docLines[index],base=baseAmounts[index];
    const invItem=itemMaster.find(i=>i.code===(line.inventoryId||line.itemId||line.itemCode));
    const expenseAccount=(line.poNumber||line.receiptNumber||line.sourcePoId||line.sourceReceiptId)?requireAccount(line.rniAccount||line.apAccrualAccount||POSTING_ACCOUNTS.poRni,'AP bill RNI account'):(isStockItem(invItem)?requireAccount(invItem.inventoryAccount,'AP bill inventory account'):requireAccount(sourceAccountFromLine(line,['expenseAccount','account'],''),'AP bill expense account'));
    let extra=0;
    if(headerExtra){
      if(index===docLines.length-1) extra=Number((headerExtra-allocatedExtra).toFixed(2));
      else { const weight=baseTotal?base/baseTotal:1/docLines.length; extra=Number((headerExtra*weight).toFixed(2)); allocatedExtra=Number((allocatedExtra+extra).toFixed(2)); }
    }
    const lineAmount=Number((base+extra).toFixed(2));
    if(lineAmount) lines.push({account:expenseAccount,debit:lineAmount,credit:0,sourceReference:doc.id,lineDescription:apPostingLineDescription(doc,line),branch:line.branch||branch});
  }
  lines.push({account:POSTING_ACCOUNTS.accountsPayable,debit:0,credit:amt,sourceReference:doc.id,lineDescription:apPostingLineDescription(doc,{},'Accounts Payable'),branch});
  return lines;
}

function syncApPaymentReview'''
server = regex_once(
    server,
    r"function apPostingLines\(doc\)\{.*?\n\}\n\nfunction syncApPaymentReview",
    new_ap_posting_lines,
    'AP posting line generation'
)

new_post_ap_block = r'''function postApJE(doc,reverse=false){
  const postDate=doc.postDate||doc.date||new Date().toISOString().slice(0,10); const postPeriod=doc.postPeriod||periodFromDate(postDate); validatePeriodOpen('GL',postPeriod);
  if(!reverse){
    const existing=journalEntries.find(entry=>entry.module==='AP'&&entry.sourceRef===doc.id&&!entry.reversalOf);
    if(existing){doc.jeNumber=existing.jeNumber;doc.journalEntryNumber=existing.jeNumber;doc.journalEntryId=existing.id||existing.jeNumber;doc.batchNumber=existing.batchNumber||'';return existing.jeNumber;}
  }
  let lines=apPostingLines(doc);
  if(reverse) lines=lines.map(l=>({...l,debit:l.credit,credit:l.debit,sourceReference:doc.id,lineDescription:`Reversal | ${l.lineDescription||apPostingLineDescription(doc)}`.slice(0,255)}));
  const je=createPostedJournal({module:'AP',description:`${reverse?'Reversal of':'Auto from'} ${doc.id}`,postPeriod,transactionDate:postDate,sourceRef:doc.id,lines,reversalOf:reverse?doc.id:''});
  if(!reverse){ const journal=journalEntries.find(entry=>entry.jeNumber===je); doc.jeNumber=je; doc.journalEntryNumber=je; doc.journalEntryId=journal?.id||je; doc.batchNumber=journal?.batchNumber||''; }
  if(!reverse){ for(const line of (doc.lines||[])){ if(line.poNumber||line.receiptNumber||line.sourcePoId||line.sourceReceiptId) continue; const item=itemMaster.find(i=>i.code===(line.inventoryId||line.itemId||line.itemCode)); if(isStockItem(item)){ const qty=Number(line.qty||line.quantity||0); if(qty>0){ adjustInventoryBalance({itemId:item.code,warehouse:line.warehouse||item.defaultWarehouse||'MAIN',location:line.location||item.defaultLocation||'MAIN-A1',qtyIn:qty,unitCost:Number(line.unitCost||line.cost||itemCost(item))}); createInvAudit({transactionType:'AP Receipt',referenceNumber:doc.id,sourceModule:'AP',sourceReference:doc.id,itemId:item.code,warehouse:line.warehouse||item.defaultWarehouse||'MAIN',location:line.location||item.defaultLocation||'MAIN-A1',quantityIn:qty,unitCost:Number(line.unitCost||line.cost||itemCost(item)),postDate,postPeriod,jeReference:je}); } } } }
  return je;
}
function apPostingBusinessError(message,statusCode=400,code='AP_POSTING_VALIDATION'){
  const error=new Error(message); error.statusCode=statusCode; error.code=code; return error;
}
function validateApBillPoPosting(doc){
  if(doc.type!=='Bill') return;
  for(const [index,line] of (doc.lines||[]).entries()){
    const poNo=line.poNumber||line.sourcePoId||line.poId; if(!poNo) continue;
    const po=purchaseOrders.find(p=>p.poNumber===poNo||p.id===poNo); if(!po) throw apPostingBusinessError(`Purchase Order ${poNo} was not found.`);
    const poLine=purchaseOrderLines.find(l=>l.poId===po.id&&((line.poLineId&&l.id===line.poLineId)||(!line.poLineId&&(l.inventoryId===line.inventoryId||l.itemId===line.itemId))));
    if(!poLine) throw apPostingBusinessError(`Purchase Order line for ${line.inventoryId||line.poLineId||`line ${index+1}`} was not found.`);
    const qty=Number(line.qty||line.quantity||0),item=itemMaster.find(i=>i.code===poLine.inventoryId),basis=isStockItem(item)?Number(poLine.qtyReceived||0):Number(poLine.qtyOrdered||0),available=Math.max(0,basis-Number(poLine.qtyBilled||0));
    if(qty<=0) throw apPostingBusinessError(`Bill quantity on line ${index+1} must be greater than zero.`);
    if(qty>available) throw apPostingBusinessError(isStockItem(item)?`Line ${index+1} cannot bill ${qty}; only ${available} received quantity remains unbilled.`:`Line ${index+1} cannot bill ${qty}; only ${available} ordered quantity remains unbilled.`);
    const receiptNo=line.receiptNumber||line.sourceReceiptId||line.receiptId;
    if(receiptNo){
      const receipt=purchaseReceipts.find(r=>r.receiptNumber===receiptNo||r.id===receiptNo); if(!receipt) throw apPostingBusinessError(`Purchase Receipt ${receiptNo} was not found.`);
      if(receipt.poId&&receipt.poId!==po.id) throw apPostingBusinessError(`Purchase Receipt ${receiptNo} does not belong to Purchase Order ${po.poNumber||po.id}.`);
      const receiptLine=purchaseReceiptLines.find(x=>x.receiptId===receipt.id&&x.poLineId===poLine.id); if(!receiptLine) throw apPostingBusinessError(`Purchase Receipt ${receiptNo} does not contain the selected PO line.`);
      const receiptAvailable=Math.max(0,Number(receiptLine.receiptQty||0)-Number(receiptLine.qtyBilled||0));
      if(qty>receiptAvailable) throw apPostingBusinessError(`Purchase Receipt ${receiptNo} has only ${receiptAvailable} unbilled quantity available on line ${index+1}.`);
    }
  }
}
function snapshotApPostingState(){
  return {
    apDocuments:structuredClone(apDocuments),glAccounts:structuredClone(glAccounts),journalEntries:structuredClone(journalEntries),purchaseOrders:structuredClone(purchaseOrders),purchaseOrderLines:structuredClone(purchaseOrderLines),purchaseReceipts:structuredClone(purchaseReceipts),purchaseReceiptLines:structuredClone(purchaseReceiptLines),poBillLinks:structuredClone(poBillLinks),poStatusHistory:structuredClone(poStatusHistory),inventoryBalances:structuredClone(inventoryBalances),inventoryTransactions:structuredClone(inventoryTransactions),itemMaster:structuredClone(itemMaster),workflowAuditLog:structuredClone(workflowAuditLog),applicationSeq,auditSeq
  };
}
function restoreApPostingState(snapshot){
  const restore=(target,rows)=>target.splice(0,target.length,...structuredClone(rows));
  restore(apDocuments,snapshot.apDocuments);restore(glAccounts,snapshot.glAccounts);restore(journalEntries,snapshot.journalEntries);restore(purchaseOrders,snapshot.purchaseOrders);restore(purchaseOrderLines,snapshot.purchaseOrderLines);restore(purchaseReceipts,snapshot.purchaseReceipts);restore(purchaseReceiptLines,snapshot.purchaseReceiptLines);restore(poBillLinks,snapshot.poBillLinks);restore(poStatusHistory,snapshot.poStatusHistory);restore(inventoryBalances,snapshot.inventoryBalances);restore(inventoryTransactions,snapshot.inventoryTransactions);restore(itemMaster,snapshot.itemMaster);restore(workflowAuditLog,snapshot.workflowAuditLog);applicationSeq=snapshot.applicationSeq;auditSeq=snapshot.auditSeq;
}
function validateApPostingRequest(doc,{duplicateOverrideReason=''}={}){
  try{
    const pp=doc.postPeriod||periodFromDate(doc.postDate||doc.date); validateSourceAndGlOpen('AP',pp);
    if(doc.hold) throw apPostingBusinessError('Document is on hold and cannot be released');
    if(Number(doc.amount)<=0) throw apPostingBusinessError(['Payment','Prepayment'].includes(doc.type)?'Payment amount must be greater than $0.00.':'Transaction amount must be greater than $0.00.');
    validateApBillAmount(doc);
    if(doc.type==='Bill'){
      assertBillPostable(doc); const dupes=duplicateBills(doc); if(dupes.length&&!duplicateOverrideReason) throw apPostingBusinessError(`Potential duplicate invoice found: ${dupes.map(x=>x.id).join(', ')}. Review duplicate bill before posting.`);
      validateApBillPoPosting(doc);
    } else if(doc.type==='Prepayment'){
      if(doc.status!=='Approved'||doc.paymentApprovalStatus!=='Approved For Payment') throw apPostingBusinessError('Vendor prepayment must be approved before posting.');
    } else if(doc.status!=='Saved') throw apPostingBusinessError('Only Saved transactions can be posted');
    if(['Payment','Prepayment'].includes(doc.type)){syncApPaymentReview(doc);const payStatus=doc.paymentApprovalStatus||'Not Required';if(payStatus==='Pending Payment Approval')throw apPostingBusinessError('Payment batch requires payment approval before posting.');}
    const lines=apPostingLines(doc),dr=lines.reduce((sum,line)=>sum+Number(line.debit||0),0),cr=lines.reduce((sum,line)=>sum+Number(line.credit||0),0);
    if(!lines.length) throw apPostingBusinessError('AP posting must create at least one journal line.');
    if(Math.round((dr-cr)*100)!==0) throw apPostingBusinessError(`AP posting is out of balance before release: debits ${dr.toFixed(2)} credits ${cr.toFixed(2)}.`);
    return {postPeriod:pp,journalLines:lines};
  }catch(error){if(!error.statusCode){error.statusCode=400;error.code=error.code||'AP_POSTING_VALIDATION';}throw error;}
}
function postApDocumentSafely(doc,{duplicateOverrideReason='',userId='admin'}={}){
  const existing=journalEntries.find(entry=>entry.module==='AP'&&entry.sourceRef===doc.id&&!entry.reversalOf);
  if(doc.posted&&existing){doc.jeNumber=existing.jeNumber;doc.journalEntryNumber=existing.jeNumber;doc.journalEntryId=existing.id||existing.jeNumber;doc.batchNumber=existing.batchNumber||'';return{document:doc,journal:existing,alreadyPosted:true};}
  if(doc.posted&&!existing) throw apPostingBusinessError(`AP document ${doc.id} is marked posted but its journal entry is missing. Posting was stopped to prevent inconsistent accounting.`,409,'AP_POSTING_INCONSISTENT');
  if(existing&&!doc.posted) throw apPostingBusinessError(`AP document ${doc.id} already has journal entry ${existing.jeNumber} but is not marked posted. Posting was stopped to prevent a duplicate journal.`,409,'AP_POSTING_PARTIAL');
  validateApPostingRequest(doc,{duplicateOverrideReason});
  const snapshot=snapshotApPostingState(),billId=doc.id,oldStatus=doc.status;
  try{
    if(['Payment','Prepayment'].includes(doc.type)) releaseApPaymentApplications(doc,doc.postDate||doc.date);
    if(doc.type==='Bill') processApBillPoMatches(doc);
    const jeNumber=postApJE(doc,false);
    doc.posted=true; doc.status=(Number(doc.balance||doc.unappliedBalance||0)===0)?'Closed':'Open';
    addWorkflowAudit({billId:doc.id,action:'Post',userId,fromStatus:oldStatus,toStatus:doc.status,comments:`Posted to AP and GL as ${jeNumber}`});
    return{document:doc,journal:journalEntries.find(entry=>entry.jeNumber===jeNumber),alreadyPosted:false};
  }catch(error){
    restoreApPostingState(snapshot);
    console.error(JSON.stringify({event:'AP_POST_ROLLBACK',billId,stage:'commit',error:error.message,code:error.code||'INTERNAL_ERROR'}));
    throw error;
  }
}


const SO_STATUSES'''
server = regex_once(
    server,
    r"function postApJE\(doc,reverse=false\)\{.*?\n\}\n\n\nconst SO_STATUSES",
    new_post_ap_block,
    'safe AP posting service'
)

single_endpoint = r''' if(method==='POST'&&pathname==='/api/ap/documents/post'){
  const {id,duplicateOverrideReason=''}=await body(req),d=apDocuments.find(x=>x.id===id); if(!d)return json(res,404,{error:'Not found'});
  const result=postApDocumentSafely(d,{duplicateOverrideReason,userId:currentUser(req).id});
  return json(res,200,{...serializeApDoc(result.document),alreadyPosted:result.alreadyPosted});
 }
'''
server = regex_once(
    server,
    r" if\(method==='POST'&&pathname==='/api/ap/documents/post'\)\{.*?return json\(res,200,serializeApDoc\(d\)\); \}\n",
    single_endpoint,
    'single AP post endpoint'
)

bulk_endpoint = r''' if(method==='POST'&&pathname==='/api/ap/release/post-selected'){
  const {ids=[],duplicateOverrideReason=''}=await body(req),results=[];
  for(const id of [...new Set(ids)]){
    const d=apDocuments.find(x=>x.id===id);
    if(!d){results.push({id,success:false,error:'Document not found'});continue;}
    try{const result=postApDocumentSafely(d,{duplicateOverrideReason,userId:currentUser(req).id});results.push({id,success:true,status:result.document.status,journalEntryNumber:result.document.journalEntryNumber||'',alreadyPosted:result.alreadyPosted});}
    catch(error){results.push({id,success:false,error:error.message,code:error.code||'AP_POSTING_ERROR'});}
  }
  const posted=results.filter(row=>row.success).length,failed=results.length-posted; return json(res,200,{posted,failed,results});
 }
'''
server = regex_once(
    server,
    r" if\(method==='POST'&&pathname==='/api/ap/release/post-selected'\)\{.*?return json\(res,200,\{posted\}\); \}\n",
    bulk_endpoint,
    'bulk AP post endpoint'
)

server_path.write_text(server)
index_path.write_text(index)
print('Applied responsive layout, journal description, and safe AP posting fixes.')
