import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const generatedName='.server-ap-runtime-reliability.js';
const generatedPath=path.join(here,generatedName);
function replaceOnce(source,oldText,newText,label){const at=source.indexOf(oldText);if(at<0)throw new Error(`AP runtime reliability integration failed: ${label} was not found.`);if(source.indexOf(oldText,at+oldText.length)>=0)throw new Error(`AP runtime reliability integration failed: ${label} matched more than once.`);return source.slice(0,at)+newText+source.slice(at+oldText.length);}

export function applyApRuntimeReliabilityPatch(source){
  source=replaceOnce(source,
    " if(method==='PUT'&&pathname.startsWith('/api/ap/incoming-documents/')){ const id=pathname.split('/').pop(); const r=apIncomingVendorBills.find(x=>x.id===id); if(!r) return json(res,404,{error:'Incoming document not found'}); const b=await body(req); const before={...r.extracted};",
    " if(method==='PUT'&&pathname.startsWith('/api/ap/incoming-documents/')){ const id=pathname.split('/').pop(); const r=apIncomingVendorBills.find(x=>x.id===id); if(!r) return json(res,404,{error:'Incoming document not found'}); r.extracted=r.extracted||{}; r.vendorMatch=r.vendorMatch||{}; r.draftBill=r.draftBill||{}; r.exceptions=Array.isArray(r.exceptions)?r.exceptions:[]; r.auditTrail=Array.isArray(r.auditTrail)?r.auditTrail:[]; const b=await body(req); const before={...r.extracted};",
    'incoming review state initialization');
  source=replaceOnce(source,
    "Object.assign(r.extracted,b.extracted||{}); if(b.vendorMatch)Object.assign(r.vendorMatch,b.vendorMatch);",
    "const submittedExtracted=b.extracted||{}; Object.assign(r.extracted,submittedExtracted); const submittedPoField=Object.prototype.hasOwnProperty.call(submittedExtracted,'purchaseOrderNumber')?'purchaseOrderNumber':Object.prototype.hasOwnProperty.call(submittedExtracted,'poNumber')?'poNumber':''; if(submittedPoField){const submittedPo=String(submittedExtracted[submittedPoField]||'').trim();r.extracted.purchaseOrderNumber=submittedPo;r.extracted.poNumber=submittedPo;if(!submittedPo){r.poMatch={status:'No PO',poNumber:'',poId:'',matchType:'Non-PO'};r.exceptions=r.exceptions.filter(exception=>exception.type!=='PO Validation');(r.draftBill.lines||[]).forEach(line=>{line.poNumber='';line.poLineId='';line.receiptNumber='';});}} if(b.vendorMatch)Object.assign(r.vendorMatch,b.vendorMatch);",
    'incoming review canonical PO fields');
  source=replaceOnce(source,
    "r.poMatch=matchIncomingPo(r.extracted,selectedIncomingVendor||{id:''});\n const reviewedPoNumber=String(r.extracted.purchaseOrderNumber||r.extracted.poNumber||'').trim();",
    "const reviewedPoNumber=String(r.extracted.purchaseOrderNumber??r.extracted.poNumber??'').trim();\n r.poMatch=reviewedPoNumber?matchIncomingPo(r.extracted,selectedIncomingVendor||{id:''}):{status:'No PO',poNumber:'',poId:'',matchType:'Non-PO'};",
    'blank incoming PO bypasses PO matching');
  source=replaceOnce(source,
    "const reviewedPoNumber=String(r.extracted?.purchaseOrderNumber||r.extracted?.poNumber||(r.draftBill?.lines||[]).find(line=>line.poNumber)?.poNumber||'').trim();",
    "const reviewedPoNumber=Object.prototype.hasOwnProperty.call(r.extracted||{},'purchaseOrderNumber')?String(r.extracted.purchaseOrderNumber||'').trim():String(r.extracted?.poNumber||(r.draftBill?.lines||[]).find(line=>line.poNumber)?.poNumber||'').trim(); if(!reviewedPoNumber){r.extracted.purchaseOrderNumber='';r.extracted.poNumber='';r.poMatch={status:'No PO',poNumber:'',poId:'',matchType:'Non-PO'};(r.draftBill?.lines||[]).forEach(line=>{line.poNumber='';line.poLineId='';line.receiptNumber='';});}",
    'create bill honors explicitly blank PO');
  source=replaceOnce(source,
    "const currentPoNumber=String(r.extracted?.purchaseOrderNumber||r.extracted?.poNumber||r.poMatch?.poNumber||(r.draftBill?.lines||[]).find(line=>line.poNumber)?.poNumber||'').trim();",
    "const currentPoNumber=Object.prototype.hasOwnProperty.call(r.extracted||{},'purchaseOrderNumber')?String(r.extracted.purchaseOrderNumber||'').trim():String(r.extracted?.poNumber||r.poMatch?.poNumber||(r.draftBill?.lines||[]).find(line=>line.poNumber)?.poNumber||'').trim();",
    'incoming bill rebuild honors explicitly blank PO');
  source=replaceOnce(source,
    "return json(res,500,{error:`The AP Bill was not created because its source PDF could not be retained: ${error.message}`});",
    "return json(res,422,{error:`The AP Bill was not created because its source PDF could not be retained: ${error.message}`,code:'INCOMING_ATTACHMENT_RETAIN_FAILED'});",
    'incoming conversion surfaces attachment error');
  source=replaceOnce(source,
    "if(lineAmount) lines.push({account:expenseAccount,debit:lineAmount,credit:0,sourceReference:doc.id,lineDescription:apPostingLineDescription(doc,line),branch:line.branch||branch});",
    "if(lineAmount) lines.push({account:expenseAccount,debit:lineAmount>0?lineAmount:0,credit:lineAmount<0?Math.abs(lineAmount):0,sourceReference:doc.id,lineDescription:apPostingLineDescription(doc,line),branch:line.branch||branch});",
    'signed AP bill lines use conventional GL debit credit sides');
  return source;
}

export async function prepareApRuntimeReliabilityServer(inputModule='./server.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');const patched=applyApRuntimeReliabilityPatch(source);await writeFile(generatedPath,patched,'utf8');return `./${generatedName}`;
}
