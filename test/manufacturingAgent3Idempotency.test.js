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
import { applyManufacturingAgent3IdempotencyRuntimePatch, applyManufacturingAgent3IdempotencyClientPatch } from '../src/manufacturingAgent3IdempotencyPatch.js';

const original=await readFile(new URL('../src/manufacturingRuntime.js',import.meta.url),'utf8');
const governed=applyManufacturingAgent3GovernancePatch(applyManufacturingAgent3EngineeringRuntimePatch(applyManufacturingAgent3UiRuntimePatch(applyManufacturingAgent3FinalizationPatch(applyManufacturingAgent3AdvancedPatch(applyManufacturingAgent3MasterQualityPatch(applyManufacturingAgent3PlanningPatch(applyManufacturingAgent3RuntimePatch(original))))))));
const reviewed=applyManufacturingAgent3IdempotencyRuntimePatch(governed);
const { createManufacturingRuntime }=await import(`data:text/javascript;base64,${Buffer.from(reviewed).toString('base64')}`);

function fixture(){
  const itemMaster=[{code:'RM',inventoryId:'RM',description:'Raw',type:'Stock Item',trackQuantity:true,averageCost:5,cost:5,inventoryAccount:'1507',defaultWarehouse:'MAIN',defaultLocation:'A1'},{code:'FG',inventoryId:'FG',description:'Finished',type:'Stock Item',trackQuantity:true,costingMethod:'Standard Cost',standardCost:20,cost:20,inventoryAccount:'1509',defaultWarehouse:'MAIN',defaultLocation:'FG'}];
  const inventoryBalances=[{itemId:'RM',warehouse:'MAIN',location:'A1',qtyOnHand:10,qtyAllocated:0,averageCost:5},{itemId:'FG',warehouse:'MAIN',location:'FG',qtyOnHand:0,qtyAllocated:0,averageCost:20}],inventoryTransactions=[],purchaseOrders=[],purchaseOrderLines=[],purchaseReceiptLines=[],journalEntries=[],vendors=[],salesOrders=[],salesOrderLines=[],warehouses=[{warehouseId:'MAIN'},{warehouseId:'PROD'}],inventoryLocations=[{warehouse:'MAIN',locationId:'A1'},{warehouse:'MAIN',locationId:'FG'},{warehouse:'PROD',locationId:'PROD-WIP'}];
  const getBalance=(itemId,warehouse,location)=>{let row=inventoryBalances.find(r=>r.itemId===itemId&&r.warehouse===warehouse&&r.location===location);if(!row){row={itemId,warehouse,location,qtyOnHand:0,qtyAllocated:0,averageCost:0};inventoryBalances.push(row);}return row;};
  const helpers={getBalance,qtyAvail:b=>Number(b.qtyOnHand)-Number(b.qtyAllocated),itemCost:i=>Number(i?.standardCost||i?.averageCost||i?.cost||0),adjustInventoryBalance:({itemId,warehouse,location,qtyIn=0,qtyOut=0,allocatedDelta=0,unitCost=0})=>{const b=getBalance(itemId,warehouse,location);b.qtyOnHand+=Number(qtyIn)-Number(qtyOut);b.qtyAllocated=Math.max(0,Number(b.qtyAllocated)+Number(allocatedDelta));if(qtyIn&&unitCost)b.averageCost=Number(unitCost);return b;},createInvAudit:r=>{inventoryTransactions.push(r);return r;},createPostedJournal:j=>{const row={...j,jeNumber:`JE-${journalEntries.length+1}`};journalEntries.push(row);return row;},periodFromDate:d=>String(d).slice(0,7),validateInventoryAndGlOpen:()=>{},validatePeriodOpen:()=>{},requireAccount:c=>String(c),calcPoLine:(x,i,poId)=>({id:`${poId}-L${i+1}`,poId,...x}),recalcPo:po=>po,nextPoId:(p,rows)=>`${p}-${rows.length+1}`};
  const runtime=createManufacturingRuntime({itemMaster,inventoryBalances,inventoryTransactions,purchaseOrders,purchaseOrderLines,purchaseReceiptLines,journalEntries,vendors,salesOrders,salesOrderLines,warehouses,inventoryLocations,helpers});
  const call=async(method,pathname,body={},user='operator')=>{const response=await runtime.handle({method,pathname,query:{},readBody:async()=>body,user:{user:{id:user}}});if(response.status>=400)throw new Error(response.body.error);return response.body;};
  return{runtime,call,getBalance,inventoryTransactions,journalEntries};
}

