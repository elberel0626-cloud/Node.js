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

const original=await readFile(new URL('../src/manufacturingRuntime.js',import.meta.url),'utf8');
const idempotent=applyManufacturingAgent3IdempotencyRuntimePatch(applyManufacturingAgent3GovernancePatch(applyManufacturingAgent3EngineeringRuntimePatch(applyManufacturingAgent3UiRuntimePatch(applyManufacturingAgent3FinalizationPatch(applyManufacturingAgent3AdvancedPatch(applyManufacturingAgent3MasterQualityPatch(applyManufacturingAgent3PlanningPatch(applyManufacturingAgent3RuntimePatch(original)))))))));
const reviewed=applyManufacturingAgent3MrpExceptionsRuntimePatch(idempotent);
const { createManufacturingRuntime }=await import(`data:text/javascript;base64,${Buffer.from(reviewed).toString('base64')}`);

function fixture(){
  const itemMaster=['LATE','EARLY','EXCESS','DRAFT'].map(code=>({code,inventoryId:code,description:`${code} component`,type:'Stock Item',trackQuantity:true,averageCost:5,cost:5,inventoryAccount:'1507',defaultWarehouse:'MAIN',defaultLocation:'A1',leadTimeDays:3,safetyStock:0}));
  const inventoryBalances=itemMaster.map(row=>({itemId:row.code,warehouse:'MAIN',location:'A1',qtyOnHand:0,qtyAllocated:0,averageCost:5}));
  const purchaseOrders=[
    {id:'PO-LATE',poNumber:'PO-LATE',status:'Open',orderDate:'2026-08-21',requestedDate:'2026-08-30'},
    {id:'PO-EARLY',poNumber:'PO-EARLY',status:'Open',orderDate:'2026-08-21',requestedDate:'2026-08-22'},
    {id:'PO-EXCESS',poNumber:'PO-EXCESS',status:'Partially Received',orderDate:'2026-08-21',requestedDate:'2026-08-25'},
    {id:'PO-DRAFT',poNumber:'PO-DRAFT',status:'Saved',orderDate:'2026-08-21',requestedDate:'2026-08-24'}
  ];
  const purchaseOrderLines=[
    {id:'PO-LATE-L1',poId:'PO-LATE',inventoryId:'LATE',qtyOrdered:5,qtyReceived:0,qtyCancelled:0,qtyOpen:5,requestedDate:'2026-08-30',unitCost:5},
    {id:'PO-EARLY-L1',poId:'PO-EARLY',inventoryId:'EARLY',qtyOrdered:4,qtyReceived:0,qtyCancelled:0,qtyOpen:4,requestedDate:'2026-08-22',unitCost:5},
    {id:'PO-EXCESS-L1',poId:'PO-EXCESS',inventoryId:'EXCESS',qtyOrdered:10,qtyReceived:3,qtyCancelled:0,qtyOpen:7,requestedDate:'2026-08-25',unitCost:5},
    {id:'PO-DRAFT-L1',poId:'PO-DRAFT',inventoryId:'DRAFT',qtyOrdered:9,qtyReceived:0,qtyCancelled:0,qtyOpen:9,requestedDate:'2026-08-24',unitCost:5}
  ];
  const purchaseReceiptLines=[],journalEntries=[],vendors=[],inventoryTransactions=[],salesOrders=[
    {id:'SO-LATE',orderNumber:'SO-LATE',status:'Open',requestedDate:'2026-08-25'},
    {id:'SO-EARLY',orderNumber:'SO-EARLY',status:'Open',requestedDate:'2026-09-10'}
  ];
  const salesOrderLines=[
    {salesOrderId:'SO-LATE',inventoryId:'LATE',qtyOrdered:5,qtyShipped:0,qtyCancelled:0},
    {salesOrderId:'SO-EARLY',inventoryId:'EARLY',qtyOrdered:4,qtyShipped:0,qtyCancelled:0}
  ];
  const warehouses=[{warehouseId:'MAIN'},{warehouseId:'PROD'}],inventoryLocations=[{warehouse:'MAIN',locationId:'A1'},{warehouse:'PROD',locationId:'PROD-WIP'}];
  const getBalance=(itemId,warehouse,location)=>inventoryBalances.find(row=>row.itemId===itemId&&row.warehouse===warehouse&&row.location===location)||{itemId,warehouse,location,qtyOnHand:0,qtyAllocated:0,averageCost:0};
  const helpers={getBalance,qtyAvail:b=>Number(b.qtyOnHand||0)-Number(b.qtyAllocated||0),itemCost:i=>Number(i?.averageCost||i?.cost||0),adjustInventoryBalance:()=>{},createInvAudit:r=>r,createPostedJournal:j=>({...j,jeNumber:'JE-1'}),periodFromDate:d=>String(d).slice(0,7),validateInventoryAndGlOpen:()=>{},validatePeriodOpen:()=>{},requireAccount:c=>String(c),calcPoLine:(x,i,poId)=>({id:`${poId}-L${i+1}`,poId,...x}),recalcPo:po=>po,nextPoId:(prefix,rows)=>`${prefix}-${rows.length+1}`};
  const runtime=createManufacturingRuntime({itemMaster,inventoryBalances,inventoryTransactions,purchaseOrders,purchaseOrderLines,purchaseReceiptLines,journalEntries,vendors,salesOrders,salesOrderLines,warehouses,inventoryLocations,helpers});
  const call=async(method,pathname,body={},query={})=>{const response=await runtime.handle({method,pathname,query,readBody:async()=>body,user:{user:{id:'planner'}}});if(response.status>=400)throw new Error(response.body.error);return response.body;};
  return{runtime,call,purchaseOrders,purchaseOrderLines};
}

