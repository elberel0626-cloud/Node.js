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
    "let rows=purchaseOrders.map(p=>refreshPoStatus(p)).filter(p=>allowed.has(p.status)||billableLinesForPo(p).length>0);",
    "let rows=purchaseOrders.map(p=>refreshPoStatus(p)).filter(p=>!['Draft','Cancelled','Voided'].includes(p.status));",
    'AP PO lookup includes vendor POs before receipt');
  source=replaceOnce(source,
    "return json(res,500,{error:`The AP Bill was not created because its source PDF could not be retained: ${error.message}`});",
    "return json(res,422,{error:`The AP Bill was not created because its source PDF could not be retained: ${error.message}`,code:'INCOMING_ATTACHMENT_RETAIN_FAILED'});",
    'incoming conversion surfaces attachment error');
  return source;
}

export async function prepareApRuntimeReliabilityServer(inputModule='./server.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');const patched=applyApRuntimeReliabilityPatch(source);await writeFile(generatedPath,patched,'utf8');return `./${generatedName}`;
}
