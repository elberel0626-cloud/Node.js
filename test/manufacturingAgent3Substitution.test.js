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
import { applyManufacturingAgent3MrpExceptionsRuntimePatch, applyManufacturingAgent3MrpExceptionsClientPatch } from '../src/manufacturingAgent3MrpExceptionsPatch.js';
import { applyManufacturingAgent3SubstitutionRuntimePatch, applyManufacturingAgent3SubstitutionClientPatch } from '../src/manufacturingAgent3SubstitutionPatch.js';
import { routePermission } from '../src/routePermissions.js';

const original=await readFile(new URL('../src/manufacturingRuntime.js',import.meta.url),'utf8');
const beforeSubstitution=applyManufacturingAgent3MrpExceptionsRuntimePatch(applyManufacturingAgent3IdempotencyRuntimePatch(applyManufacturingAgent3GovernancePatch(applyManufacturingAgent3EngineeringRuntimePatch(applyManufacturingAgent3UiRuntimePatch(applyManufacturingAgent3FinalizationPatch(applyManufacturingAgent3AdvancedPatch(applyManufacturingAgent3MasterQualityPatch(applyManufacturingAgent3PlanningPatch(applyManufacturingAgent3RuntimePatch(original))))))))));
const reviewed=applyManufacturingAgent3SubstitutionRuntimePatch(beforeSubstitution);
const { createManufacturingRuntime }=await import(`data:text/javascript;base64,${Buffer.from(reviewed).toString('base64')}`);

function fixture(){
  const itemMaster=[
    {code:'RM-A',inventoryId:'RM-A',description:'Primary Material',type:'Stock Item',trackQuantity:true,averageCost:5,cost:5,inventoryAccount:'1507',defaultWarehouse:'MAIN',defaultLocation:'A1'},
    {code:'RM-B',inventoryId:'RM-B',description:'Approved Alternate',type:'Stock Item',trackQuantity:true,averageCost:6,cost:6,inventoryAccount:'1507',defaultWarehouse:'MAIN',defaultLocation:'A1'},
    {code:'RM-C',inventoryId:'RM-C',description:'Unapproved Alternate',type:'Stock Item',trackQuantity:true,averageCost:7,cost:7,inventoryAccount:'1507',defaultWarehouse:'MAIN',defaultLocation:'A1'},
    {code:'FG',inventoryId:'FG',description:'Finished Good',type:'Stock Item',trackQuantity:true,costingMethod:'Standard Cost',standardCost:20,cost:20,inventoryAccount:'1509',defaultWarehouse:'MAIN',defaultLocation:'FG'}
  ];
  const inventoryBalances=[
    {itemId:'RM-A',warehouse:'MAIN',location:'A1',qtyOnHand:0,qtyAllocated:0,averageCost:5},
    {itemId:'RM-B',warehouse:'MAIN',location:'A1',qtyOnHand:10,qtyAllocated:0,averageCost:6},
    {itemId:'RM-C',warehouse:'MAIN',location:'A1',qtyOnHand:10,qtyAllocated:0,averageCost:7},
    {itemId:'FG',warehouse:'MAIN',location:'FG',qtyOnHand:0,qtyAllocated:0,averageCost:20}
  ];
  const inventoryTransactions=[],purchaseOrders=[],purchaseOrderLines=[],purchaseReceiptLines=[],journalEntries=[],vendors=[],salesOrders=[],salesOrderLines=[],warehouses=[{warehouseId:'MAIN'},{warehouseId:'PROD'}],inventoryLocations=[{warehouse:'MAIN',locationId:'A1'},{warehouse:'MAIN',locationId:'FG'},{warehouse:'PROD',locationId:'PROD-WIP'}];
  const getBalance=(itemId,warehouse,location)=>{let row=inventoryBalances.find(r=>r.itemId===itemId&&r.warehouse===warehouse&&r.location===location);if(!row){row={itemId,warehouse,location,qtyOnHand:0,qtyAllocated:0,averageCost:0};inventoryBalances.push(row);}return row;};
  const helpers={
    getBalance,qtyAvail:b=>Number(b.qtyOnHand||0)-Number(b.qtyAllocated||0),itemCost:i=>Number(i?.standardCost||i?.averageCost||i?.cost||0),
    adjustInventoryBalance:({itemId,warehouse,location,qtyIn=0,qtyOut=0,allocatedDelta=0,unitCost=0})=>{const b=getBalance(itemId,warehouse,location);b.qtyOnHand=Number(b.qtyOnHand||0)+Number(qtyIn)-Number(qtyOut);b.qtyAllocated=Math.max(0,Number(b.qtyAllocated||0)+Number(allocatedDelta));if(qtyIn&&unitCost)b.averageCost=Number(unitCost);return b;},
    createInvAudit:r=>{inventoryTransactions.push(r);return r;},createPostedJournal:j=>{const row={...j,jeNumber:`JE-${journalEntries.length+1}`};journalEntries.push(row);return row;},periodFromDate:d=>String(d).slice(0,7),validateInventoryAndGlOpen:()=>{},validatePeriodOpen:()=>{},requireAccount:c=>String(c),calcPoLine:(x,i,poId)=>({id:`${poId}-L${i+1}`,poId,...x}),recalcPo:po=>po,nextPoId:(prefix,rows)=>`${prefix}-${rows.length+1}`
  };
  const runtime=createManufacturingRuntime({itemMaster,inventoryBalances,inventoryTransactions,purchaseOrders,purchaseOrderLines,purchaseReceiptLines,journalEntries,vendors,salesOrders,salesOrderLines,warehouses,inventoryLocations,helpers});
  const call=async(method,pathname,body={},user='operator')=>{const response=await runtime.handle({method,pathname,query:{},readBody:async()=>body,user:{user:{id:user}}});if(response.status>=400)throw new Error(response.body.error);return response.body;};
  return{runtime,call,getBalance,inventoryTransactions,journalEntries};
}

