import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyInventoryTraceabilityPatch } from '../src/inventoryTraceabilityPatch.js';
import { applyManufacturingAgent3RuntimePatch } from '../src/manufacturingAgent3ReviewPatch.js';
import { applyManufacturingAgent3PlanningPatch } from '../src/manufacturingAgent3PlanningPatch.js';
import { applyManufacturingAgent3MasterQualityPatch } from '../src/manufacturingAgent3MasterQualityPatch.js';
import { applyManufacturingAgent3AdvancedPatch } from '../src/manufacturingAgent3AdvancedPatch.js';
import { applyManufacturingAgent3FinalizationPatch } from '../src/manufacturingAgent3FinalizationPatch.js';
import { applyManufacturingAgent3UiRuntimePatch, applyManufacturingAgent3UiClientPatch } from '../src/manufacturingAgent3UiPatch.js';
import { applyManufacturingAgent3EngineeringRuntimePatch, applyManufacturingAgent3EngineeringClientPatch } from '../src/manufacturingAgent3EngineeringPatch.js';
import { applyManufacturingAgent3GovernancePatch } from '../src/manufacturingAgent3GovernancePatch.js';
import { applyManufacturingAgent3IdempotencyRuntimePatch, applyManufacturingAgent3IdempotencyClientPatch } from '../src/manufacturingAgent3IdempotencyPatch.js';
import { applyManufacturingAgent3MrpExceptionsRuntimePatch, applyManufacturingAgent3MrpExceptionsClientPatch } from '../src/manufacturingAgent3MrpExceptionsPatch.js';
import { applyManufacturingAgent3SubstitutionRuntimePatch, applyManufacturingAgent3SubstitutionClientPatch } from '../src/manufacturingAgent3SubstitutionPatch.js';
import { applyManufacturingAgent3ReversalRuntimePatch, applyManufacturingAgent3ReversalClientPatch } from '../src/manufacturingAgent3ReversalPatch.js';
import { applyManufacturingAgent3TraceabilityRuntimePatch, applyManufacturingAgent3TraceabilityClientPatch } from '../src/manufacturingAgent3TraceabilityPatch.js';

const serverSource=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
const tracedServer=applyInventoryTraceabilityPatch(serverSource);
const original=await readFile(new URL('../src/manufacturingRuntime.js',import.meta.url),'utf8');
const beforeTrace=applyManufacturingAgent3ReversalRuntimePatch(applyManufacturingAgent3SubstitutionRuntimePatch(applyManufacturingAgent3MrpExceptionsRuntimePatch(applyManufacturingAgent3IdempotencyRuntimePatch(applyManufacturingAgent3GovernancePatch(applyManufacturingAgent3EngineeringRuntimePatch(applyManufacturingAgent3UiRuntimePatch(applyManufacturingAgent3FinalizationPatch(applyManufacturingAgent3AdvancedPatch(applyManufacturingAgent3MasterQualityPatch(applyManufacturingAgent3PlanningPatch(applyManufacturingAgent3RuntimePatch(original))))))))))));
const reviewed=applyManufacturingAgent3TraceabilityRuntimePatch(beforeTrace);
const { createManufacturingRuntime }=await import(`data:text/javascript;base64,${Buffer.from(reviewed).toString('base64')}`);

