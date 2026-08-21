import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const generatedName='.server-ar-payment-gl-applications.js';
const generatedPath=path.join(here,generatedName);

function replaceOnce(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`AR payment GL integration failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`AR payment GL integration failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

function replaceInSection(source,startMarker,endMarker,oldText,newText,label){
  const start=source.indexOf(startMarker);
  if(start<0)throw new Error(`AR payment GL integration failed: ${label} section start was not found.`);
  const end=source.indexOf(endMarker,start+startMarker.length);
  if(end<0)throw new Error(`AR payment GL integration failed: ${label} section end was not found.`);
  const section=source.slice(start,end);
  const first=section.indexOf(oldText);
  if(first<0)throw new Error(`AR payment GL integration failed: ${label} was not found.`);
  if(section.indexOf(oldText,first+oldText.length)>=0)throw new Error(`AR payment GL integration failed: ${label} matched more than once in its section.`);
  const patched=section.slice(0,first)+newText+section.slice(first+oldText.length);
  return source.slice(0,start)+patched+source.slice(end);
}

export function applyArPaymentGlApplicationsServerPatch(source){
  if(source.includes('function normalizeArPaymentGlApplications('))return source;

  source=replaceOnce(
    source,
    'function arPostingLines(doc){',
    `function normalizeArPaymentGlApplications(applications=[],cashAccount=''){
  const cashCode=String(cashAccount||'').trim().split(/\\s+/)[0];
  const rows=[];
  for(const [index,application] of (Array.isArray(applications)?applications:[]).entries()){
    const account=String(application?.account||application?.accountNumber||application?.glAccount||'').trim().split(/\\s+/)[0];
    const amount=Number(application?.amount||0);
    const description=String(application?.description||application?.memo||'').trim().slice(0,250);
    if(!account&&!amount)continue;
    if(!account)throw new Error(\`GL account is required on line \${index+1}.\`);
    const match=glAccounts.find(row=>String(row.code)===account&&row.active!==false);
    if(!match)throw new Error(\`Select a valid active GL account for line \${index+1}.\`);
    if(cashCode&&account===cashCode)throw new Error('The Apply to GL account cannot be the same as the payment cash account.');
    if(!Number.isFinite(amount)||amount<=0)throw new Error(\`GL amount must be greater than $0.00 on line \${index+1}.\`);
    rows.push({account,accountNumber:account,accountTitle:match.name||'',amount:Number(amount.toFixed(2)),description});
  }
  return rows;
}
const arPaymentGlTotal=doc=>(doc.glApplications||[]).reduce((sum,row)=>sum+Number(row.amount||0),0);
function arPostingLines(doc){`,
    'AR payment GL helper functions'
  );

  source=replaceOnce(
    source,
    `const salesOrderApplied=(doc.applications||[]).filter(a=>a.salesOrderId).reduce((s,a)=>s+Number(a.cashApplied??a.amount??0),0);
    const arApplied=Math.max(0,cash+fc+wo-salesOrderApplied);
    if(salesOrderApplied>0) lines.push({account:POSTING_ACCOUNTS.customerDeposits,debit:0,credit:salesOrderApplied,sourceReference:doc.id});
    if(arApplied>0) lines.push({account:POSTING_ACCOUNTS.accountsReceivable,debit:0,credit:arApplied,sourceReference:doc.id});`,
    `const salesOrderApplied=(doc.applications||[]).filter(a=>a.salesOrderId).reduce((s,a)=>s+Number(a.cashApplied??a.amount??0),0);
    const glApplications=normalizeArPaymentGlApplications(doc.glApplications||[],doc.cashAccount||POSTING_ACCOUNTS.arCash);
    const glApplied=glApplications.reduce((sum,row)=>sum+Number(row.amount||0),0);
    const availableForOffsets=cash+fc+wo;
    if(salesOrderApplied+glApplied>availableForOffsets+0.005) throw new Error('AR, sales order, and GL applications exceed the available payment amount.');
    const arApplied=Math.max(0,availableForOffsets-salesOrderApplied-glApplied);
    if(salesOrderApplied>0) lines.push({account:POSTING_ACCOUNTS.customerDeposits,debit:0,credit:salesOrderApplied,sourceReference:doc.id});
    for(const row of glApplications) lines.push({account:requireAccount(row.account,'AR payment GL application account'),debit:0,credit:Number(row.amount||0),sourceReference:doc.id,lineDescription:row.description||'AR payment applied directly to GL'});
    if(arApplied>0) lines.push({account:POSTING_ACCOUNTS.accountsReceivable,debit:0,credit:arApplied,sourceReference:doc.id});`,
    'AR payment posting offsets'
  );

  source=replaceInSection(
    source,
    "if(method==='POST'&&pathname==='/api/ar/documents'){",
    "if(method==='PUT'&&pathname.startsWith('/api/ar/documents/'))",
    `applications:b.applications||[],method:b.method,checkNumber:b.checkNumber,cashAccount:b.cashAccount||'1079',financeChargeAmount:Number(b.financeChargeAmount||0),writeOffAmount:Number(b.writeOffAmount||0)};`,
    `applications:b.applications||[],glApplications:b.glApplications||[],method:b.method,checkNumber:b.checkNumber,cashAccount:b.cashAccount||'1079',financeChargeAmount:Number(b.financeChargeAmount||0),writeOffAmount:Number(b.writeOffAmount||0)};`,
    'AR payment stored GL applications'
  );

  source=replaceInSection(
    source,
    "if(method==='POST'&&pathname==='/api/ar/documents'){",
    "if(method==='PUT'&&pathname.startsWith('/api/ar/documents/'))",
    `if(doc.type==='Payment'){ if(!doc.date) return json(res,400,{error:'Payment date required'});`,
    `if(doc.type==='Payment'){ try{doc.glApplications=normalizeArPaymentGlApplications(doc.glApplications||[],doc.cashAccount);}catch(error){return json(res,400,{error:error.message});} if(!doc.date) return json(res,400,{error:'Payment date required'});`,
    'AR payment create GL validation'
  );

  source=replaceInSection(
    source,
    "if(method==='POST'&&pathname==='/api/ar/documents'){",
    "if(method==='PUT'&&pathname.startsWith('/api/ar/documents/'))",
    `const totalApplied=(doc.applications||[]).reduce((s,a)=>s+Number(a.amount||0),0); const totalAvail=Number(doc.amount||0)+Number(doc.financeChargeAmount||0)+Number(doc.writeOffAmount||0); if(totalApplied>totalAvail) return json(res,400,{error:'Total applied cannot exceed available payment amount'});`,
    `const arDocumentApplied=(doc.applications||[]).reduce((s,a)=>s+Number(a.amount||0),0); const glApplied=arPaymentGlTotal(doc); const totalApplied=arDocumentApplied+glApplied; const totalAvail=Number(doc.amount||0)+Number(doc.financeChargeAmount||0)+Number(doc.writeOffAmount||0); if(totalApplied>totalAvail+0.005) return json(res,400,{error:'Total AR and GL applied amount cannot exceed the available payment amount'});`,
    'AR payment create applied total'
  );

  source=replaceInSection(
    source,
    "if(method==='PUT'&&pathname.startsWith('/api/ar/documents/'))",
    "if(method==='DELETE'&&pathname.startsWith('/api/ar/documents/'))",
    `const b=await body(req); if(d.type==='Payment'&&b.amount!==undefined&&Number(b.amount)<=0) return json(res,400,{error:'Payment amount must be greater than $0.00.'});`,
    `const b=await body(req); if(d.type==='Payment'&&b.amount!==undefined&&Number(b.amount)<=0) return json(res,400,{error:'Payment amount must be greater than $0.00.'}); if(d.type==='Payment'){try{b.glApplications=normalizeArPaymentGlApplications(b.glApplications??d.glApplications??[],b.cashAccount??d.cashAccount);}catch(error){return json(res,400,{error:error.message});} const nextApplications=Array.isArray(b.applications)?b.applications:(d.applications||[]); const nextAvailable=Number(b.amount??d.amount??0)+Number(b.financeChargeAmount??d.financeChargeAmount??0)+Number(b.writeOffAmount??d.writeOffAmount??0); const nextApplied=nextApplications.reduce((sum,row)=>sum+Number(row.amount||0),0)+b.glApplications.reduce((sum,row)=>sum+Number(row.amount||0),0); if(nextApplied>nextAvailable+0.005)return json(res,400,{error:'Total AR and GL applied amount cannot exceed the available payment amount'});}`,
    'AR payment update GL validation'
  );

  source=replaceInSection(
    source,
    "if(method==='POST'&&pathname==='/api/ar/documents/post'){",
    "if(method==='POST'&&pathname==='/api/ar/documents/void')",
    `d.unappliedBalance=(Number(d.amount||0)+Number(d.financeChargeAmount||0)+Number(d.writeOffAmount||0))-totalApplied;`,
    `d.unappliedBalance=(Number(d.amount||0)+Number(d.financeChargeAmount||0)+Number(d.writeOffAmount||0))-totalApplied-arPaymentGlTotal(d);`,
    'AR payment posted unapplied balance'
  );

  return source;
}

export async function prepareArPaymentGlApplicationsServer(inputModule='./server.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyArPaymentGlApplicationsServerPatch(source);
  await writeFile(generatedPath,patched,'utf8');
  return `./${generatedName}`;
}
