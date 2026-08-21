import test from 'node:test';
import assert from 'node:assert/strict';
import { createManufacturingRuntime } from '../src/manufacturingRuntime.js';
import { applyManufacturingModulePatch } from '../src/manufacturingModulePatch.js';
import { routePermission } from '../src/routePermissions.js';

function fixture({salesDemand=0}={}){
  const itemMaster=[
    {code:'RM-1',inventoryId:'RM-1',description:'Raw Material',type:'Stock Item',trackQuantity:true,uom:'EA',costingMethod:'Average Cost',averageCost:5,standardCost:5,cost:5,inventoryAccount:'1507',defaultWarehouse:'MAIN',defaultLocation:'MAIN-A1',preferredVendor:'V-1'},
    {code:'FG-1',inventoryId:'FG-1',description:'Finished Good',type:'Stock Item',trackQuantity:true,uom:'EA',costingMethod:'Standard Cost',averageCost:30,standardCost:30,cost:30,inventoryAccount:'1509',defaultWarehouse:'MAIN',defaultLocation:'MAIN-FG'}
  ];
  const inventoryBalances=[{itemId:'RM-1',warehouse:'MAIN',location:'MAIN-A1',qtyOnHand:10,qtyAllocated:0,averageCost:5},{itemId:'FG-1',warehouse:'MAIN',location:'MAIN-FG',qtyOnHand:0,qtyAllocated:0,averageCost:30}];
  const inventoryTransactions=[],purchaseOrders=[],purchaseOrderLines=[],vendors=[{id:'V-1',name:'Vendor One',status:'Active',terms:'NET30',currency:'USD'}],salesOrders=salesDemand?[{id:'SO-1',orderNumber:'SO-1',status:'Open',requestedDate:'2026-08-30'}]:[],salesOrderLines=salesDemand?[{id:'SOL-1',salesOrderId:'SO-1',inventoryId:'FG-1',qtyOrdered:salesDemand,qtyShipped:0}]:[],journals=[];
  const getBalance=(itemId,warehouse,location)=>{let row=inventoryBalances.find(x=>x.itemId===itemId&&x.warehouse===warehouse&&x.location===location);if(!row){row={itemId,warehouse,location,qtyOnHand:0,qtyAllocated:0,averageCost:Number(itemMaster.find(i=>i.code===itemId)?.averageCost||0)};inventoryBalances.push(row);}return row;};
  const adjustInventoryBalance=({itemId,warehouse,location,qtyIn=0,qtyOut=0,allocatedDelta=0,unitCost=0})=>{const b=getBalance(itemId,warehouse,location);const oldQty=b.qtyOnHand;b.qtyOnHand=oldQty+Number(qtyIn)-Number(qtyOut);b.qtyAllocated=Math.max(0,Number(b.qtyAllocated)+Number(allocatedDelta));if(qtyIn&&unitCost)b.averageCost=((oldQty*Number(b.averageCost||0))+(Number(qtyIn)*Number(unitCost)))/(oldQty+Number(qtyIn));return b;};
  const helpers={
    getBalance,qtyAvail:b=>Number(b.qtyOnHand)-Number(b.qtyAllocated),itemCost:i=>Number(i?.costingMethod==='Standard Cost'?i?.standardCost:i?.averageCost||i?.cost||0),adjustInventoryBalance,
    createInvAudit:row=>{inventoryTransactions.push(row);return row;},
    createPostedJournal:input=>{const je={...input,jeNumber:`JE${String(journals.length+1).padStart(6,'0')}`};journals.push(je);return je;},
    periodFromDate:value=>String(value).slice(0,7),validateInventoryAndGlOpen:()=>{},
    calcPoLine:(input,index,poId)=>({id:`${poId}-L${index+1}`,poId,inventoryId:input.inventoryId,qtyOrdered:input.qtyOrdered,qtyReceived:0,qtyCancelled:0,qtyOpen:input.qtyOrdered,unitCost:input.unitCost,warehouse:input.warehouse,location:input.location}),
    recalcPo:po=>po,nextPoId:(prefix,rows)=>`${prefix}-${String(rows.length+1001).padStart(4,'0')}`
  };
  const runtime=createManufacturingRuntime({itemMaster,inventoryBalances,inventoryTransactions,purchaseOrders,purchaseOrderLines,vendors,salesOrders,salesOrderLines,warehouses:[{warehouseId:'MAIN'},{warehouseId:'PROD'}],inventoryLocations:[],helpers});
  const call=async(method,pathname,body={})=>{const response=await runtime.handle({method,pathname,query:{},readBody:async()=>body,user:{user:{id:'tester'}}});if(response.status>=400)throw new Error(response.body.error);return response.body;};
  return{runtime,call,itemMaster,inventoryBalances,inventoryTransactions,purchaseOrders,purchaseOrderLines,journals,getBalance};
}

