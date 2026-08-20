import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const generatedName='.server-po-reporting-runtime.js';
const generatedPath=path.join(here,generatedName);

function replaceOnce(source,oldText,newText,label){
 const first=source.indexOf(oldText);
 if(first<0)throw new Error(`Purchase Order reporting integration failed: ${label} was not found.`);
 if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Purchase Order reporting integration failed: ${label} matched more than once.`);
 return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

const operationalReportingBlock=String.raw`
function poReportMoney(value){return Number(Number(value||0).toFixed(2));}
function poReportDaysSince(value){if(!value)return 0;const date=new Date(value);if(Number.isNaN(date.getTime()))return 0;return Math.max(0,Math.floor((Date.now()-date.getTime())/86400000));}
function poReportPrepaymentSummary(po){
 const rows=poPrepayments.filter(row=>row.poId===po.id&&row.status!=='Voided');
 let total=0,applied=0,available=0;
 for(const row of rows){
  const amount=Number(row.amount||0),applications=poPrepaymentApplications.filter(item=>item.prepaymentId===row.id).reduce((sum,item)=>sum+Number(item.appliedAmount||0),0),used=Number(row.appliedAmount??applications),remaining=row.remainingBalance===undefined?Math.max(0,amount-used):Math.max(0,Number(row.remainingBalance||0));
  total+=amount;applied+=used;available+=remaining;
 }
 return{prepaymentCount:rows.length,prepaymentNumbers:rows.map(row=>row.prepaymentNumber||row.id).filter(Boolean),prepaymentTotal:poReportMoney(total),prepaymentApplied:poReportMoney(applied),prepaymentAvailable:poReportMoney(available)};
}
function buildPurchaseOperationalReports(){
 purchaseOrders.forEach(po=>refreshPoStatus(po,'Receipt Completion Status','Automatically close fully received purchase orders.'));
 for(const poLine of purchaseOrderLines){try{synchronizeReceiptBilledQuantities(poLine);}catch{}}
 const activeReceipts=purchaseReceipts.filter(receipt=>!['Voided','Cancelled'].includes(receipt.status));
 const receiptLines=[];
 for(const receipt of activeReceipts){
  const po=purchaseOrders.find(row=>row.id===receipt.poId)||{};
  for(const line of purchaseReceiptLines.filter(row=>row.receiptId===receipt.id)){
   const poLine=purchaseOrderLines.find(row=>row.id===line.poLineId),qtyReceived=Math.max(0,Number(line.receiptQty||0)),qtyVouched=Math.min(qtyReceived,Math.max(0,Number(line.qtyBilled||0))),unitCost=Number(line.unitCost??poLine?.unitCost??0),receivedAmount=poReportMoney(qtyReceived*unitCost),vouchedAtReceiptCost=poReportMoney(qtyVouched*unitCost),receivedNotVouchedAmount=poReportMoney(Math.max(0,receivedAmount-vouchedAtReceiptCost));
   receiptLines.push({receiptId:receipt.id,receiptNumber:receipt.receiptNumber||receipt.id,receiptDate:receipt.receiptDate||receipt.postDate||'',poId:po.id||line.poId,poNumber:po.poNumber||line.poId,vendorId:po.vendorId||receipt.vendorId||'',vendorName:po.vendorName||receipt.vendorName||'',poStatus:po.status||'',poLineId:line.poLineId,lineNumber:line.lineNumber,inventoryId:line.inventoryId||poLine?.inventoryId||'',description:line.description||poLine?.description||'',qtyReceived,qtyVouched,qtyReceivedNotVouched:Math.max(0,qtyReceived-qtyVouched),uom:line.uom||poLine?.uom||'',unitCost,receivedAmount,vouchedAtReceiptCost,receivedNotVouchedAmount,rniAccount:poLine?.apAccrualAccount||'',ageDays:receivedNotVouchedAmount>0.004?poReportDaysSince(receipt.receiptDate||receipt.postDate):0});
  }
 }
 const reconciliation=purchaseOrders.map(po=>{
  refreshPoStatus(po,'Receipt Completion Status','');
  const poLines=purchaseOrderLines.filter(line=>line.poId===po.id),effectiveOrderedQty=poLines.reduce((sum,line)=>sum+Math.max(0,Number(line.qtyOrdered||0)-Number(line.qtyCancelled||0)),0),receivedQty=poLines.reduce((sum,line)=>sum+Number(line.qtyReceived||0),0),vouchedQty=poLines.reduce((sum,line)=>sum+Math.max(0,Number(line.qtyBilled||0)-Number(line.qtyVarianceBilled||0)),0),unreceivedCommitment=poReportMoney(poLines.reduce((sum,line)=>sum+Math.max(0,Number(line.qtyOrdered||0)-Number(line.qtyCancelled||0)-Number(line.qtyReceived||0))*Number(line.unitCost||0),0));
  const poReceiptLines=receiptLines.filter(line=>line.poId===po.id),receivedAmount=poReportMoney(poReceiptLines.reduce((sum,line)=>sum+line.receivedAmount,0)),vouchedAtReceiptCost=poReportMoney(poReceiptLines.reduce((sum,line)=>sum+line.vouchedAtReceiptCost,0)),receivedNotVouchedAmount=poReportMoney(poReceiptLines.reduce((sum,line)=>sum+line.receivedNotVouchedAmount,0)),receiptNumbers=[...new Set(poReceiptLines.map(line=>line.receiptNumber).filter(Boolean))],receiptDates=poReceiptLines.map(line=>line.receiptDate).filter(Boolean).sort(),oldestRnvAgeDays=Math.max(0,...poReceiptLines.filter(line=>line.receivedNotVouchedAmount>0.004).map(line=>line.ageDays));
  const billLinks=poBillLinks.filter(link=>link.poId===po.id),billIds=[...new Set(billLinks.map(link=>link.billId).filter(Boolean))],billDocs=billIds.map(id=>apDocuments.find(doc=>doc.id===id)).filter(Boolean),invoiceNumbers=billDocs.map(doc=>doc.invoiceNumber||doc.vendorRef||doc.id).filter(Boolean),invoiceAmount=poReportMoney(billLinks.reduce((sum,link)=>sum+Number(link.billAmount||0),0)),prepayment=poReportPrepaymentSummary(po),requiresReceipt=typeof poReceiptRequired==='function'?poReceiptRequired(po):(purchaseOrderTypes.find(type=>type.id===po.poType)?.requireReceipt!==false);
  const rnvStatus=receivedNotVouchedAmount>0.004?(vouchedAtReceiptCost>0?'Partially Vouched':'Received Not Vouched'):(receivedAmount>0?'Fully Vouched':'Not Received'),prepaymentStatus=prepayment.prepaymentTotal<=0.004?'None':prepayment.prepaymentAvailable<=0.004?'Fully Applied':prepayment.prepaymentApplied>0.004?'Partially Applied':'Available';
  return{poId:po.id,poNumber:po.poNumber,vendorId:po.vendorId,vendorName:po.vendorName,poType:po.poType,poStatus:po.status,orderDate:po.orderDate||'',requestedDate:po.requestedDate||'',poTotal:poReportMoney(po.poTotal),requiresReceipt,effectiveOrderedQty,receivedQty,vouchedQty,receivedAmount,vouchedAtReceiptCost,receivedNotVouchedAmount,unreceivedCommitment,invoiceAmount,receiptCount:receiptNumbers.length,receiptNumbers,firstReceiptDate:receiptDates[0]||'',lastReceiptDate:receiptDates.at(-1)||'',billCount:billIds.length,billIds,invoiceNumbers,oldestRnvAgeDays,rnvStatus,prepaymentStatus,...prepayment};
 });
 const receivedNotVouched=reconciliation.filter(row=>row.receivedNotVouchedAmount>0.004).sort((a,b)=>b.oldestRnvAgeDays-a.oldestRnvAgeDays||b.receivedNotVouchedAmount-a.receivedNotVouchedAmount);
 const prepaymentExposure=reconciliation.filter(row=>row.prepaymentTotal>0.004).map(row=>({...row,exposureStatus:row.prepaymentAvailable>0.004?(row.receivedNotVouchedAmount>0.004?'Prepaid + Received Not Vouched':row.receivedAmount<=0.004?'Prepaid - Awaiting Receipt':'Available Prepayment'):'Fully Applied'})).sort((a,b)=>b.prepaymentAvailable-a.prepaymentAvailable);
 const exceptions=[];
 for(const row of reconciliation){
  if(row.receivedNotVouchedAmount>0.004)exceptions.push({severity:row.oldestRnvAgeDays>30?'High':'Medium',exceptionType:'Received Not Vouched',poNumber:row.poNumber,vendorName:row.vendorName,poStatus:row.poStatus,receiptReferences:row.receiptNumbers.join(', '),invoiceReferences:row.invoiceNumbers.join(', '),amount:row.receivedNotVouchedAmount,details:'Received value remains unvouched'+(row.oldestRnvAgeDays?' for up to '+row.oldestRnvAgeDays+' day(s)':'')+'.'});
  if(row.requiresReceipt&&row.receivedQty+0.000001<row.effectiveOrderedQty&&row.receivedQty>0)exceptions.push({severity:'Medium',exceptionType:'Partial Receipt',poNumber:row.poNumber,vendorName:row.vendorName,poStatus:row.poStatus,receiptReferences:row.receiptNumbers.join(', '),invoiceReferences:row.invoiceNumbers.join(', '),amount:row.unreceivedCommitment,details:poReportMoney(row.effectiveOrderedQty-row.receivedQty)+' ordered unit(s) remain unreceived.'});
  if(row.prepaymentAvailable>0.004&&row.poStatus==='Closed')exceptions.push({severity:'High',exceptionType:'Closed PO with Unused Prepayment',poNumber:row.poNumber,vendorName:row.vendorName,poStatus:row.poStatus,receiptReferences:row.receiptNumbers.join(', '),invoiceReferences:row.invoiceNumbers.join(', '),amount:row.prepaymentAvailable,details:'Vendor deposit remains available after the purchase order closed.'});
  if(row.requiresReceipt&&row.invoiceAmount>row.receivedAmount+Math.max(0.01,Number(poSettings.amountTolerance||0)))exceptions.push({severity:'High',exceptionType:'Voucher Exceeds Receipt',poNumber:row.poNumber,vendorName:row.vendorName,poStatus:row.poStatus,receiptReferences:row.receiptNumbers.join(', '),invoiceReferences:row.invoiceNumbers.join(', '),amount:poReportMoney(row.invoiceAmount-row.receivedAmount),details:'Posted voucher amount exceeds received value beyond the configured amount tolerance.'});
 }
 for(const line of purchaseOrderLines){const effective=Math.max(0,Number(line.qtyOrdered||0)-Number(line.qtyCancelled||0));if(Number(line.qtyReceived||0)>effective+0.000001){const po=purchaseOrders.find(row=>row.id===line.poId)||{};exceptions.push({severity:'High',exceptionType:'Over Receipt',poNumber:po.poNumber||line.poId,vendorName:po.vendorName||'',poStatus:po.status||'',receiptReferences:receiptLines.filter(row=>row.poLineId===line.id).map(row=>row.receiptNumber).filter((value,index,array)=>array.indexOf(value)===index).join(', '),invoiceReferences:'',amount:poReportMoney((Number(line.qtyReceived||0)-effective)*Number(line.unitCost||0)),details:'Line '+line.lineNumber+': received quantity exceeds effective ordered quantity.'});}}
 const totals={poCount:reconciliation.length,poCountWithRnv:receivedNotVouched.length,receivedAmount:poReportMoney(reconciliation.reduce((sum,row)=>sum+row.receivedAmount,0)),vouchedAtReceiptCost:poReportMoney(reconciliation.reduce((sum,row)=>sum+row.vouchedAtReceiptCost,0)),receivedNotVouchedAmount:poReportMoney(receivedNotVouched.reduce((sum,row)=>sum+row.receivedNotVouchedAmount,0)),prepaymentTotal:poReportMoney(reconciliation.reduce((sum,row)=>sum+row.prepaymentTotal,0)),prepaymentAvailable:poReportMoney(reconciliation.reduce((sum,row)=>sum+row.prepaymentAvailable,0)),exceptionCount:exceptions.length};
 return{asOf:new Date().toISOString(),totals,receivedNotVouched,receivedNotVouchedLines:receiptLines.filter(line=>line.receivedNotVouchedAmount>0.004),reconciliation,prepaymentExposure,exceptions};
}
`;

export function applyPurchaseOrderReportingPatch(source){
 source=replaceOnce(source,
`function refreshPoStatus(po, action='Refresh Status', note=''){
  const lines=purchaseOrderLines.filter(l=>l.poId===po.id);
  if(['Draft','Saved','Closed','Cancelled','Voided'].includes(po.status)) return recalcPo(po);
  const ordered=lines.reduce((s,l)=>s+Math.max(0,Number(l.qtyOrdered||0)-Number(l.qtyCancelled||0)),0);
  const received=lines.reduce((s,l)=>s+Number(l.qtyReceived||0),0);
  let next='Open';
  if(ordered>0&&received>=ordered) next='Received';
  else if(received>0) next='Partially Received';
  if(po.status!==next) setPoStatus(po,next,action,note);
  return recalcPo(po);
}`,
`function refreshPoStatus(po, action='Refresh Status', note=''){
  const lines=purchaseOrderLines.filter(l=>l.poId===po.id);
  if(['Draft','Saved','Cancelled','Voided'].includes(po.status)) return recalcPo(po);
  const receiptRequired=typeof poReceiptRequired==='function'?poReceiptRequired(po):(purchaseOrderTypes.find(type=>type.id===po.poType)?.requireReceipt!==false);
  const ordered=lines.reduce((s,l)=>s+Math.max(0,Number(l.qtyOrdered||0)-Number(l.qtyCancelled||0)),0);
  const received=lines.reduce((s,l)=>s+Number(l.qtyReceived||0),0);
  const billed=lines.reduce((s,l)=>s+Math.max(0,Number(l.qtyBilled||0)-Number(l.qtyVarianceBilled||0)),0);
  const fullyComplete=lines.length>0&&(ordered<=0||(receiptRequired?received+0.000001>=ordered:billed+0.000001>=ordered));
  if(po.status==='Closed'&&!fullyComplete)return recalcPo(po);
  let next='Open';
  if(fullyComplete)next='Closed';
  else if(receiptRequired&&received>0)next='Partially Received';
  if(po.status!==next)setPoStatus(po,next,action,note||((next==='Closed'&&receiptRequired)?'All required purchase order quantities were received.':''));
  return recalcPo(po);
}`,'PO closure on receipt completion');
 source=replaceOnce(source,
"const eligible=new Set(['Open','Partially Received','Received','Partially Billed']); const vendorPos=purchaseOrders.filter(p=>p.vendorId===vendor.id&&eligible.has(p.status));",
"const eligible=new Set(['Open','Partially Received','Received','Partially Billed']); const vendorPos=purchaseOrders.map(p=>refreshPoStatus(p)).filter(p=>p.vendorId===vendor.id&&(eligible.has(p.status)||(p.status==='Closed'&&billableLinesForPo(p).length>0)));",
'incoming PO matcher keeps closed received PO billable');
 source=replaceOnce(source,
"const matchingIncomingPo=purchaseOrders.map(po=>refreshPoStatus(po)).find(po=>(String(po.poNumber||po.id).toLowerCase()===normalizedIncomingPo||String(po.id).toLowerCase()===normalizedIncomingPo)&&po.vendorId===selectedIncomingVendor.id&&allowedIncomingPoStatuses.has(po.status));",
"const matchingIncomingPo=purchaseOrders.map(po=>refreshPoStatus(po)).find(po=>(String(po.poNumber||po.id).toLowerCase()===normalizedIncomingPo||String(po.id).toLowerCase()===normalizedIncomingPo)&&po.vendorId===selectedIncomingVendor.id&&(allowedIncomingPoStatuses.has(po.status)||(po.status==='Closed'&&billableLinesForPo(po).length>0)));",
'incoming bill vendor validation keeps closed received PO billable');
 source=replaceOnce(source,
"const sameNumberPo=purchaseOrders.map(po=>refreshPoStatus(po)).find(po=>(String(po.poNumber||po.id).toLowerCase()===normalizedIncomingPo||String(po.id).toLowerCase()===normalizedIncomingPo)&&allowedIncomingPoStatuses.has(po.status));",
"const sameNumberPo=purchaseOrders.map(po=>refreshPoStatus(po)).find(po=>(String(po.poNumber||po.id).toLowerCase()===normalizedIncomingPo||String(po.id).toLowerCase()===normalizedIncomingPo)&&(allowedIncomingPoStatuses.has(po.status)||(po.status==='Closed'&&billableLinesForPo(po).length>0)));",
'incoming bill same-number validation keeps closed received PO billable');
 source=replaceOnce(source,
"let rows=purchaseOrders.map(p=>refreshPoStatus(p)).filter(p=>allowed.has(p.status)||receiptUnbilledLines('').some(l=>l.poId===p.id));",
"let rows=purchaseOrders.map(p=>refreshPoStatus(p)).filter(p=>allowed.has(p.status)||billableLinesForPo(p).length>0);",
'PO lookup keeps operationally closed PO available for vouching');
 source=replaceOnce(source,'\nseedPurchaseOrders();',`\n${operationalReportingBlock}\nseedPurchaseOrders();`,'PO operational report builder');
 source=replaceOnce(source,
"if(method==='GET'&&pathname==='/api/purchase-orders/reports'){",
"if(method==='GET'&&pathname==='/api/purchase-orders/reports/operational'){requireAuthenticated(req);return json(res,200,buildPurchaseOperationalReports());}\n if(method==='GET'&&pathname==='/api/purchase-orders/reports'){",
'PO operational reporting API');
 return source;
}

export async function preparePurchaseOrderReportingServer(inputModule='./server.js'){
 const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
 const source=await readFile(inputPath,'utf8');
 const patched=applyPurchaseOrderReportingPatch(source);
 await writeFile(generatedPath,patched,'utf8');
 return `./${generatedName}`;
}
