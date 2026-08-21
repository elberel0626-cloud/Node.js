import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyManufacturingAgent3RuntimePatch } from '../src/manufacturingAgent3ReviewPatch.js';
import { applyManufacturingAgent3PlanningPatch } from '../src/manufacturingAgent3PlanningPatch.js';
import { applyManufacturingAgent3MasterQualityPatch } from '../src/manufacturingAgent3MasterQualityPatch.js';
import { applyManufacturingAgent3AdvancedPatch } from '../src/manufacturingAgent3AdvancedPatch.js';
import { applyManufacturingAgent3FinalizationPatch } from '../src/manufacturingAgent3FinalizationPatch.js';
import { routePermission } from '../src/routePermissions.js';

const original=await readFile(new URL('../src/manufacturingRuntime.js',import.meta.url),'utf8');
const preAdvanced=applyManufacturingAgent3MasterQualityPatch(applyManufacturingAgent3PlanningPatch(applyManufacturingAgent3RuntimePatch(original)));
const advanced=applyManufacturingAgent3AdvancedPatch(preAdvanced);
const advancedAgain=applyManufacturingAgent3AdvancedPatch(advanced);
const reviewed=applyManufacturingAgent3FinalizationPatch(advanced);
const reviewedAgain=applyManufacturingAgent3FinalizationPatch(reviewed);
const { createManufacturingRuntime }=await import(`data:text/javascript;base64,${Buffer.from(reviewed).toString('base64')}`);