function traceHelpers(itemMaster,traceBalances,traceTransactions){
  const mode=item=>{const value=String(item?.lotSerialTracking||'None').toLowerCase();return value.startsWith('serial')?'Serial':value.startsWith('lot')?'Lot':'None';};
  const number=row=>String(typeof row==='string'?row:(row?.traceNumber||row?.lotNumber||row?.serialNumber||''));
  const normalize=(item,quantity,allocations=[],options={})=>{const tracking=mode(item);if(tracking==='None')return[];const rows=(allocations||[]).map(raw=>({traceNumber:number(raw),lotNumber:tracking==='Lot'?number(raw):'',serialNumber:tracking==='Serial'?number(raw):'',quantity:tracking==='Serial'?1:Number(typeof raw==='string'?1:(raw.quantity??raw.qty??1)),status:'Active'}));assert.ok(rows.length,`${tracking} allocations are required`);assert.equal(rows.reduce((sum,row)=>sum+row.quantity,0),Number(quantity));assert.equal(new Set(rows.map(row=>row.traceNumber)).size,rows.length);if(tracking==='Serial')assert.equal(Number(quantity),Math.round(Number(quantity)));if(options.direction==='Issue'){for(const row of rows){const balance=traceBalances.find(b=>b.itemId===(item.code||item.inventoryId)&&b.warehouse===options.warehouse&&b.location===options.location&&b.traceNumber===row.traceNumber);if(!balance||balance.qtyOnHand<row.quantity)throw new Error(`${tracking} ${row.traceNumber} does not have enough available quantity`);}}if(options.direction==='Receipt'&&tracking==='Serial'&&options.allowExistingSerial!==true){for(const row of rows){if(traceTransactions.some(tx=>tx.itemId===(item.code||item.inventoryId)&&tx.traceNumber===row.traceNumber&&tx.quantityIn>0))throw new Error(`Serial ${row.traceNumber} already exists in inventory history.`);}}return rows;};
  const select=({itemId,quantity,warehouse,location})=>{const item=itemMaster.find(row=>row.code===itemId),tracking=mode(item);if(tracking==='None')return[];let remaining=Number(quantity),rows=[];for(const balance of traceBalances.filter(row=>row.itemId===itemId&&row.warehouse===warehouse&&row.location===location&&row.qtyOnHand>0).sort((a,b)=>a.traceNumber.localeCompare(b.traceNumber))){if(remaining<=0)break;const take=tracking==='Serial'?Math.min(1,remaining):Math.min(balance.qtyOnHand,remaining);if(take>0){rows.push({traceNumber:balance.traceNumber,quantity:take});remaining-=take;}}if(remaining>0)throw new Error('Tracked inventory does not have enough quantity');return rows;};
  const receive=({itemId,warehouse,location,quantity,allocations,sourceModule,sourceReference,transactionType,postDate,user,allowExistingSerial=false})=>{const item=itemMaster.find(row=>row.code===itemId),tracking=mode(item),rows=normalize(item,quantity,allocations,{direction:'Receipt',warehouse,location,allowExistingSerial});for(const row of rows){let balance=traceBalances.find(b=>b.itemId===itemId&&b.warehouse===warehouse&&b.location===location&&b.traceNumber===row.traceNumber);if(!balance){balance={itemId,trackingMode:tracking,traceNumber:row.traceNumber,lotNumber:tracking==='Lot'?row.traceNumber:'',serialNumber:tracking==='Serial'?row.traceNumber:'',warehouse,location,qtyOnHand:0,status:'Active'};traceBalances.push(balance);}balance.qtyOnHand+=row.quantity;traceTransactions.push({transactionType,sourceModule,sourceReference,itemId,traceNumber:row.traceNumber,quantityIn:row.quantity,quantityOut:0,postDate,user});}return rows;};
  const issue=({itemId,warehouse,location,quantity,allocations,sourceModule,sourceReference,transactionType,postDate,user})=>{const item=itemMaster.find(row=>row.code===itemId),rows=normalize(item,quantity,allocations,{direction:'Issue',warehouse,location});for(const row of rows){const balance=traceBalances.find(b=>b.itemId===itemId&&b.warehouse===warehouse&&b.location===location&&b.traceNumber===row.traceNumber);balance.qtyOnHand-=row.quantity;traceTransactions.push({transactionType,sourceModule,sourceReference,itemId,traceNumber:row.traceNumber,quantityIn:0,quantityOut:row.quantity,postDate,user});}return rows;};
  const report=query=>{const itemId=String(query.itemId||''),trace=String(query.traceNumber||'');const match=row=>(!itemId||row.itemId===itemId)&&(!trace||row.traceNumber===trace);return{balances:traceBalances.filter(match).map(row=>({...row})),transactions:traceTransactions.filter(match).map(row=>({...row}))};};
  return{inventoryTrackingMode:mode,normalizeInventoryTraceAllocations:normalize,selectInventoryTraceAllocations:select,applyInventoryTraceReceipt:receive,applyInventoryTraceIssue:issue,inventoryTraceabilityReport:report};
}

