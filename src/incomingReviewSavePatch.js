import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const generatedName='.server-incoming-review-save-runtime.js';
const generatedPath=path.join(here,generatedName);

function replaceOnce(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`Incoming review save integration failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Incoming review save integration failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyIncomingReviewSavePatch(source){
  source=replaceOnce(
    source,
    "const requestedClassification=b.invoiceClassification||r.invoiceClassification||r.draftBill.invoiceClassification,po=purchaseOrders.find(item=>item.poNumber===(r.extracted.purchaseOrderNumber||r.extracted.poNumber)),receipts=purchaseReceipts.filter(receipt=>receipt.poId===po?.id),evaluation=evaluateApInvoice",
    "if(!reviewedPoNumber){b.invoiceClassification='';r.invoiceClassification='';r.classificationOverrideReason='';r.draftBill.invoiceClassification='';r.draftBill.classificationOverrideReason='';} const requestedClassification=b.invoiceClassification||r.invoiceClassification||r.draftBill.invoiceClassification,po=purchaseOrders.find(item=>item.poNumber===(r.extracted.purchaseOrderNumber||r.extracted.poNumber)),receipts=purchaseReceipts.filter(receipt=>receipt.poId===po?.id),evaluation=evaluateApInvoice",
    'blank PO clears stale incoming classification before re-evaluation'
  );
  return source;
}

export async function prepareIncomingReviewSaveServer(inputModule='./server.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyIncomingReviewSavePatch(source);
  await writeFile(generatedPath,patched,'utf8');
  return `./${generatedName}`;
}
