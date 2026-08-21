import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyManufacturingAgent3RuntimePatch } from '../src/manufacturingAgent3ReviewPatch.js';
import { applyManufacturingAgent3PlanningPatch } from '../src/manufacturingAgent3PlanningPatch.js';
import { applyManufacturingAgent3MasterQualityPatch } from '../src/manufacturingAgent3MasterQualityPatch.js';
import { applyManufacturingAgent3AdvancedPatch } from '../src/manufacturingAgent3AdvancedPatch.js';
import { applyManufacturingAgent3FinalizationPatch } from '../src/manufacturingAgent3FinalizationPatch.js';
import { applyManufacturingAgent3UiRuntimePatch, applyManufacturingAgent3UiClientPatch } from '../src/manufacturingAgent3UiPatch.js';
import { applyManufacturingAgent3EngineeringRuntimePatch, applyManufacturingAgent3EngineeringClientPatch } from '../src/manufacturingAgent3EngineeringPatch.js';
import { applyManufacturingAgent3GovernancePatch } from '../src/manufacturingAgent3GovernancePatch.js';
import { routePermission } from '../src/routePermissions.js';

const original=await readFile(new URL('../src/manufacturingRuntime.js',import.meta.url),'utf8');
const engineering=applyManufacturingAgent3EngineeringRuntimePatch(applyManufacturingAgent3UiRuntimePatch(applyManufacturingAgent3FinalizationPatch(applyManufacturingAgent3AdvancedPatch(applyManufacturingAgent3MasterQualityPatch(applyManufacturingAgent3PlanningPatch(applyManufacturingAgent3RuntimePatch(original)))))));
const reviewed=applyManufacturingAgent3GovernancePatch(engineering);
const { createManufacturingRuntime }=await import(`data:text/javascript;base64,${Buffer.from(reviewed).toString('base64')}`);

function fixture(){
  const itemMaster=[{code:'RM',inventoryId:'RM',description:'Raw',type:'Stock Item',trackQuantity:true,averageCost:5,cost:5,inventoryAccount:'1507',defaultWarehouse:'MAIN',defaultLocation:'A1'},{code:'FG',inventoryId:'FG',description:'Finished',type:'Stock Item',trackQuantity:true,costingMethod:'Standard Cost',standardCost:20,cost:20,inventoryAccount:'1509',defaultWarehouse:'MAIN',defaultLocation:'FG'}];
  const inventoryBalances=[{itemId:'RM',warehouse:'MAIN',location:'A1',qtyOnHand:100,qtyAllocated:0,averageCost:5},{itemId:'FG',warehouse:'MAIN',location:'FG',qtyOnHand:0,qtyAllocated:0,averageCost:20}],inventoryTransactions=[],purchaseOrders=[],purchaseOrderLines=[],purchaseReceiptLines=[],journalEntries=[],vendors=[],salesOrders=[],salesOrderLines=[],warehouses=[{warehouseId:'MAIN'},{warehouseId:'PROD'}],inventoryLocations=[{warehouse:'PROD',locationId:'PROD-WIP'}];
  const getBalance=(itemId,warehouse,location)=>{let row=inventoryBalances.find(r=>r.itemId===itemId&&r.warehouse===warehouse&&r.location===location);if(!row){row={itemId,warehouse,location,qtyOnHand:0,qtyAllocated:0,averageCost:0};inventoryBalances.push(row);}return row;};
  const helpers={getBalance,qtyAvail:b=>Number(b.qtyOnHand)-Number(b.qtyAllocated),itemCost:i=>Number(i?.standardCost||i?.averageCost||i?.cost||0),adjustInventoryBalance:({itemId,warehouse,location,qtyIn=0,qtyOut=0,allocatedDelta=0})=>{const b=getBalance(itemId,warehouse,location);b.qtyOnHand+=Number(qtyIn)-Number(qtyOut);b.qtyAllocated=Math.max(0,Number(b.qtyAllocated)+Number(allocatedDelta));return b;},createInvAudit:r=>{inventoryTransactions.push(r);return r;},createPostedJournal:j=>{const row={...j,jeNumber:`JE-${journalEntries.length+1}`};journalEntries.push(row);return row;},periodFromDate:d=>String(d).slice(0,7),validateInventoryAndGlOpen:()=>{},validatePeriodOpen:()=>{},requireAccount:c=>String(c),calcPoLine:(x,i,poId)=>({id:`${poId}-L${i+1}`,poId,...x}),recalcPo:po=>po,nextPoId:(p,rows)=>`${p}-${rows.length+1}`};
  const runtime=createManufacturingRuntime({itemMaster,inventoryBalances,inventoryTransactions,purchaseOrders,purchaseOrderLines,purchaseReceiptLines,journalEntries,vendors,salesOrders,salesOrderLines,warehouses,inventoryLocations,helpers});
  const call=async(method,pathname,body={},user='engineer')=>{const response=await runtime.handle({method,pathname,query:{},readBody:async()=>body,user:{user:{id:user}}});if(response.status>=400)throw new Error(response.body.error);return response.body;};
  return{runtime,call};
}