function fixture(){
  const itemMaster=[
    {code:'RM-LOT',inventoryId:'RM-LOT',description:'Lot Raw Material',type:'Stock Item',trackQuantity:true,lotSerialTracking:'Lot',averageCost:5,cost:5,inventoryAccount:'1507',defaultWarehouse:'MAIN',defaultLocation:'A1'},
    {code:'FG-SERIAL',inventoryId:'FG-SERIAL',description:'Serialized Finished Good',type:'Stock Item',trackQuantity:true,lotSerialTracking:'Serial',costingMethod:'Standard Cost',standardCost:5,cost:5,inventoryAccount:'1509',defaultWarehouse:'MAIN',defaultLocation:'FG'}
  ];
  const inventoryBalances=[{itemId:'RM-LOT',warehouse:'MAIN',location:'A1',qtyOnHand:4,qtyAllocated:0,averageCost:5},{itemId:'FG-SERIAL',warehouse:'MAIN',location:'FG',qtyOnHand:0,qtyAllocated:0,averageCost:5}],inventoryTransactions=[],inventoryTraceBalances=[{itemId:'RM-LOT',trackingMode:'Lot',traceNumber:'LOT-RM-01',lotNumber:'LOT-RM-01',serialNumber:'',warehouse:'MAIN',location:'A1',qtyOnHand:4,status:'Active'}],inventoryTraceTransactions=[{transactionType:'Purchase Receipt',sourceModule:'Purchase Order',sourceReference:'PR-LOT-01',itemId:'RM-LOT',traceNumber:'LOT-RM-01',quantityIn:4,quantityOut:0,postDate:'2026-08-20',user:'receiver'}],purchaseOrders=[],purchaseOrderLines=[],purchaseReceiptLines=[],journalEntries=[],vendors=[],salesOrders=[],salesOrderLines=[],warehouses=[{warehouseId:'MAIN'},{warehouseId:'PROD'}],inventoryLocations=[{warehouse:'MAIN',locationId:'A1'},{warehouse:'MAIN',locationId:'FG'},{warehouse:'PROD',locationId:'PROD-WIP'}];
  const getBalance=(itemId,warehouse,location)=>{let row=inventoryBalances.find(r=>r.itemId===itemId&&r.warehouse===warehouse&&r.location===location);if(!row){row={itemId,warehouse,location,qtyOnHand:0,qtyAllocated:0,averageCost:0};inventoryBalances.push(row);}return row;};
  const helpers={getBalance,qtyAvail:b=>Number(b.qtyOnHand)-Number(b.qtyAllocated),itemCost:i=>Number(i?.standardCost||i?.averageCost||i?.cost||0),adjustInventoryBalance:({itemId,warehouse,location,qtyIn=0,qtyOut=0,allocatedDelta=0,unitCost=0})=>{const b=getBalance(itemId,warehouse,location);b.qtyOnHand+=Number(qtyIn)-Number(qtyOut);b.qtyAllocated=Math.max(0,b.qtyAllocated+Number(allocatedDelta));if(qtyIn&&unitCost)b.averageCost=Number(unitCost);return b;},createInvAudit:r=>{inventoryTransactions.push(r);return r;},createPostedJournal:j=>{const row={...j,jeNumber:`JE-${journalEntries.length+1}`};journalEntries.push(row);return row;},periodFromDate:d=>String(d).slice(0,7),validateInventoryAndGlOpen:()=>{},validatePeriodOpen:()=>{},requireAccount:c=>String(c),calcPoLine:(x,i,poId)=>({id:`${poId}-L${i+1}`,poId,...x}),recalcPo:po=>po,nextPoId:(prefix,rows)=>`${prefix}-${rows.length+1}`,...traceHelpers(itemMaster,inventoryTraceBalances,inventoryTraceTransactions)};
  const runtime=createManufacturingRuntime({itemMaster,inventoryBalances,inventoryTransactions,inventoryTraceBalances,inventoryTraceTransactions,purchaseOrders,purchaseOrderLines,purchaseReceiptLines,journalEntries,vendors,salesOrders,salesOrderLines,warehouses,inventoryLocations,helpers});
  const call=async(method,pathname,body={},query={})=>{const response=await runtime.handle({method,pathname,query,readBody:async()=>body,user:{user:{id:'trace.user'}}});if(response.status>=400)throw new Error(response.body.error);return response.body;};
  return{runtime,call,getBalance,inventoryTraceBalances,inventoryTraceTransactions,inventoryTransactions,journalEntries};
}