function fixture(){
  const itemMaster=[
    {code:'RM-1',inventoryId:'RM-1',description:'Raw',type:'Stock Item',trackQuantity:true,costingMethod:'Average Cost',averageCost:5,cost:5,inventoryAccount:'1507',defaultWarehouse:'MAIN',defaultLocation:'MAIN-A1',leadTimeDays:2},
    {code:'PH-1',inventoryId:'PH-1',description:'Phantom',type:'Stock Item',trackQuantity:true,costingMethod:'Standard Cost',standardCost:0,cost:0,inventoryAccount:'1507',defaultWarehouse:'MAIN',defaultLocation:'MAIN-A1',leadTimeDays:1},
    {code:'FG-1',inventoryId:'FG-1',description:'Finished',type:'Stock Item',trackQuantity:true,costingMethod:'Standard Cost',standardCost:30,cost:30,inventoryAccount:'1509',defaultWarehouse:'MAIN',defaultLocation:'MAIN-FG',leadTimeDays:3},
    {code:'SVC-OUT',inventoryId:'SVC-OUT',description:'Outside Processing',type:'Service Item',trackQuantity:false,costingMethod:'Average Cost',averageCost:12,cost:12,expenseAccount:'1508',defaultWarehouse:'PROD',defaultLocation:'PROD-WIP'}
  ];
  const inventoryBalances=[{itemId:'RM-1',warehouse:'MAIN',location:'MAIN-A1',qtyOnHand:100,qtyAllocated:0,averageCost:5},{itemId:'FG-1',warehouse:'MAIN',location:'MAIN-FG',qtyOnHand:0,qtyAllocated:0,averageCost:30}];
  const inventoryTransactions=[],purchaseOrders=[],purchaseOrderLines=[],purchaseReceiptLines=[],journalEntries=[],vendors=[{id:'V-OUT',name:'Outside Vendor',status:'Active',terms:'NET30',currency:'USD'}],salesOrders=[],salesOrderLines=[];
  const warehouses=[{warehouseId:'MAIN',name:'Main'},{warehouseId:'PROD',name:'Production'}],inventoryLocations=[{warehouse:'MAIN',locationId:'MAIN-A1'},{warehouse:'MAIN',locationId:'MAIN-FG'},{warehouse:'PROD',locationId:'PROD-WIP'}];
  const valid=new Set(['1507','1508','1509','2020','5101','5109','5120']);
  const getBalance=(itemId,warehouse,location)=>{let row=inventoryBalances.find(x=>x.itemId===itemId&&x.warehouse===warehouse&&x.location===location);if(!row){row={itemId,warehouse,location,qtyOnHand:0,qtyAllocated:0,averageCost:Number(itemMaster.find(i=>i.code===itemId)?.averageCost||0)};inventoryBalances.push(row);}return row;};
  const adjustInventoryBalance=({itemId,warehouse,location,qtyIn=0,qtyOut=0,allocatedDelta=0,unitCost=0})=>{const b=getBalance(itemId,warehouse,location),oldQty=Number(b.qtyOnHand||0),oldValue=oldQty*Number(b.averageCost||unitCost||0);b.qtyOnHand=oldQty+Number(qtyIn)-Number(qtyOut);b.qtyAllocated=Math.max(0,Number(b.qtyAllocated)+Number(allocatedDelta));if(qtyIn&&unitCost)b.averageCost=(oldValue+Number(qtyIn)*Number(unitCost))/(oldQty+Number(qtyIn)||1);return b;};
  const helpers={getBalance,qtyAvail:b=>Number(b.qtyOnHand)-Number(b.qtyAllocated),itemCost:i=>Number(i?.costingMethod==='Standard Cost'?i?.standardCost:i?.averageCost||i?.cost||0),adjustInventoryBalance,createInvAudit:row=>{inventoryTransactions.push(row);return row;},createPostedJournal:input=>{const je={...input,jeNumber:`JE${String(journalEntries.length+1).padStart(6,'0')}`};journalEntries.push(je);return je;},periodFromDate:value=>String(value).slice(0,7),validateInventoryAndGlOpen:()=>{},validatePeriodOpen:()=>{},requireAccount:code=>{const value=String(code||'');if(!valid.has(value))throw new Error(`Posting account ${value} was not found.`);return value;},calcPoLine:(input,index,poId)=>({id:`${poId}-L${index+1}`,poId,lineId:`L${index+1}`,inventoryId:input.inventoryId,itemId:input.inventoryId,qtyOrdered:Number(input.qtyOrdered||0),qtyReceived:0,qtyCancelled:0,qtyOpen:Number(input.qtyOrdered||0),unitCost:Number(input.unitCost||0),warehouse:input.warehouse,location:input.location,requestedDate:input.requestedDate,expenseAccount:input.expenseAccount||'5110',apAccrualAccount:'2020'}),recalcPo:po=>po,nextPoId:(prefix,rows)=>`${prefix}-${String(rows.length+1001).padStart(4,'0')}`};
  const runtime=createManufacturingRuntime({itemMaster,inventoryBalances,inventoryTransactions,purchaseOrders,purchaseOrderLines,purchaseReceiptLines,journalEntries,vendors,salesOrders,salesOrderLines,warehouses,inventoryLocations,helpers});
  const call=async(method,pathname,body={},query={})=>{const response=await runtime.handle({method,pathname,query,readBody:async()=>body,user:{user:{id:'agent3-advanced'}}});if(response.status>=400)throw new Error(response.body.error);return response.body;};
  return{runtime,call,itemMaster,inventoryBalances,inventoryTransactions,purchaseOrders,purchaseOrderLines,purchaseReceiptLines,journalEntries,getBalance};
}

async function configure(f){
  await f.call('POST','/api/manufacturing/boms',{itemId:'PH-1',revision:'A',status:'Active',effectiveFrom:'2026-01-01',baseQty:1,yieldPct:100,components:[{lineId:'P1',itemId:'RM-1',qtyPer:2,supplyType:'Buy',issueMethod:'Manual'}]});
  await f.call('POST','/api/manufacturing/boms',{itemId:'FG-1',revision:'A',status:'Active',effectiveFrom:'2026-01-01',baseQty:1,yieldPct:100,components:[{lineId:'F1',itemId:'PH-1',qtyPer:1,supplyType:'Phantom',issueMethod:'Manual'}]});
  await f.call('POST','/api/manufacturing/routings',{itemId:'FG-1',revision:'A',status:'Active',effectiveFrom:'2026-01-01',operations:[{sequence:10,workCenterId:'WC-ASSY',description:'Internal Assembly',runHoursPerUnit:.5},{sequence:20,workCenterId:'WC-QC',description:'Outside Finish',runHoursPerUnit:0,outsideProcessing:true,vendorId:'V-OUT',serviceItemId:'SVC-OUT',outsideUnitCost:12}]});
}

