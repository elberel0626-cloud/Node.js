import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const generatedName='.server-ap-incoming-conversion-runtime.js';
const generatedPath=path.join(here,generatedName);

function replaceRange(source,startMarker,endMarker,replacement,label){
  const start=source.indexOf(startMarker);
  if(start<0)throw new Error(`AP incoming conversion integration failed: ${label} start marker was not found.`);
  if(source.indexOf(startMarker,start+startMarker.length)>=0)throw new Error(`AP incoming conversion integration failed: ${label} start marker matched more than once.`);
  const end=source.indexOf(endMarker,start);
  if(end<0)throw new Error(`AP incoming conversion integration failed: ${label} end marker was not found.`);
  return source.slice(0,start)+replacement+source.slice(end+endMarker.length);
}

const conversionBlock=String.raw` const vendor=selectedIncomingVendor||vendors.find(v=>v.id===(r.vendorMatch?.vendorId||r.extracted?.vendorNumber||r.draftBill?.vendorId));
 const approverUserId=transactionApproverId({overrideUserId:r.approverUserId,vendor});
 const currentPoNumber=String(r.extracted?.purchaseOrderNumber||r.extracted?.poNumber||r.poMatch?.poNumber||(r.draftBill?.lines||[]).find(line=>line.poNumber)?.poNumber||'').trim();
 const currentPo=currentPoNumber?purchaseOrders.find(po=>(po.poNumber===currentPoNumber||po.id===currentPoNumber)&&po.vendorId===vendor.id):null;
 const currentPoLines=currentPo?purchaseOrderLines.filter(line=>line.poId===currentPo.id):[];
 const reviewedSourceLines=(Array.isArray(r.extracted?.lines)&&r.extracted.lines.length?r.extracted.lines:Array.isArray(r.draftBill?.lines)?r.draftBill.lines:[]);
 const reviewedBillLines=reviewedSourceLines.map((line,index)=>{
   const inventoryId=String(line.inventoryId||line.itemCode||'').trim();
   const poLine=currentPoLines.find(candidate=>String(candidate.id)===String(line.poLineId||''))||currentPoLines.find(candidate=>String(candidate.lineNumber)===String(line.poLineNumber||''))||currentPoLines.find(candidate=>inventoryId&&candidate.inventoryId===inventoryId)||currentPoLines[index]||null;
   const qty=Number(line.qty??line.quantity??1);
   const rawExtended=Number(line.extendedAmount??line.extendedCost??line.lineAmount??0);
   const unitCost=Number(line.unitPrice??line.unitCost??(qty?rawExtended/qty:rawExtended)??0);
   const extendedCost=Number(line.extendedAmount??line.extendedCost??(qty*unitCost)??0);
   const discountAmount=Number(line.discount??line.discountAmount??0);
   return {...line,inventoryId:inventoryId||poLine?.inventoryId||'',description:line.lineDescription||line.description||poLine?.description||'',qty,uom:line.uom||poLine?.uom||'EA',unitCost,extendedCost,discountAmount,amount:Number(line.lineAmount??(extendedCost-discountAmount)??0),expenseAccount:line.glAccountSuggestion||line.expenseAccount||poLine?.apAccrualAccount||poLine?.expenseAccount||'5110',branch:line.branch||r.extracted?.branch||r.draftBill?.branch||'100',warehouse:line.warehouse||poLine?.warehouse||r.draftBill?.warehouse||'MAIN',location:line.location||poLine?.location||'MAIN-A1',taxCategory:line.taxCategory||'',poNumber:currentPo?.poNumber||'',poLineId:poLine?.id||'',receiptNumber:line.receiptNumber||''};
 });
 const billDate=r.extracted?.invoiceDate||r.draftBill?.date||new Date().toISOString().slice(0,10);
 const billAmount=Number(r.extracted?.grossInvoiceAmount??r.extracted?.totalAmount??r.draftBill?.amount??0);
 const incomingBillId='BILL-'+String(apDocuments.length+1001).padStart(4,'0');
 const d={...r.draftBill,vendorId:vendor.id,vendorName:vendor.name,approverUserId,type:'Bill',date:billDate,postDate:billDate,postPeriod:periodFromDate(billDate),dueDate:r.extracted?.dueDate||r.draftBill?.dueDate||billDate,terms:r.extracted?.paymentTerms||r.extracted?.terms||r.draftBill?.terms||vendor.terms||'NET30',vendorRef:r.extracted?.invoiceNumber||r.draftBill?.vendorRef||'',invoiceNumber:r.extracted?.invoiceNumber||r.draftBill?.invoiceNumber||'',description:r.extracted?.description||r.draftBill?.description||'Created from Incoming Documents verification',currency:r.extracted?.currency||r.draftBill?.currency||vendor.currency||'USD',branch:r.extracted?.branch||r.draftBill?.branch||'100',department:r.extracted?.department||r.draftBill?.department||'',taxTotal:Number(r.extracted?.taxAmount??r.draftBill?.taxTotal??0),freight:Number(r.extracted?.freightAmount??r.draftBill?.freight??0),amount:billAmount,balance:billAmount,lines:reviewedBillLines,matchedPoNumber:currentPo?.poNumber||'',id:incomingBillId,status:'Saved',approvalStatus:NOT_SUBMITTED,billApprovalStatus:NOT_SUBMITTED,source:'Incoming Documents',incomingDocumentId:r.id,fileHash:r.fileHash,attachmentName:'',invoicePdfAttached:false,attachments:[],approvals:[],history:[]};
 const incomingMatch=evaluatePoThreeWayMatch(d);d.matchStatus=incomingMatch.status;d.threeWayMatchStatus=incomingMatch.status;
 apDocuments.push(d);`;

export function applyApIncomingConversionPatch(source){
  const start=" const vendor=vendors.find(v=>v.id===(r.vendorMatch?.vendorId||r.draftBill?.vendorId)),approverUserId=transactionApproverId({overrideUserId:r.approverUserId,vendor}); const d=";
  const end=" apDocuments.push(d);";
  return replaceRange(source,start,end,conversionBlock,'reviewed incoming AP Bill rebuild');
}

export async function prepareApIncomingConversionServer(inputModule='./server.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyApIncomingConversionPatch(source);
  await writeFile(generatedPath,patched,'utf8');
  return `./${generatedName}`;
}