async function configure(f){await f.call('POST','/api/manufacturing/boms',{itemId:'FG-SERIAL',revision:'A',status:'Active',effectiveFrom:'2026-01-01',baseQty:1,yieldPct:100,components:[{lineId:'L1',itemId:'RM-LOT',qtyPer:1,supplyType:'Buy',issueMethod:'Manual'}],clientRequestId:'TRACE-BOM'});}

test('inventory traceability server patch is idempotent and generated source parses',async()=>{
  assert.equal(tracedServer,applyInventoryTraceabilityPatch(tracedServer));
  assert.match(tracedServer,/inventoryTraceBalances/);
  assert.match(tracedServer,/Serial .* already exists in inventory history/);
  assert.match(tracedServer,/Lot\/serial tracking mode cannot change while the item has on-hand inventory/);
  assert.match(tracedServer,/api\/inventory\/traceability/);
  const file=path.join(tmpdir(),`inventory-trace-${process.pid}-${Date.now()}.mjs`);await writeFile(file,tracedServer,'utf8');try{execFileSync(process.execPath,['--check',file],{stdio:'pipe'});}finally{await unlink(file).catch(()=>{});}
});

test('tracked raw lot flows through production into finished serial genealogy',async()=>{
  const f=fixture();await configure(f);const order=await f.call('POST','/api/manufacturing/orders',{itemId:'FG-SERIAL',quantity:2,clientRequestId:'TRACE-ORDER'});await f.call('POST',`/api/manufacturing/orders/${order.id}/release`,{clientRequestId:'TRACE-REL'});const issued=await f.call('POST',`/api/manufacturing/orders/${order.id}/issue-materials`,{lines:[{lineId:'L1',quantity:2}],clientRequestId:'TRACE-ISSUE'});
  assert.equal(issued.materials[0].traceIssueHistory[0].traceAllocations[0].traceNumber,'LOT-RM-01');
  assert.equal(issued.materials[0].traceIssueHistory[0].traceAllocations[0].quantity,2);
  assert.equal(f.inventoryTraceBalances.find(row=>row.traceNumber==='LOT-RM-01').qtyOnHand,2);
  const completed=await f.call('POST',`/api/manufacturing/orders/${order.id}/complete`,{quantity:2,scrapQty:0,traceAllocations:[{traceNumber:'FG-SN-001',quantity:1},{traceNumber:'FG-SN-002',quantity:1}],clientRequestId:'TRACE-COMP'});
  assert.equal(completed.completionHistory[0].traceAllocations.length,2);
  assert.equal(f.inventoryTraceBalances.find(row=>row.traceNumber==='FG-SN-001').qtyOnHand,1);
  assert.equal(f.inventoryTraceBalances.find(row=>row.traceNumber==='FG-SN-002').qtyOnHand,1);
  const lotGenealogy=await f.call('GET','/api/manufacturing/genealogy',{}, {traceNumber:'LOT-RM-01'});
  assert.equal(lotGenealogy.production[0].events.some(event=>event.event==='Component Issue'&&event.orderId===undefined),true);
  assert.equal(lotGenealogy.inventoryTransactions.some(tx=>tx.transactionType==='Production Material Issue'),true);
  const serialGenealogy=await f.call('GET','/api/manufacturing/genealogy',{}, {traceNumber:'FG-SN-001'});
  assert.equal(serialGenealogy.production[0].events.some(event=>event.event==='Finished Goods Completion'),true);
  assert.equal(serialGenealogy.balances[0].qtyOnHand,1);
});