test('advanced and finalization patches are idempotent at their pipeline stages',()=>{
  assert.equal(advanced,advancedAgain);
  assert.equal(reviewed,reviewedAgain);
  assert.match(reviewed,/outsideProcessingReceivedCost/);
  assert.match(reviewed,/rollStandardCost/);
  assert.match(reviewed,/wipReconciliationReport/);
  assert.match(reviewed,/Phantom component/);
  assert.equal(routePermission('POST','/api/manufacturing/orders/MO-1001/create-subcontract-po'),'PO_CREATE');
});

test('phantom BOM components explode into real shop-floor material requirements',async()=>{
  const f=fixture();await configure(f);const order=await f.call('POST','/api/manufacturing/orders',{itemId:'FG-1',quantity:3});
  assert.equal(order.materials.length,1);
  assert.equal(order.materials[0].itemId,'RM-1');
  assert.equal(order.materials[0].requiredQty,6);
  assert.equal(order.materials[0].phantomParent,'PH-1');
  assert.equal(order.materials.some(line=>line.itemId==='PH-1'),false);
});

test('standard-cost rollup includes multi-level material, internal conversion, and outside processing',async()=>{
  const f=fixture();await configure(f);const preview=await f.call('GET','/api/manufacturing/cost-rollup',{}, {itemId:'FG-1',effectiveDate:'2026-08-21'});
  assert.equal(preview.material,10);
  assert.equal(preview.labor,14.5);
  assert.equal(preview.machine,4);
  assert.equal(preview.overhead,7.5);
  assert.equal(preview.outsideProcessing,12);
  assert.equal(preview.total,48);
  await assert.rejects(()=>f.call('POST','/api/manufacturing/cost-rollup/apply',{itemId:'FG-1'}),/confirm=true/);
  const applied=await f.call('POST','/api/manufacturing/cost-rollup/apply',{itemId:'FG-1',confirm:true});
  assert.equal(applied.previousStandardCost,30);
  assert.equal(f.itemMaster.find(row=>row.code==='FG-1').standardCost,48);
});

test('outside processing creates a normal service PO whose receipt capitalizes into WIP and reconciles to GL',async()=>{
  const f=fixture();await configure(f);const order=await f.call('POST','/api/manufacturing/orders',{itemId:'FG-1',quantity:2});await f.call('POST',`/api/manufacturing/orders/${order.id}/release`,{});await f.call('POST',`/api/manufacturing/orders/${order.id}/issue-materials`,{});
  const result=await f.call('POST',`/api/manufacturing/orders/${order.id}/create-subcontract-po`,{sequence:20});
  assert.equal(result.purchaseOrder.poType,'SV');
  assert.equal(result.purchaseOrder.status,'Saved');
  assert.equal(result.purchaseOrderLine.expenseAccount,'1508');
  assert.equal(result.purchaseOrderLine.outsideProcessing,true);
  assert.equal(result.purchaseOrderLine.sourceProductionOrder,order.id);
  await assert.rejects(()=>f.call('POST',`/api/manufacturing/orders/${order.id}/report-operation`,{sequence:20}),/subcontract PO receipt is posted/);
  const poLine=f.purchaseOrderLines.find(line=>line.id===result.purchaseOrderLine.id);poLine.qtyReceived=2;poLine.qtyOpen=0;f.purchaseReceiptLines.push({id:'RCL-1',receiptId:'PR-OUT-1',poLineId:poLine.id,poId:poLine.poId,receiptQty:2});f.journalEntries.push({module:'Inventory',sourceRef:'PR-OUT-1',jeNumber:'JE-OUT',lines:[{account:'1508',debit:24,credit:0},{account:'2020',debit:0,credit:24}]});
  const reported=await f.call('POST',`/api/manufacturing/orders/${order.id}/report-operation`,{sequence:20});
  assert.equal(reported.operations.find(op=>op.sequence===20).status,'Completed');
  assert.equal(reported.wipAdded,44);
  const [recon]=await f.call('GET','/api/manufacturing/reports/wip-reconciliation');
  assert.equal(recon.subledgerWip,44);
  assert.equal(recon.glWip,44);
  assert.equal(recon.difference,0);
  assert.equal(recon.inBalance,true);
});
