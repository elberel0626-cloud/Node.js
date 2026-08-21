import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const generatedName='.server-inventory-shipment-traceability.js';
const generatedPath=path.join(here,generatedName);

function replaceOnceOrAlready(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`Inventory shipment traceability patch failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Inventory shipment traceability patch failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyInventoryShipmentTraceabilityPatch(source){
  source=replaceOnceOrAlready(
    source,
    'shipments.push(sh); for(const x of selected){',
    "const tracedSelected=selected.map(x=>{const sol=salesOrderLines.find(line=>line.id===x.salesOrderLineId);if(!sol)return x;const qty=Number(x.shippedQty||0),item=itemMaster.find(row=>row.code===sol.itemId),warehouse=sol.warehouse||item?.defaultWarehouse||'MAIN',location=x.location||item?.defaultLocation||'MAIN-A1';let traceAllocations=x.lotSerialAllocations||x.traceAllocations||[];if(isStockItem(item)&&inventoryTrackingMode(item)!=='None'&&!traceAllocations.length)traceAllocations=selectInventoryTraceAllocations({itemId:item.code,quantity:qty,warehouse,location});if(isStockItem(item))traceAllocations=normalizeInventoryTraceAllocations(item,qty,traceAllocations,{direction:'Issue',warehouse,location});return{...x,traceAllocations,traceWarehouse:warehouse,traceLocation:location};}); shipments.push(sh); for(const x of tracedSelected){",
    'shipment trace prevalidation'
  );

  source=replaceOnceOrAlready(
    source,
    "warehouse:sol.warehouse,location:x.location||'MAIN'});",
    "warehouse:x.traceWarehouse||sol.warehouse,location:x.traceLocation||x.location||'MAIN',traceAllocations:(x.traceAllocations||[]).map(row=>({...row})),traceIssued:false});",
    'shipment trace allocation persistence'
  );

  source=replaceOnceOrAlready(
    source,
    "if(isStockItem(item)) adjustInventoryBalance({itemId:item.code,warehouse:sol.warehouse||item.defaultWarehouse||'MAIN',location:item.defaultLocation||'MAIN-A1',qtyOut:qty,allocatedDelta:-qty,onSoDelta:-qty,backorderDelta:Math.max(0,open-qty)});",
    "if(isStockItem(item)) adjustInventoryBalance({itemId:item.code,warehouse:x.traceWarehouse||sol.warehouse||item.defaultWarehouse||'MAIN',location:x.traceLocation||item.defaultLocation||'MAIN-A1',qtyOut:qty,allocatedDelta:-qty,onSoDelta:-qty,backorderDelta:Math.max(0,open-qty)});",
    'immediate shipment trace location parity'
  );

  source=replaceOnceOrAlready(
    source,
    "function confirmShipment(sh){ if(sh.status==='Confirmed'&&sh.jeNumber) return sh; const lines=shipmentLines.filter(l=>l.shipmentId===sh.id); const jeLines=[];",
    "function confirmShipment(sh){ if(sh.status==='Confirmed'&&sh.jeNumber) return sh; const lines=shipmentLines.filter(l=>l.shipmentId===sh.id); for(const l of lines){const item=itemMaster.find(row=>row.code===l.itemId);if(!item||!isStockItem(item)||inventoryTrackingMode(item)==='None'||l.traceIssued)continue;const warehouse=l.warehouse||item.defaultWarehouse||'MAIN',location=l.location||item.defaultLocation||'MAIN-A1';let allocations=l.traceAllocations||[];if(!allocations.length)allocations=selectInventoryTraceAllocations({itemId:item.code,quantity:Number(l.shippedQty||0),warehouse,location});l.traceAllocations=normalizeInventoryTraceAllocations(item,Number(l.shippedQty||0),allocations,{direction:'Issue',warehouse,location});} const jeLines=[];",
    'shipment confirmation trace prevalidation'
  );

  source=replaceOnceOrAlready(
    source,
    "} } } setSoStatusFromQty(order); addSoHistory(order.id,old,order.status,'Confirm Shipment',`${sh.id} confirmed.`); return sh; }",
    "} } } for(const l of lines){const item=itemMaster.find(row=>row.code===l.itemId);if(!item||!isStockItem(item)||inventoryTrackingMode(item)==='None'||l.traceIssued)continue;const warehouse=l.warehouse||item.defaultWarehouse||'MAIN',location=l.location||item.defaultLocation||'MAIN-A1';applyInventoryTraceIssue({itemId:item.code,warehouse,location,quantity:Number(l.shippedQty||0),allocations:l.traceAllocations||[],sourceModule:'Sales Order',sourceReference:sh.id,transactionType:'Shipment',postDate:sh.shipDate,user:'admin'});l.traceIssued=true;const hasAudit=inventoryTransactions.some(tx=>tx.transactionType==='Shipment'&&tx.referenceNumber===sh.id&&tx.itemId===item.code&&tx.warehouse===warehouse&&tx.location===location);if(!hasAudit)createInvAudit({transactionType:'Shipment',referenceNumber:sh.id,sourceModule:'Sales Order',sourceReference:sh.salesOrderId,itemId:item.code,warehouse,location,quantityOut:Number(l.shippedQty||0),unitCost:itemCost(item),postDate:sh.shipDate,postPeriod:periodFromDate(sh.shipDate),jeReference:sh.jeNumber,traceAllocations:l.traceAllocations||[]});} setSoStatusFromQty(order); addSoHistory(order.id,old,order.status,'Confirm Shipment',`${sh.id} confirmed.`); return sh; }",
    'shipment trace posting'
  );
  return source;
}

export async function prepareInventoryShipmentTraceabilityServer(inputModule='./.server-inventory-traceability.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyInventoryShipmentTraceabilityPatch(source);
  await writeFile(generatedPath,patched,'utf8');
  return `./${generatedName}`;
}