function bomInput(revision,status,effectiveFrom,qtyPer=revision==='A'?1:1.2){return{itemId:'FG',revision,status,effectiveFrom,baseQty:1,yieldPct:100,components:[{lineId:'1',itemId:'RM',qtyPer,supplyType:'Buy',issueMethod:'Manual'}]};}
function routingInput(revision,status,effectiveFrom,runHoursPerUnit=revision==='A'?0.5:0.4){return{itemId:'FG',revision,status,effectiveFrom,operations:[{sequence:10,workCenterId:'WC-ASSY',description:`Assembly ${revision}`,runHoursPerUnit}]};}
async function createRevisionSet(f,revision,status,effectiveFrom){
  await f.call('POST','/api/manufacturing/boms',bomInput(revision,status,effectiveFrom));
  await f.call('POST','/api/manufacturing/routings',routingInput(revision,status,effectiveFrom));
}

test('engineering and governance patches remain idempotent in sequence',()=>{
  assert.equal(engineering,applyManufacturingAgent3EngineeringRuntimePatch(engineering));
  assert.equal(reviewed,applyManufacturingAgent3GovernancePatch(reviewed));
});

test('engineering workflow requires draft revisions and four-eyes approval',async()=>{
  const f=fixture();await createRevisionSet(f,'A','Active','2026-01-01');await createRevisionSet(f,'B','Draft','2026-09-01');
  const eco=await f.call('POST','/api/manufacturing/engineering-changes',{itemId:'FG',scope:'BOM & Routing',proposedRevision:'B',effectiveDate:'2026-09-01',reason:'Reduce assembly time and update material usage.'},'engineer');
  assert.equal(eco.status,'Draft');
  const submitted=await f.call('POST',`/api/manufacturing/engineering-changes/${eco.id}/submit`,{},'engineer');
  assert.equal(submitted.status,'Pending Approval');
  await assert.rejects(()=>f.call('POST',`/api/manufacturing/engineering-changes/${eco.id}/approve`,{},'engineer'),/different user/);
  const approved=await f.call('POST',`/api/manufacturing/engineering-changes/${eco.id}/approve`,{},'manager');
  assert.equal(approved.status,'Approved');
  assert.equal(approved.approvedBy,'manager');
});

test('active manufacturing structures cannot be edited or activated outside the ECO path',async()=>{
  const f=fixture();await createRevisionSet(f,'A','Active','2026-01-01');
  await assert.rejects(()=>f.call('POST','/api/manufacturing/boms',bomInput('A','Active','2026-01-01',2)),/Active BOM revisions are frozen/);
  await assert.rejects(()=>f.call('POST','/api/manufacturing/routings',routingInput('A','Active','2026-01-01',1)),/Active Routing revisions are frozen/);
  await f.call('POST','/api/manufacturing/boms',bomInput('B','Draft','2026-09-01'));
  await f.call('POST','/api/manufacturing/routings',routingInput('B','Draft','2026-09-01'));
  await assert.rejects(()=>f.call('POST','/api/manufacturing/boms',bomInput('B','Active','2026-09-01')),/only through an approved Engineering Change/);
  await assert.rejects(()=>f.call('POST','/api/manufacturing/routings',routingInput('B','Active','2026-09-01')),/only through an approved Engineering Change/);
  await assert.rejects(()=>f.call('POST','/api/manufacturing/boms',bomInput('C','Active','2026-10-01')),/Create BOM revision C as Draft/);
  await assert.rejects(()=>f.call('POST','/api/manufacturing/routings',routingInput('C','Active','2026-10-01')),/Create Routing revision C as Draft/);
});

