import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyManufacturingAgent3RuntimePatch } from '../src/manufacturingAgent3ReviewPatch.js';
import { routePermission } from '../src/routePermissions.js';

const originalSource=await readFile(new URL('../src/manufacturingRuntime.js',import.meta.url),'utf8');
const patchedSource=applyManufacturingAgent3RuntimePatch(originalSource);
const patchedAgain=applyManufacturingAgent3RuntimePatch(patchedSource);
const patchedModule=await import(`data:text/javascript;base64,${Buffer.from(patchedSource).toString('base64')}`);

function fixture({onHand=10,manufacturingOpen=true}={}){
  const itemMaster=[
    {code:'RM-1',inventoryId:'RM-1',description:'Raw Material',type:'Stock Item',trackQuantity:true,uom:'EA',averageCost:5,cost:5,inventoryAccount:'1507',defaultWarehouse:'MAIN',defaultLocation:'MAIN-A1',preferredVendor:'V-1'},
    {code:'FG-1',inventoryId:'FG-1',description:'Finished Good',type:'Stock Item',trackQuantity:true,uom:'EA',costingMethod:'Standard Cost',standardCost:30,cost:30,inventoryAccount:'1509',defaultWarehouse:'MAIN',defaultLocation:'MAIN-FG'}
  ];
  const inventoryBalances=[{itemId:'RM-1',warehouse:'MAIN',location:'MAIN-A1',qtyOnHand:onHand,qtyAllocated:0,averageCost:5},{itemId:'FG-1',warehouse:'MAIN',location:'MAIN-FG',qtyOnHand:0,qtyAllocated:0,averageCost:30}];
  const inventoryTransactions=[],purchaseOrders=[],purchaseOrderLines=[],vendors=[{id:'V-1',name:'Vendor One',status:'Active',terms:'NET30',currency:'USD'}],salesOrders=[],salesOrderLines=[],journals=[];
  const warehouses=[{warehouseId:'MAIN',name:'Main'},{warehouseId:'PROD',name:'Production'}];
  const inventoryLocations=[{warehouse:'MAIN',locationId:'MAIN-A1'},{warehouse:'MAIN',locationId:'MAIN-FG'},{warehouse:'PROD',locationId:'PROD-WIP'}];
  const validAccounts=new Set(['1507','1508','1509','5101','5109','5120']);
  let isManufacturingOpen=manufacturingOpen;
  const getBalance=(itemId,warehouse,location)=>{let row=inventoryBalances.find(x=>x.itemId===itemId&&x.warehouse===warehouse&&x.location===location);if(!row){row={itemId,warehouse,location,qtyOnHand:0,qtyAllocated:0,averageCost:Number(itemMaster.find(i=>i.code===itemId)?.averageCost||0)};inventoryBalances.push(row);}return row;};
  const adjustInventoryBalance=({itemId,warehouse,location,qtyIn=0,qtyOut=0,allocatedDelta=0,unitCost=0})=>{const b=getBalance(itemId,warehouse,location),oldQty=Number(b.qtyOnHand||0),oldValue=oldQty*Number(b.averageCost||unitCost||0);b.qtyOnHand=oldQty+Number(qtyIn)-Number(qtyOut);b.qtyAllocated=Math.max(0,Number(b.qtyAllocated)+Number(allocatedDelta));if(qtyIn&&unitCost)b.averageCost=(oldValue+Number(qtyIn)*Number(unitCost))/(oldQty+Number(qtyIn)||1);return b;};
  const helpers={
    getBalance,qtyAvail:b=>Number(b.qtyOnHand)-Number(b.qtyAllocated),itemCost:i=>Number(i?.costingMethod==='Standard Cost'?i?.standardCost:i?.averageCost||i?.cost||0),adjustInventoryBalance,
    createInvAudit:row=>{inventoryTransactions.push(row);return row;},
    createPostedJournal:input=>{const je={...input,jeNumber:`JE${String(journals.length+1).padStart(6,'0')}`};journals.push(je);return je;},
    periodFromDate:value=>String(value).slice(0,7),
    validateInventoryAndGlOpen:()=>{},
    validatePeriodOpen:(module)=>{if(module==='Manufacturing'&&!isManufacturingOpen)throw new Error('Manufacturing period is closed.');},
    requireAccount:(code)=>{const value=String(code||'');if(!validAccounts.has(value))throw new Error(`Posting account ${value} was not found.`);return value;},
    calcPoLine:(input,index,poId)=>({id:`${poId}-L${index+1}`,poId,inventoryId:input.inventoryId,qtyOrdered:input.qtyOrdered,qtyReceived:0,qtyCancelled:0,qtyOpen:input.qtyOrdered,unitCost:input.unitCost,warehouse:input.warehouse,location:input.location}),
    recalcPo:po=>po,nextPoId:(prefix,rows)=>`${prefix}-${String(rows.length+1001).padStart(4,'0')}`
  };
  const runtime=patchedModule.createManufacturingRuntime({itemMaster,inventoryBalances,inventoryTransactions,purchaseOrders,purchaseOrderLines,vendors,salesOrders,salesOrderLines,warehouses,inventoryLocations,helpers});
  const call=async(method,pathname,body={})=>{const response=await runtime.handle({method,pathname,query:{},readBody:async()=>body,user:{user:{id:'agent3-test'}}});if(response.status>=400)throw new Error(response.body.error);return response.body;};
  return{runtime,call,getBalance,inventoryTransactions,journals,setManufacturingOpen:value=>{isManufacturingOpen=value;}};
}

