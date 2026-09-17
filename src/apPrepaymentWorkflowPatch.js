import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedName = '.server-ap-prepayment-workflow-runtime.js';
const generatedPath = path.join(here, generatedName);

function replaceIfPresent(source, oldText, newText) {
  if (source.includes(newText)) return source;
  if (!source.includes(oldText)) return source;
  return source.replace(oldText, newText);
}

export function applyApPrepaymentWorkflowPatch(source) {
  source = replaceIfPresent(
    source,
    "applications:b.applications||[],history:b.history||[],approvals:b.approvals||[],lines:b.lines||[],source:'Manual'};",
    "applications:b.applications||[],history:b.history||[],approvals:b.approvals||[],lines:b.lines||[],source:'Manual',sourcePoId:b.sourcePoId||'',sourcePoNumber:b.sourcePoNumber||b.poNumber||''};"
  );

  source = replaceIfPresent(
    source,
    "if(action==='approve')approveBill(d,b);else if(action==='reject')rejectBill(d,b);",
    "if(action==='approve'){if(d.type==='Prepayment')approvePayment(d,b);else approveBill(d,b);}else if(action==='reject')rejectBill(d,b);"
  );

  if (!source.includes('function syncPostedApPrepaymentToPo(')) {
    const marker = ' // AP APIs';
    const helper = `
function syncPostedApPrepaymentToPo(doc){
  if(!doc||doc.type!=='Prepayment'||!doc.posted)return;
  const poRef=String(doc.sourcePoId||doc.sourcePoNumber||'').trim();
  if(!poRef)return;
  const po=purchaseOrders.find(row=>row.id===poRef||row.poNumber===poRef);
  if(!po||po.vendorId!==doc.vendorId)return;
  const linkedJournal=journalEntries.find(entry=>entry.module==='AP'&&entry.sourceRef===doc.id&&!entry.reversalOf);
  let row=poPrepayments.find(item=>item.apDocumentId===doc.id||item.id===doc.id);
  const values={
    id:doc.id,
    prepaymentNumber:doc.id,
    apDocumentId:doc.id,
    vendorId:doc.vendorId,
    vendorName:doc.vendorName,
    poId:po.id,
    poNumber:po.poNumber,
    paymentDate:doc.date,
    postDate:doc.postDate||doc.date,
    postPeriod:doc.postPeriod||periodFromDate(doc.postDate||doc.date),
    paymentMethod:doc.method||'',
    cashAccount:doc.cashAccount||POSTING_ACCOUNTS.apCash,
    amount:Number(doc.amount||0),
    appliedAmount:Number(row?.appliedAmount||0),
    remainingBalance:Math.max(0,Number(doc.amount||0)-Number(row?.appliedAmount||0)),
    status:doc.status,
    description:doc.description||'',
    jeReference:doc.journalEntryNumber||doc.jeNumber||linkedJournal?.jeNumber||''
  };
  if(row)Object.assign(row,values);else poPrepayments.push(values);
  recalcPo(po);
}
`;
    if (source.includes(marker)) source = source.replace(marker, helper + '\n' + marker);
  }

  source = replaceIfPresent(
    source,
    "const result=postApDocumentSafely(d,{duplicateOverrideReason,userId:currentUser(req).id});\n  return json(res,200,{...serializeApDoc(result.document),alreadyPosted:result.alreadyPosted});",
    "const result=postApDocumentSafely(d,{duplicateOverrideReason,userId:currentUser(req).id});\n  syncPostedApPrepaymentToPo(result.document);\n  return json(res,200,{...serializeApDoc(result.document),alreadyPosted:result.alreadyPosted});"
  );

  return source;
}

export async function prepareApPrepaymentWorkflowServer(inputModule = './server.js') {
  const inputPath = path.isAbsolute(inputModule) ? inputModule : path.join(here, String(inputModule).replace(/^\.\//, ''));
  const source = await readFile(inputPath, 'utf8');
  const patched = applyApPrepaymentWorkflowPatch(source);
  await writeFile(generatedPath, patched, 'utf8');
  return `./${generatedName}`;
}