async function configure(f){
  await f.call('POST','/api/manufacturing/boms',{itemId:'FG',revision:'A',status:'Active',effectiveFrom:'2026-01-01',baseQty:1,yieldPct:100,components:[{lineId:'L1',itemId:'RM-A',qtyPer:1,supplyType:'Buy',issueMethod:'Backflush',approvedSubstitutes:[{itemId:'RM-B',qtyRatio:1.5}]}],clientRequestId:'BOM-A'},'engineer');
}

test('substitution patch is idempotent and protected by adjustment permission',()=>{
  assert.equal(reviewed,applyManufacturingAgent3SubstitutionRuntimePatch(reviewed));
  assert.match(reviewed,/Material Substituted/);
  assert.match(reviewed,/approvedSubstitutes/);
  assert.equal(routePermission('POST','/api/manufacturing/orders/MO-1001/substitute-material'),'INVENTORY_ADJUST');
  assert.equal(routePermission('POST','/api/manufacturing/orders/MO-1001/issue-materials'),'INVENTORY_POST');
});

test('only BOM-approved substitutes with a reason can replace unissued primary requirements',async()=>{
  const f=fixture();await configure(f);const order=await f.call('POST','/api/manufacturing/orders',{itemId:'FG',quantity:2,clientRequestId:'ORDER-1'});const released=await f.call('POST',`/api/manufacturing/orders/${order.id}/release`,{clientRequestId:'REL-1'});
  assert.equal(released.status,'Material Shortage');
  assert.equal(released.materials[0].shortageQty,2);
  await assert.rejects(()=>f.call('POST',`/api/manufacturing/orders/${order.id}/substitute-material`,{lineId:'L1',substituteItemId:'RM-C',quantity:2,reason:'Use alternate',clientRequestId:'SUB-BAD'}),/not an approved substitute/);
  await assert.rejects(()=>f.call('POST',`/api/manufacturing/orders/${order.id}/substitute-material`,{lineId:'L1',substituteItemId:'RM-B',quantity:2,clientRequestId:'SUB-NOREASON'}),/reason is required/);
  const substituted=await f.call('POST',`/api/manufacturing/orders/${order.id}/substitute-material`,{lineId:'L1',substituteItemId:'RM-B',quantity:2,reason:'Primary material shortage; approved alternate released by engineering.',clientRequestId:'SUB-1'},'planner');
  assert.equal(substituted.status,'Released');
  const primary=substituted.materials.find(row=>row.lineId==='L1'),alternate=substituted.materials.find(row=>row.isSubstitute);
  assert.equal(primary.itemId,'RM-A');
  assert.equal(primary.requiredQty,0);
  assert.equal(primary.substitutedPrimaryQty,2);
  assert.equal(alternate.itemId,'RM-B');
  assert.equal(alternate.requiredQty,3);
  assert.equal(alternate.qtyReserved,3);
  assert.equal(alternate.shortageQty,0);
  assert.equal(alternate.originalLineId,'L1');
  assert.equal(alternate.substitutionReason,'Primary material shortage; approved alternate released by engineering.');
  assert.equal(f.getBalance('RM-B','MAIN','A1').qtyAllocated,3);
});

