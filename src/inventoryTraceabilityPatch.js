import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const generatedName='.server-inventory-traceability.js';
const generatedPath=path.join(here,generatedName);

function replaceOnceOrAlready(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`Inventory traceability patch failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Inventory traceability patch failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyInventoryTraceabilityPatch(source){
  source=replaceOnceOrAlready(
    source,
    'const inventoryTransactions = [];',
    "const inventoryTransactions = [];\nconst inventoryTraceBalances = [];\nconst inventoryTraceTransactions = [];",
    'traceability ledgers'
  );

  source=replaceOnceOrAlready(
    source,
    "function validateInventoryAndGlOpen(pp){ validatePeriodOpen('Inventory',pp); validatePeriodOpen('GL',pp); }",
    `function normalizeInventoryTrackingModeValue(value){const normalized=String(value||'None').trim().toLowerCase();if(normalized.startsWith('serial'))return'Serial';if(normalized.startsWith('lot'))return'Lot';return'None';}
function inventoryTrackingMode(item){return normalizeInventoryTrackingModeValue(item?.lotSerialTracking||item?.trackingMode||'None');}
function inventoryTraceNumber(row){return String(typeof row==='string'?row:(row?.traceNumber||row?.lotSerialNumber||row?.lotNumber||row?.serialNumber||row?.number||row?.id||'')).trim();}
function inventoryTraceBalance(itemId,warehouse,location,traceNumber,mode='Lot'){let row=inventoryTraceBalances.find(balance=>balance.itemId===itemId&&balance.warehouse===warehouse&&balance.location===location&&balance.traceNumber===traceNumber);if(!row){row={itemId,trackingMode:mode,traceNumber,lotNumber:mode==='Lot'?traceNumber:'',serialNumber:mode==='Serial'?traceNumber:'',warehouse,location,qtyOnHand:0,status:'Active',receivedDate:'',expiryDate:'',lastSourceModule:'',lastSourceReference:'',updatedAt:new Date().toISOString()};inventoryTraceBalances.push(row);}return row;}
function normalizeInventoryTraceAllocations(item,quantity,allocations=[],options={}){const mode=inventoryTrackingMode(item),qtyNeeded=Number(quantity||0);if(mode==='None')return[];if(qtyNeeded<=0)throw new Error('Tracked inventory quantity must be greater than zero.');let rows=Array.isArray(allocations)?allocations:[];if(!rows.length)throw new Error(mode+' tracking requires lot/serial allocations for '+(item?.code||item?.inventoryId||'the item')+'.');rows=rows.map((raw,index)=>{const traceNumber=inventoryTraceNumber(raw);if(!traceNumber)throw new Error(mode+' number is required on allocation '+(index+1)+'.');const quantityValue=mode==='Serial'?1:Number(typeof raw==='string'?1:(raw.quantity??raw.qty??1));if(!Number.isFinite(quantityValue)||quantityValue<=0)throw new Error('Trace allocation quantity must be greater than zero.');if(mode==='Serial'&&Math.abs(quantityValue-1)>0.000001)throw new Error('Each serial allocation must have quantity 1.');return{traceNumber,lotNumber:mode==='Lot'?traceNumber:'',serialNumber:mode==='Serial'?traceNumber:'',quantity:quantityValue,expiryDate:typeof raw==='string'?'':String(raw.expiryDate||''),status:typeof raw==='string'?'Active':String(raw.status||'Active')};});const unique=new Set();for(const row of rows){const key=row.traceNumber.toUpperCase();if(unique.has(key))throw new Error('Duplicate '+mode.toLowerCase()+' number '+row.traceNumber+' in the same transaction.');unique.add(key);}const total=rows.reduce((sum,row)=>sum+Number(row.quantity||0),0);if(Math.abs(total-qtyNeeded)>0.000001)throw new Error(mode+' allocation quantity '+total+' must equal transaction quantity '+qtyNeeded+'.');if(mode==='Serial'&&Math.abs(qtyNeeded-Math.round(qtyNeeded))>0.000001)throw new Error('Serial-tracked item quantities must be whole numbers.');const direction=String(options.direction||'Issue');const warehouse=String(options.warehouse||item?.defaultWarehouse||'MAIN'),location=String(options.location||item?.defaultLocation||'MAIN-A1');if(direction==='Issue'){for(const row of rows){const balance=inventoryTraceBalances.find(candidate=>candidate.itemId===(item?.code||item?.inventoryId)&&candidate.warehouse===warehouse&&candidate.location===location&&candidate.traceNumber===row.traceNumber);if(!balance||Number(balance.qtyOnHand||0)+0.000001<Number(row.quantity||0))throw new Error(mode+' '+row.traceNumber+' does not have enough available quantity at '+warehouse+'/'+location+'.');if(String(balance.status||'Active')!=='Active')throw new Error(mode+' '+row.traceNumber+' is '+balance.status+' and cannot be issued.');}}else if(direction==='Receipt'&&mode==='Serial'&&options.allowExistingSerial!==true){for(const row of rows){if(inventoryTraceTransactions.some(tx=>tx.itemId===(item?.code||item?.inventoryId)&&tx.traceNumber===row.traceNumber&&Number(tx.quantityIn||0)>0&&!tx.reversalOf))throw new Error('Serial '+row.traceNumber+' already exists in inventory history.');}}return rows;}
function selectInventoryTraceAllocations({itemId,quantity,warehouse,location}){const item=itemMaster.find(row=>row.code===itemId||row.inventoryId===itemId),mode=inventoryTrackingMode(item);if(mode==='None')return[];let remaining=Number(quantity||0);const candidates=inventoryTraceBalances.filter(row=>row.itemId===itemId&&row.warehouse===warehouse&&row.location===location&&row.status==='Active'&&Number(row.qtyOnHand||0)>0).sort((a,b)=>String(a.receivedDate||'').localeCompare(String(b.receivedDate||''))||a.traceNumber.localeCompare(b.traceNumber)),selected=[];for(const row of candidates){if(remaining<=0.000001)break;const take=mode==='Serial'?Math.min(1,remaining):Math.min(Number(row.qtyOnHand||0),remaining);if(take<=0)continue;selected.push({traceNumber:row.traceNumber,lotNumber:row.lotNumber,serialNumber:row.serialNumber,quantity:take,expiryDate:row.expiryDate||'',status:row.status||'Active'});remaining-=take;}if(remaining>0.000001)throw new Error('Tracked inventory does not have enough lot/serial quantity for '+itemId+' at '+warehouse+'/'+location+'.');return selected;}
function applyInventoryTraceReceipt({itemId,warehouse,location,quantity,allocations,sourceModule='Inventory',sourceReference='',transactionType='Receipt',postDate=new Date().toISOString().slice(0,10),user='system',allowExistingSerial=false}){const item=itemMaster.find(row=>row.code===itemId||row.inventoryId===itemId),mode=inventoryTrackingMode(item),rows=normalizeInventoryTraceAllocations(item,quantity,allocations,{direction:'Receipt',warehouse,location,allowExistingSerial});for(const allocation of rows){const balance=inventoryTraceBalance(itemId,warehouse,location,allocation.traceNumber,mode);balance.qtyOnHand=Number(balance.qtyOnHand||0)+Number(allocation.quantity||0);balance.receivedDate=balance.receivedDate||postDate;balance.expiryDate=allocation.expiryDate||balance.expiryDate||'';balance.status=allocation.status||balance.status||'Active';balance.lastSourceModule=sourceModule;balance.lastSourceReference=sourceReference;balance.updatedAt=new Date().toISOString();inventoryTraceTransactions.push({id:'TRC-'+String(inventoryTraceTransactions.length+1001).padStart(6,'0'),transactionType,sourceModule,sourceReference,itemId,trackingMode:mode,traceNumber:allocation.traceNumber,lotNumber:allocation.lotNumber,serialNumber:allocation.serialNumber,warehouse,location,quantityIn:Number(allocation.quantity||0),quantityOut:0,postDate,user,createdAt:new Date().toISOString()});}return rows;}
function applyInventoryTraceIssue({itemId,warehouse,location,quantity,allocations,sourceModule='Inventory',sourceReference='',transactionType='Issue',postDate=new Date().toISOString().slice(0,10),user='system'}){const item=itemMaster.find(row=>row.code===itemId||row.inventoryId===itemId),mode=inventoryTrackingMode(item),rows=normalizeInventoryTraceAllocations(item,quantity,allocations,{direction:'Issue',warehouse,location});for(const allocation of rows){const balance=inventoryTraceBalances.find(candidate=>candidate.itemId===itemId&&candidate.warehouse===warehouse&&candidate.location===location&&candidate.traceNumber===allocation.traceNumber);balance.qtyOnHand=Math.max(0,Number(balance.qtyOnHand||0)-Number(allocation.quantity||0));balance.lastSourceModule=sourceModule;balance.lastSourceReference=sourceReference;balance.updatedAt=new Date().toISOString();inventoryTraceTransactions.push({id:'TRC-'+String(inventoryTraceTransactions.length+1001).padStart(6,'0'),transactionType,sourceModule,sourceReference,itemId,trackingMode:mode,traceNumber:allocation.traceNumber,lotNumber:allocation.lotNumber,serialNumber:allocation.serialNumber,warehouse,location,quantityIn:0,quantityOut:Number(allocation.quantity||0),postDate,user,createdAt:new Date().toISOString()});}return rows;}
function inventoryTraceabilityReport(query={}){const itemId=String(query.itemId||query.inventoryId||''),traceNumber=String(query.traceNumber||query.lotSerialNumber||'').toLowerCase(),matches=row=>(!itemId||row.itemId===itemId)&&(!traceNumber||String(row.traceNumber||'').toLowerCase().includes(traceNumber));return{balances:inventoryTraceBalances.filter(matches).map(row=>({...row})),transactions:inventoryTraceTransactions.filter(matches).map(row=>({...row})).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)))};}
function validateInventoryAndGlOpen(pp){ validatePeriodOpen('Inventory',pp); validatePeriodOpen('GL',pp); }`,
    'shared lot/serial helpers'
  );

  source=replaceOnceOrAlready(
    source,
    "function createInvAudit({transactionType,referenceNumber,sourceModule='Inventory',sourceReference='',itemId,warehouse,location,quantityIn=0,quantityOut=0,unitCost=0,postDate,postPeriod,jeReference='',createdBy='admin'}){ const extendedCost=(Number(quantityIn||0)||Number(quantityOut||0))*Number(unitCost||0); const t={transactionId:`ITX-${String(inventoryTransactions.length+1001).padStart(4,'0')}`,id:referenceNumber,transactionType,type:transactionType,referenceNumber,sourceModule,sourceReference,itemId,warehouse,location,quantityIn:Number(quantityIn||0),quantityOut:Number(quantityOut||0),unitCost:Number(unitCost||0),extendedCost,postDate,date:postDate,postPeriod,status:'Released',jeReference,createdBy,createdDate:new Date().toISOString()}; inventoryTransactions.push(t); return t; }",
    "function createInvAudit({transactionType,referenceNumber,sourceModule='Inventory',sourceReference='',itemId,warehouse,location,quantityIn=0,quantityOut=0,unitCost=0,postDate,postPeriod,jeReference='',createdBy='admin',traceAllocations=[],reason=''}){ const extendedCost=(Number(quantityIn||0)||Number(quantityOut||0))*Number(unitCost||0); const t={transactionId:`ITX-${String(inventoryTransactions.length+1001).padStart(4,'0')}`,id:referenceNumber,transactionType,type:transactionType,referenceNumber,sourceModule,sourceReference,itemId,warehouse,location,quantityIn:Number(quantityIn||0),quantityOut:Number(quantityOut||0),unitCost:Number(unitCost||0),extendedCost,postDate,date:postDate,postPeriod,status:'Released',jeReference,traceAllocations:(traceAllocations||[]).map(row=>({...row})),reason,createdBy,createdDate:new Date().toISOString()}; inventoryTransactions.push(t); return t; }",
    'inventory audit trace allocations'
  );

  source=replaceOnceOrAlready(
    source,
    'toReceive.push({l,qty,item});',
    "const traceAllocations=normalizeInventoryTraceAllocations(item,qty,selection?.lotSerialAllocations||selection?.traceAllocations||[],{direction:'Receipt',warehouse:l.warehouse,location:l.location,allowExistingSerial:false});toReceive.push({l,qty,item,traceAllocations});",
    'purchase receipt trace prevalidation'
  );
  source=replaceOnceOrAlready(source,'for(const {l,qty,item} of toReceive){','for(const {l,qty,item,traceAllocations} of toReceive){','purchase receipt trace processing');
  source=replaceOnceOrAlready(
    source,
    "purchaseReceiptLines.push({id:nextDocNbr('PRL',purchaseReceiptLines,['id']),receiptId,poId:po.id,poLineId:l.id,lineNumber:l.lineNumber,inventoryId:l.inventoryId,description:l.description,receiptQty:qty,uom:l.uom,unitCost:l.unitCost,extendedCost:ext,warehouse:l.warehouse,location:l.location});",
    "purchaseReceiptLines.push({id:nextDocNbr('PRL',purchaseReceiptLines,['id']),receiptId,poId:po.id,poLineId:l.id,lineNumber:l.lineNumber,inventoryId:l.inventoryId,description:l.description,receiptQty:qty,uom:l.uom,unitCost:l.unitCost,extendedCost:ext,warehouse:l.warehouse,location:l.location,traceAllocations:(traceAllocations||[]).map(row=>({...row}))});",
    'purchase receipt line trace persistence'
  );
  source=replaceOnceOrAlready(
    source,
    "if(isStockItem(item)){ adjustInventoryBalance({itemId:item.code,warehouse:l.warehouse,location:l.location,qtyIn:qty,unitCost:l.unitCost}); createInvAudit({transactionType:'Purchase Receipt',referenceNumber:receiptId,sourceModule:'Purchase Order',sourceReference:po.id,itemId:item.code,warehouse:l.warehouse,location:l.location,quantityIn:qty,unitCost:l.unitCost,postDate,postPeriod:pp,jeReference:receipt.jeReference}); }",
    "if(isStockItem(item)){ adjustInventoryBalance({itemId:item.code,warehouse:l.warehouse,location:l.location,qtyIn:qty,unitCost:l.unitCost}); if(inventoryTrackingMode(item)!=='None')applyInventoryTraceReceipt({itemId:item.code,warehouse:l.warehouse,location:l.location,quantity:qty,allocations:traceAllocations,sourceModule:'Purchase Order',sourceReference:receiptId,transactionType:'Purchase Receipt',postDate,user:'system'}); createInvAudit({transactionType:'Purchase Receipt',referenceNumber:receiptId,sourceModule:'Purchase Order',sourceReference:po.id,itemId:item.code,warehouse:l.warehouse,location:l.location,quantityIn:qty,unitCost:l.unitCost,postDate,postPeriod:pp,jeReference:receipt.jeReference,traceAllocations}); }",
    'purchase receipt trace posting'
  );

  source=replaceOnceOrAlready(
    source,
    "trackQuantity:b.trackQuantity!==false,status:b.status||'Active'};",
    "trackQuantity:b.trackQuantity!==false,lotSerialTracking:normalizeInventoryTrackingModeValue(b.lotSerialTracking||b.trackingMode||'None'),status:b.status||'Active'};",
    'item tracking mode normalization'
  );
  source=replaceOnceOrAlready(
    source,
    "const b=await body(req); ['inventoryAccount','cogsAccount','revenueAccount','purchaseAccrualAccount','adjustmentAccount','varianceAccount'].forEach(k=>{ if(b[k]) validateInvAccount(b[k],k); }); Object.assign(item,b);",
    "const b=await body(req); ['inventoryAccount','cogsAccount','revenueAccount','purchaseAccrualAccount','adjustmentAccount','varianceAccount'].forEach(k=>{ if(b[k]) validateInvAccount(b[k],k); }); if(Object.prototype.hasOwnProperty.call(b,'lotSerialTracking')||Object.prototype.hasOwnProperty.call(b,'trackingMode')){const nextMode=normalizeInventoryTrackingModeValue(b.lotSerialTracking||b.trackingMode),currentMode=inventoryTrackingMode(item),onHand=inventoryBalances.filter(row=>row.itemId===item.code).reduce((sum,row)=>sum+Number(row.qtyOnHand||0),0);if(nextMode!==currentMode&&Math.abs(onHand)>0.000001)return json(res,400,{error:'Lot/serial tracking mode cannot change while the item has on-hand inventory.'});b.lotSerialTracking=nextMode;} Object.assign(item,b);",
    'tracking mode change guard'
  );

  source=replaceOnceOrAlready(
    source,
    "if(method==='GET'&&pathname==='/api/inventory/summary') return json(res,200,invSummary());",
    "if(method==='GET'&&(pathname==='/api/inventory/lot-serial'||pathname==='/api/inventory/traceability')) return json(res,200,inventoryTraceabilityReport(query));\n if(method==='GET'&&pathname==='/api/inventory/summary') return json(res,200,invSummary());",
    'traceability inquiry endpoint'
  );
  return source;
}

export async function prepareInventoryTraceabilityServer(inputModule='./server.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyInventoryTraceabilityPatch(source);
  await writeFile(generatedPath,patched,'utf8');
  return `./${generatedName}`;
}