test('MRP exception patch is idempotent at its pipeline stage',()=>{
  assert.equal(reviewed,applyManufacturingAgent3MrpExceptionsRuntimePatch(reviewed));
  assert.match(reviewed,/mrpActionMessages/);
  assert.match(reviewed,/Cancel \/ Reduce/);
  assert.match(reviewed,/Partially Received/);
});

test('MRP action messages recommend expedite, defer, and cancel/reduce without mutating supply documents',async()=>{
  const f=fixture();
  const before=structuredClone(f.purchaseOrders);
  const messages=await f.call('GET','/api/manufacturing/mrp/action-messages',{}, {horizonDays:90,deferDays:7});
  const late=messages.find(row=>row.reference==='PO-LATE');
  const early=messages.find(row=>row.reference==='PO-EARLY');
  const excess=messages.find(row=>row.reference==='PO-EXCESS');
  assert.equal(late.type,'Expedite');
  assert.equal(late.quantity,5);
  assert.equal(late.currentDate,'2026-08-30');
  assert.equal(late.recommendedDate,'2026-08-25');
  assert.equal(late.severity,'High');
  assert.equal(early.type,'Defer');
  assert.equal(early.quantity,4);
  assert.equal(early.currentDate,'2026-08-22');
  assert.equal(early.recommendedDate,'2026-09-10');
  assert.equal(excess.type,'Cancel / Reduce');
  assert.equal(excess.quantity,7);
  assert.equal(excess.severity,'Medium');
  assert.equal(messages.some(row=>row.reference==='PO-DRAFT'),false);
  assert.deepEqual(f.purchaseOrders,before);
});

test('MRP run returns planner action messages while still generating time-phased planned supply',async()=>{
  const f=fixture();
  const result=await f.call('POST','/api/manufacturing/mrp/run',{clientRequestId:'MRP-RUN-001'});
  assert.ok(Array.isArray(result.actionMessages));
  assert.equal(result.actionMessages.some(row=>row.reference==='PO-LATE'&&row.type==='Expedite'),true);
  assert.equal(result.actionMessages.some(row=>row.reference==='PO-DRAFT'),false);
  assert.equal(result.plannedOrders.some(row=>row.itemId==='LATE'&&row.type==='Buy'),true);
});

test('MRP planner UI compiles and exposes advisory action messages',async()=>{
  const client=await readFile(new URL('../public/manufacturingModule.js',import.meta.url),'utf8');
  const advanced=applyManufacturingAgent3UiClientPatch(client),engineering=applyManufacturingAgent3EngineeringClientPatch(advanced),idempotentClient=applyManufacturingAgent3IdempotencyClientPatch(engineering),planner=applyManufacturingAgent3MrpExceptionsClientPatch(idempotentClient);
  assert.equal(planner,applyManufacturingAgent3MrpExceptionsClientPatch(planner));
  assert.doesNotThrow(()=>new Function(planner));
  assert.match(planner,/Planner Action Messages/);
  assert.match(planner,/mrp\/action-messages/);
  assert.match(planner,/No expedite, defer, or cancel\/reduce recommendations/);
});