test('backflush consumes the substitute at its actual cost and leaves the BOM master unchanged',async()=>{
  const f=fixture();await configure(f);const order=await f.call('POST','/api/manufacturing/orders',{itemId:'FG',quantity:2,clientRequestId:'ORDER-2'});await f.call('POST',`/api/manufacturing/orders/${order.id}/release`,{clientRequestId:'REL-2'});await f.call('POST',`/api/manufacturing/orders/${order.id}/substitute-material`,{lineId:'L1',substituteItemId:'RM-B',quantity:2,reason:'Approved substitute for shortage.',clientRequestId:'SUB-2'},'planner');
  const completed=await f.call('POST',`/api/manufacturing/orders/${order.id}/complete`,{quantity:2,scrapQty:0,clientRequestId:'COMP-2'});
  const alternate=completed.materials.find(row=>row.isSubstitute);
  assert.equal(alternate.qtyIssued,3);
  assert.equal(completed.costs.material,18);
  assert.equal(f.getBalance('RM-B','MAIN','A1').qtyOnHand,7);
  assert.equal(f.getBalance('RM-B','MAIN','A1').qtyAllocated,0);
  assert.equal(f.getBalance('RM-A','MAIN','A1').qtyOnHand,0);
  assert.equal(completed.qtyCompleted,2);
  assert.equal(f.journalEntries.some(je=>(je.lines||[]).some(line=>String(line.description||'').includes('RM-B'))),true);
  const boms=await f.call('GET','/api/manufacturing/boms');const bom=boms.find(row=>row.itemId==='FG'&&row.revision==='A');
  assert.equal(bom.components[0].itemId,'RM-A');
  assert.equal(bom.components[0].qtyPer,1);
  assert.deepEqual(bom.components[0].approvedSubstitutes.map(row=>({itemId:row.itemId,qtyRatio:row.qtyRatio})),[{itemId:'RM-B',qtyRatio:1.5}]);
  assert.equal(f.runtime.state.auditTrail.some(row=>row.action==='Material Substituted'&&row.entityId===order.id),true);
});

test('substitution UI compiles and exposes approved alternate setup and production override controls',async()=>{
  const client=await readFile(new URL('../public/manufacturingModule.js',import.meta.url),'utf8');
  const advanced=applyManufacturingAgent3UiClientPatch(client),engineering=applyManufacturingAgent3EngineeringClientPatch(advanced),idempotent=applyManufacturingAgent3IdempotencyClientPatch(engineering),mrp=applyManufacturingAgent3MrpExceptionsClientPatch(idempotent),substitution=applyManufacturingAgent3SubstitutionClientPatch(mrp);
  assert.equal(substitution,applyManufacturingAgent3SubstitutionClientPatch(substitution));
  assert.doesNotThrow(()=>new Function(substitution));
  assert.match(substitution,/Approved Substitutes/);
  assert.match(substitution,/Substitute Component/);
  assert.match(substitution,/substitute-material/);
  assert.match(substitution,/does not alter the released BOM revision/);
});
