import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedName = '.server-incoming-po-runtime.js';
const generatedPath = path.join(here, generatedName);

function replaceOnce(source, oldText, newText, label) {
  const first = source.indexOf(oldText);
  if (first < 0) throw new Error(`Incoming PO workflow integration failed: ${label} was not found.`);
  if (source.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`Incoming PO workflow integration failed: ${label} matched more than once.`);
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}

export function applyIncomingPurchaseOrderWorkflowPatch(source) {
  source = replaceOnce(
    source,
    "sourceEmail:upload.senderEmail||'',processingStatus:'RECEIVED'",
    "sourceEmail:upload.senderEmail||'',originalEmail:upload.originalEmail||((String(upload.source||'').toLowerCase().includes('email'))?{messageId:upload.messageId||upload.emailMessageId||'',from:upload.from||upload.senderEmail||'',to:upload.to||upload.recipientEmail||'',subject:upload.subject||upload.emailSubject||'',receivedAt:upload.receivedAt||upload.receivedDate||now,bodyText:upload.bodyText||upload.emailBodyText||upload.textBody||upload.body||'',bodyHtml:upload.bodyHtml||upload.emailBodyHtml||upload.htmlBody||''}:null),processingStatus:'RECEIVED'",
    'incoming email source metadata'
  );

  source = replaceOnce(
    source,
    "if(b.vendorMatch)Object.assign(r.vendorMatch,b.vendorMatch);if(b.assignedProcurementPersonUserId!==undefined)",
    `if(b.vendorMatch)Object.assign(r.vendorMatch,b.vendorMatch);
 const selectedIncomingVendor=vendors.find(v=>v.id===(r.vendorMatch?.vendorId||r.extracted?.vendorNumber));
 if(selectedIncomingVendor){r.extracted.vendorNumber=selectedIncomingVendor.id;r.extracted.vendorName=selectedIncomingVendor.name;r.vendorMatch.vendorId=selectedIncomingVendor.id;r.vendorMatch.vendorName=selectedIncomingVendor.name;}
 r.extracted.lines=Array.isArray(r.extracted.lines)?r.extracted.lines:[];
 r.poMatch=matchIncomingPo(r.extracted,selectedIncomingVendor||{id:''});
 const reviewedPoNumber=String(r.extracted.purchaseOrderNumber||r.extracted.poNumber||'').trim();
 r.exceptions=(r.exceptions||[]).filter(exception=>exception.type!=='PO Validation');
 if(reviewedPoNumber&&r.poMatch.status==='PO Not Found')r.exceptions.push({type:'PO Validation',severity:'High',message:selectedIncomingVendor?\`Purchase order \${reviewedPoNumber} does not exist, is not open for billing, or does not belong to vendor \${selectedIncomingVendor.id} - \${selectedIncomingVendor.name}.\`:\`Select a valid vendor before linking purchase order \${reviewedPoNumber}.\`});
 if(b.assignedProcurementPersonUserId!==undefined)`,
    'incoming review vendor and PO rematch'
  );

  source = replaceOnce(
    source,
    "Object.assign(r.draftBill,b.draftBill||{}); r.status=b.status||r.status;",
    `Object.assign(r.draftBill,b.draftBill||{});
 if(selectedIncomingVendor){r.draftBill.vendorId=selectedIncomingVendor.id;r.draftBill.vendorName=selectedIncomingVendor.name;}
 (r.draftBill.lines||[]).forEach(line=>{line.poNumber=r.poMatch?.poNumber||reviewedPoNumber||'';});
 r.status=b.status||r.status;`,
    'incoming draft bill PO synchronization'
  );

  source = replaceOnce(
    source,
    "if(r.billId) return json(res,200,{billId:r.billId,bill:serializeApDoc(apDocuments.find(d=>d.id===r.billId))}); const recon=incomingInvoiceReconciliation(r);",
    `if(r.billId) return json(res,200,{billId:r.billId,bill:serializeApDoc(apDocuments.find(d=>d.id===r.billId))});
 const selectedIncomingVendor=vendors.find(v=>v.id===(r.vendorMatch?.vendorId||r.extracted?.vendorNumber||r.draftBill?.vendorId)&&v.status==='Active');
 if(!selectedIncomingVendor)return json(res,400,{error:'Select a valid active vendor before creating the AP Bill.',code:'INVALID_INCOMING_VENDOR'});
 r.vendorMatch={...(r.vendorMatch||{}),vendorId:selectedIncomingVendor.id,vendorName:selectedIncomingVendor.name};
 r.extracted.vendorNumber=selectedIncomingVendor.id;r.extracted.vendorName=selectedIncomingVendor.name;r.draftBill.vendorId=selectedIncomingVendor.id;r.draftBill.vendorName=selectedIncomingVendor.name;
 const reviewedPoNumber=String(r.extracted?.purchaseOrderNumber||r.extracted?.poNumber||(r.draftBill?.lines||[]).find(line=>line.poNumber)?.poNumber||'').trim();
 if(reviewedPoNumber){
   const allowedIncomingPoStatuses=new Set(['Open','Partially Received','Partially Billed','Received']);
   const normalizedIncomingPo=reviewedPoNumber.toLowerCase();
   const matchingIncomingPo=purchaseOrders.map(po=>refreshPoStatus(po)).find(po=>(String(po.poNumber||po.id).toLowerCase()===normalizedIncomingPo||String(po.id).toLowerCase()===normalizedIncomingPo)&&po.vendorId===selectedIncomingVendor.id&&allowedIncomingPoStatuses.has(po.status));
   if(!matchingIncomingPo){
     const sameNumberPo=purchaseOrders.map(po=>refreshPoStatus(po)).find(po=>(String(po.poNumber||po.id).toLowerCase()===normalizedIncomingPo||String(po.id).toLowerCase()===normalizedIncomingPo)&&allowedIncomingPoStatuses.has(po.status));
     const error=sameNumberPo&&sameNumberPo.vendorId!==selectedIncomingVendor.id
       ?\`Purchase order \${reviewedPoNumber} belongs to \${sameNumberPo.vendorId} - \${sameNumberPo.vendorName}, not the selected vendor \${selectedIncomingVendor.id} - \${selectedIncomingVendor.name}.\`
       :\`Purchase order \${reviewedPoNumber} does not exist or is not open/eligible for AP billing.\`;
     return json(res,400,{error,code:'INVALID_VENDOR_PURCHASE_ORDER',poNumber:reviewedPoNumber,vendorId:selectedIncomingVendor.id});
   }
   r.extracted.purchaseOrderNumber=matchingIncomingPo.poNumber;r.extracted.poNumber=matchingIncomingPo.poNumber;
   r.poMatch=matchIncomingPo(r.extracted,selectedIncomingVendor);
   (r.draftBill.lines||[]).forEach(line=>{line.poNumber=matchingIncomingPo.poNumber;});
 }
 const recon=incomingInvoiceReconciliation(r);`,
    'incoming create-bill vendor PO enforcement'
  );

  source = replaceOnce(
    source,
    "r.billId=d.id; r.status='Converted'; r.processingStatus='Converted'; r.auditTrail.push({date:new Date().toISOString(),user:'ap.clerk',action:'Bill Creation',details:`AP Bill draft ${d.id} created with its source invoice PDF.`});",
    "const convertedAt=new Date().toISOString(); r.billId=d.id; r.status='Converted'; r.processingStatus='Converted'; r.convertedAt=convertedAt; r.convertedBy=currentUser(req).id; r.auditTrail.push({date:convertedAt,user:currentUser(req).id,action:'Bill Creation',details:`AP Bill draft ${d.id} created with its source invoice PDF and moved to Converted to AP Bills history.`});",
    'incoming converted history metadata'
  );

  return source;
}

export async function prepareIncomingPurchaseOrderWorkflowServer(inputModule = './server.js') {
  const inputPath = path.isAbsolute(inputModule)
    ? inputModule
    : path.join(here, String(inputModule).replace(/^\.\//, ''));
  const source = await readFile(inputPath, 'utf8');
  const patched = applyIncomingPurchaseOrderWorkflowPatch(source);
  await writeFile(generatedPath, patched, 'utf8');
  return `./${generatedName}`;
}