test('applying an approved ECO effectivity-dates old revisions and preserves frozen open orders',async()=>{
  const f=fixture();await createRevisionSet(f,'A','Active','2026-01-01');const order=await f.call('POST','/api/manufacturing/orders',{itemId:'FG',quantity:5,startDate:'2026-08-21',dueDate:'2026-09-15'});await f.call('POST',`/api/manufacturing/orders/${order.id}/release`,{});await createRevisionSet(f,'B','Draft','2026-09-01');
  const eco=await f.call('POST','/api/manufacturing/engineering-changes',{itemId:'FG',scope:'BOM & Routing',proposedRevision:'B',effectiveDate:'2026-09-01',reason:'Approved design revision.'},'engineer');await f.call('POST',`/api/manufacturing/engineering-changes/${eco.id}/submit`,{},'engineer');await f.call('POST',`/api/manufacturing/engineering-changes/${eco.id}/approve`,{},'manager');const applied=await f.call('POST',`/api/manufacturing/engineering-changes/${eco.id}/apply`,{},'manager');
  assert.equal(applied.status,'Applied');
  const boms=await f.call('GET','/api/manufacturing/boms');const routings=await f.call('GET','/api/manufacturing/routings');
  assert.equal(boms.find(r=>r.revision==='A').effectiveTo,'2026-08-31');
  assert.equal(boms.find(r=>r.revision==='B').status,'Active');
  assert.equal(boms.find(r=>r.revision==='B').effectiveFrom,'2026-09-01');
  assert.equal(routings.find(r=>r.revision==='A').effectiveTo,'2026-08-31');
  assert.equal(routings.find(r=>r.revision==='B').status,'Active');
  const frozen=await f.call('GET',`/api/manufacturing/orders/${order.id}`);
  assert.equal(frozen.bomRevision,'A');
  assert.equal(frozen.routingRevision,'A');
  assert.deepEqual(applied.frozenOpenOrders.map(r=>r.orderId),[order.id]);
});

test('engineering and cost change permissions separate preparer from controlled application',()=>{
  assert.equal(routePermission('POST','/api/manufacturing/engineering-changes'),'INVENTORY_ADJUST');
  assert.equal(routePermission('POST','/api/manufacturing/engineering-changes/ECO-1001/submit'),'INVENTORY_ADJUST');
  assert.equal(routePermission('POST','/api/manufacturing/engineering-changes/ECO-1001/approve'),'SYSTEM_CONFIGURATION_ADMIN');
  assert.equal(routePermission('POST','/api/manufacturing/engineering-changes/ECO-1001/apply'),'SYSTEM_CONFIGURATION_ADMIN');
  assert.equal(routePermission('POST','/api/manufacturing/cost-rollup/apply'),'SYSTEM_CONFIGURATION_ADMIN');
});

test('engineering client patch compiles and exposes controlled revision screens',async()=>{
  const client=await readFile(new URL('../public/manufacturingModule.js',import.meta.url),'utf8');const advancedClient=applyManufacturingAgent3UiClientPatch(client);const engineeringClient=applyManufacturingAgent3EngineeringClientPatch(advancedClient);
  assert.equal(engineeringClient,applyManufacturingAgent3EngineeringClientPatch(engineeringClient));
  assert.doesNotThrow(()=>new Function(engineeringClient));
  assert.match(engineeringClient,/Engineering Changes/);
  assert.match(engineeringClient,/Pending Approval/);
  assert.match(engineeringClient,/Create Engineering Change/);
  assert.match(engineeringClient,/Existing released production orders retain their frozen revisions/);
});