test('material return restores the exact issued lot and completion reversal removes the produced serial',async()=>{
  const f=fixture();await configure(f);const order=await f.call('POST','/api/manufacturing/orders',{itemId:'FG-SERIAL',quantity:2,clientRequestId:'TRACE-ORDER-2'});await f.call('POST',`/api/manufacturing/orders/${order.id}/release`,{clientRequestId:'TRACE-REL-2'});await f.call('POST',`/api/manufacturing/orders/${order.id}/issue-materials`,{lines:[{lineId:'L1',quantity:2}],clientRequestId:'TRACE-ISSUE-2'});const returned=await f.call('POST',`/api/manufacturing/orders/${order.id}/return-materials`,{lines:[{lineId:'L1',quantity:1}],clientRequestId:'TRACE-RETURN'});
  assert.equal(returned.order.materials[0].traceReturnHistory[0].traceAllocations[0].traceNumber,'LOT-RM-01');
  assert.equal(f.inventoryTraceBalances.find(row=>row.traceNumber==='LOT-RM-01').qtyOnHand,3);
  await f.call('POST',`/api/manufacturing/orders/${order.id}/issue-materials`,{lines:[{lineId:'L1',quantity:1}],clientRequestId:'TRACE-REISSUE'});const completed=await f.call('POST',`/api/manufacturing/orders/${order.id}/complete`,{quantity:2,traceAllocations:[{traceNumber:'FG-SN-101'},{traceNumber:'FG-SN-102'}],clientRequestId:'TRACE-COMP-2'});const reversed=await f.call('POST',`/api/manufacturing/orders/${order.id}/reverse-completion`,{quantity:1,reason:'Serial completion correction.',clientRequestId:'TRACE-REV'});
  assert.equal(reversed.completionReversals.at(-1).traceAllocations.length,1);
  const reversedSerial=reversed.completionReversals.at(-1).traceAllocations[0].traceNumber;
  assert.ok(['FG-SN-101','FG-SN-102'].includes(reversedSerial));
  assert.equal(f.inventoryTraceBalances.find(row=>row.traceNumber===reversedSerial).qtyOnHand,0);
  const genealogy=await f.call('GET','/api/manufacturing/genealogy',{}, {traceNumber:reversedSerial});
  assert.equal(genealogy.production[0].events.some(event=>event.event==='Finished Goods Reversal'),true);
});

test('duplicate finished serials are rejected before inventory or GL mutation',async()=>{
  const f=fixture();await configure(f);const order=await f.call('POST','/api/manufacturing/orders',{itemId:'FG-SERIAL',quantity:2,clientRequestId:'TRACE-ORDER-3'});await f.call('POST',`/api/manufacturing/orders/${order.id}/release`,{clientRequestId:'TRACE-REL-3'});await f.call('POST',`/api/manufacturing/orders/${order.id}/issue-materials`,{lines:[{lineId:'L1',quantity:2}],clientRequestId:'TRACE-ISSUE-3'});await f.call('POST',`/api/manufacturing/orders/${order.id}/complete`,{quantity:1,traceAllocations:[{traceNumber:'FG-DUP-001'}],clientRequestId:'TRACE-COMP-3A'});const beforeQty=f.getBalance('FG-SERIAL','MAIN','FG').qtyOnHand,beforeJe=f.journalEntries.length;
  await assert.rejects(()=>f.call('POST',`/api/manufacturing/orders/${order.id}/complete`,{quantity:1,traceAllocations:[{traceNumber:'FG-DUP-001'}],clientRequestId:'TRACE-COMP-3B'}),/already exists in inventory history/);
  assert.equal(f.getBalance('FG-SERIAL','MAIN','FG').qtyOnHand,beforeQty);
  assert.equal(f.journalEntries.length,beforeJe);
});

test('traceability UI compiles and exposes completion identities and genealogy inquiry',async()=>{
  const client=await readFile(new URL('../public/manufacturingModule.js',import.meta.url),'utf8');const advanced=applyManufacturingAgent3UiClientPatch(client),engineering=applyManufacturingAgent3EngineeringClientPatch(advanced),idempotent=applyManufacturingAgent3IdempotencyClientPatch(engineering),mrp=applyManufacturingAgent3MrpExceptionsClientPatch(idempotent),substitution=applyManufacturingAgent3SubstitutionClientPatch(mrp),reversal=applyManufacturingAgent3ReversalClientPatch(substitution),trace=applyManufacturingAgent3TraceabilityClientPatch(reversal);
  assert.equal(trace,applyManufacturingAgent3TraceabilityClientPatch(trace));
  assert.doesNotThrow(()=>new Function(trace));
  assert.match(trace,/Lot \/ Serial Genealogy/);
  assert.match(trace,/FG Lot \/ Serial Numbers/);
  assert.match(trace,/Production Where-Used \/ Where-From/);
  assert.match(trace,/parseMfgTraceAllocations/);
});