test('idempotency runtime patch is stable at its pipeline stage',()=>{
  assert.equal(reviewed,applyManufacturingAgent3IdempotencyRuntimePatch(reviewed));
  assert.match(reviewed,/processedRequests/);
  assert.match(reviewed,/clientRequestId/);
});

test('replayed material issue with the same request ID does not duplicate inventory or GL',async()=>{
  const f=fixture();
  await f.call('POST','/api/manufacturing/boms',{itemId:'FG',revision:'A',status:'Active',effectiveFrom:'2026-01-01',baseQty:1,yieldPct:100,components:[{lineId:'L1',itemId:'RM',qtyPer:2,supplyType:'Buy',issueMethod:'Manual'}],clientRequestId:'BOM-A'});
  const order=await f.call('POST','/api/manufacturing/orders',{itemId:'FG',quantity:1,clientRequestId:'ORDER-1'});
  await f.call('POST',`/api/manufacturing/orders/${order.id}/release`,{clientRequestId:'RELEASE-1'});
  const request={lines:[{lineId:'L1',quantity:1}],clientRequestId:'ISSUE-RETRY-001'};
  const first=await f.call('POST',`/api/manufacturing/orders/${order.id}/issue-materials`,request);
  const afterFirstQty=f.getBalance('RM','MAIN','A1').qtyOnHand,afterFirstJournalCount=f.journalEntries.length,afterFirstAuditCount=f.inventoryTransactions.length;
  const second=await f.call('POST',`/api/manufacturing/orders/${order.id}/issue-materials`,request);
  assert.deepEqual(second,first);
  assert.equal(afterFirstQty,9);
  assert.equal(f.getBalance('RM','MAIN','A1').qtyOnHand,9);
  assert.equal(f.journalEntries.length,afterFirstJournalCount);
  assert.equal(f.inventoryTransactions.length,afterFirstAuditCount);
  assert.equal(second.materials[0].qtyIssued,1);
  assert.equal(second.costs.material,5);
});

test('same request ID is scoped by user and endpoint',async()=>{
  const f=fixture();
  const first=await f.call('POST','/api/manufacturing/boms',{itemId:'FG',revision:'A',status:'Active',effectiveFrom:'2026-01-01',baseQty:1,yieldPct:100,components:[{lineId:'L1',itemId:'RM',qtyPer:1,supplyType:'Buy',issueMethod:'Manual'}],clientRequestId:'SHARED-ID'},'engineer-a');
  const second=await f.call('POST','/api/manufacturing/orders',{itemId:'FG',quantity:1,clientRequestId:'SHARED-ID'},'engineer-a');
  assert.equal(first.id,'BOM-FG-A');
  assert.match(second.id,/^MO-/);
});

test('manufacturing UI prevents simultaneous duplicate mutation requests and sends request IDs',async()=>{
  const client=await readFile(new URL('../public/manufacturingModule.js',import.meta.url),'utf8');const advanced=applyManufacturingAgent3UiClientPatch(client),engineering=applyManufacturingAgent3EngineeringClientPatch(advanced),idempotent=applyManufacturingAgent3IdempotencyClientPatch(engineering);
  assert.equal(idempotent,applyManufacturingAgent3IdempotencyClientPatch(idempotent));
  assert.doesNotThrow(()=>new Function(idempotent));
  assert.match(idempotent,/mfgInFlightMutations/);
  assert.match(idempotent,/clientRequestId:mfgRequestId\(\)/);
  assert.match(idempotent,/randomUUID/);
});