async function addBom(f,{duplicate=false,qtyPer=1}={}){
  const components=duplicate?[{lineId:'L1',itemId:'RM-1',qtyPer:1,issueMethod:'Manual'},{lineId:'L2',itemId:'RM-1',qtyPer:1,issueMethod:'Manual'}]:[{lineId:'L1',itemId:'RM-1',qtyPer,issueMethod:'Manual'}];
  await f.call('POST','/api/manufacturing/boms',{itemId:'FG-1',revision:'A',status:'Active',baseQty:1,yieldPct:100,components});
}

test('Agent 3 manufacturing runtime patch is idempotent and installs required controls',()=>{
  assert.equal(patchedSource,patchedAgain);
  assert.match(patchedSource,/validatePeriodOpen\('Manufacturing'/);
  assert.match(patchedSource,/return-materials/);
  assert.match(patchedSource,/Production Material Return/);
  assert.match(patchedSource,/dateMinusDays\(dueDate,itemRow\?\.leadTimeDays\|\|0\)/);
  assert.equal(routePermission('POST','/api/manufacturing/orders/MO-1001/return-materials'),'INVENTORY_POST');
});

test('manufacturing settings reject invalid posting accounts and invalid WIP locations',async()=>{
  const f=fixture();
  await assert.rejects(()=>f.call('PUT','/api/manufacturing/settings',{wipAccount:'9999'}),/Posting account 9999 was not found/);
  await assert.rejects(()=>f.call('PUT','/api/manufacturing/settings',{defaultWipWarehouse:'PROD',defaultWipLocation:'MISSING'}),/Default WIP location was not found/);
});

test('closed Manufacturing period blocks material posting before inventory mutation',async()=>{
  const f=fixture({onHand:10,manufacturingOpen:false});await addBom(f,{qtyPer:2});
  const order=await f.call('POST','/api/manufacturing/orders',{itemId:'FG-1',quantity:1});
  await f.call('POST',`/api/manufacturing/orders/${order.id}/release`,{});
  const before=f.getBalance('RM-1','MAIN','MAIN-A1').qtyOnHand;
  await assert.rejects(()=>f.call('POST',`/api/manufacturing/orders/${order.id}/issue-materials`,{}),/Manufacturing period is closed/);
  assert.equal(f.getBalance('RM-1','MAIN','MAIN-A1').qtyOnHand,before);
  assert.equal(f.journals.length,0);
});

test('aggregate issue prevalidation prevents partial mutation when duplicate BOM lines exceed on-hand',async()=>{
  const f=fixture({onHand:1.5});await addBom(f,{duplicate:true});
  const order=await f.call('POST','/api/manufacturing/orders',{itemId:'FG-1',quantity:1});
  await f.call('POST',`/api/manufacturing/orders/${order.id}/release`,{});
  await assert.rejects(()=>f.call('POST',`/api/manufacturing/orders/${order.id}/issue-materials`,{}),/Insufficient on-hand quantity/);
  assert.equal(f.getBalance('RM-1','MAIN','MAIN-A1').qtyOnHand,1.5);
  assert.equal(f.journals.length,0);
  assert.equal(f.inventoryTransactions.length,0);
});

test('issued material can be returned from WIP with reversing GL and inventory audit',async()=>{
  const f=fixture({onHand:10});await addBom(f,{qtyPer:2});
  const order=await f.call('POST','/api/manufacturing/orders',{itemId:'FG-1',quantity:1});
  await f.call('POST',`/api/manufacturing/orders/${order.id}/release`,{});
  await f.call('POST',`/api/manufacturing/orders/${order.id}/issue-materials`,{});
  assert.equal(f.getBalance('RM-1','MAIN','MAIN-A1').qtyOnHand,8);
  const returned=await f.call('POST',`/api/manufacturing/orders/${order.id}/return-materials`,{lines:[{lineId:'L1',quantity:1}]});
  assert.equal(f.getBalance('RM-1','MAIN','MAIN-A1').qtyOnHand,9);
  assert.equal(returned.materials[0].qtyIssued,1);
  assert.equal(returned.costs.material,5);
  assert.ok(f.inventoryTransactions.some(row=>row.transactionType==='Production Material Return'));
  const returnJournal=f.journals.at(-1);
  assert.deepEqual(returnJournal.lines.map(line=>[line.account,line.debit,line.credit]),[['1507',5,0],['1508',0,5]]);
});