async function addBomAndRouting(f){
  await f.call('POST','/api/manufacturing/boms',{itemId:'FG-1',revision:'A',status:'Active',baseQty:1,yieldPct:100,components:[{itemId:'RM-1',qtyPer:1,issueMethod:'Manual',supplyType:'Buy'}]});
  await f.call('POST','/api/manufacturing/routings',{itemId:'FG-1',revision:'A',status:'Active',operations:[{sequence:10,workCenterId:'WC-ASSY',description:'Assembly',runHoursPerUnit:.5}]});
}

test('manufacturing production lifecycle updates inventory and clears WIP',async()=>{
  const f=fixture();await addBomAndRouting(f);
  const created=await f.call('POST','/api/manufacturing/orders',{itemId:'FG-1',quantity:2,dueDate:'2026-08-30'});
  await f.call('POST',`/api/manufacturing/orders/${created.id}/release`,{});
  await f.call('POST',`/api/manufacturing/orders/${created.id}/issue-materials`,{});
  await f.call('POST',`/api/manufacturing/orders/${created.id}/report-operation`,{sequence:10,laborHours:1,machineHours:0,qtyGood:2});
  await f.call('POST',`/api/manufacturing/orders/${created.id}/complete`,{quantity:2});
  const closed=await f.call('POST',`/api/manufacturing/orders/${created.id}/close`,{});
  assert.equal(closed.status,'Closed');
  assert.equal(f.getBalance('RM-1','MAIN','MAIN-A1').qtyOnHand,8);
  assert.equal(f.getBalance('FG-1','MAIN','MAIN-FG').qtyOnHand,2);
  assert.equal(closed.wipBalance,0);
  assert.ok(f.journals.length>=3);
  assert.ok(f.inventoryTransactions.some(t=>t.transactionType==='Production Material Issue'));
  assert.ok(f.inventoryTransactions.some(t=>t.transactionType==='Production Receipt'));
});

test('MRP creates make suggestions for active BOM items and buy suggestions for components',async()=>{
  const f=fixture({salesDemand:12});await addBomAndRouting(f);
  const result=await f.call('POST','/api/manufacturing/mrp/run',{});
  assert.ok(result.plannedOrders.some(p=>p.type==='Make'&&p.itemId==='FG-1'));
  assert.ok(result.plannedOrders.some(p=>p.type==='Buy'&&p.itemId==='RM-1'));
});

test('manufacturing server patch is idempotent and adds the module router',()=>{
  const source=`import { financialWorkbook } from './xlsxWorkbook.js';\nconst periodModules = ['AR','AP','GL','Inventory'];\nfunction financeSourceHref(module,documentType,reference){ const ref=String(reference),mod=String(module||'').toUpperCase(); if(mod==='SALES ORDERS'){const shipment=shipments.find(d=>String(d.id)===ref||String(d.shipmentNumber)===ref);if(shipment)return\`/sales-orders/shipments/\${encodeURIComponent(shipment.shipmentNumber||shipment.id)}\`;return\`/sales-orders/orders/\${encodeURIComponent(ref)}\`;}\n return'';\n}\nseedInventory();\nfunction adjustInventoryBalance(){ }\nif(method==='GET'&&pathname==='/api/inventory/summary') return json(res,200,invSummary());`;
  const once=applyManufacturingModulePatch(source),twice=applyManufacturingModulePatch(once);
  assert.equal(once,twice);
  assert.match(once,/createManufacturingRuntime/);
  assert.match(once,/pathname\.startsWith\('\/api\/manufacturing'\)/);
  assert.match(once,/'Manufacturing'/);
});

test('manufacturing routes are deny-by-default permission mapped',()=>{
  assert.equal(routePermission('GET','/api/manufacturing/orders'),'INVENTORY_READ');
  assert.equal(routePermission('POST','/api/manufacturing/orders/MO-1001/complete'),'INVENTORY_POST');
  assert.equal(routePermission('POST','/api/manufacturing/mrp/run'),'INVENTORY_ADJUST');
  assert.equal(routePermission('PUT','/api/manufacturing/settings'),'SYSTEM_CONFIGURATION_ADMIN');
});
