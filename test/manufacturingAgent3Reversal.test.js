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
import { applyManufacturingAgent3ReversalRuntimePatch, applyManufacturingAgent3ReversalClientPatch } from '../src/manufacturingAgent3ReversalPatch.js';
import { routePermission } from '../src/routePermissions.js';

const original=await readFile(new URL('../src/manufacturingRuntime.js',import.meta.url),'utf8');
const beforeReversal=applyManufacturingAgent3SubstitutionRuntimePatch(applyManufacturingAgent3MrpExceptionsRuntimePatch(applyManufacturingAgent3IdempotencyRuntimePatch(applyManufacturingAgent3GovernancePatch(applyManufacturingAgent3EngineeringRuntimePatch(applyManufacturingAgent3UiRuntimePatch(applyManufacturingAgent3FinalizationPatch(applyManufacturingAgent3AdvancedPatch(applyManufacturingAgent3MasterQualityPatch(applyManufacturingAgent3PlanningPatch(applyManufacturingAgent3RuntimePatch(original)))))))))));
const reviewed=applyManufacturingAgent3ReversalRuntimePatch(beforeReversal);
const { createManufacturingRuntime }=await import(`data:text/javascript;base64,${Buffer.from(reviewed).toString('base64')}`);

function fixture({fgStandardCost=5}={}){
  const itemMaster=[
    {code:'RM',inventoryId:'RM',description:'Raw Material',type:'Stock Item',trackQuantity:true,averageCost:5,cost:5,inventoryAccount:'1507',defaultWarehouse:'MAIN',defaultLocation:'A1'},
    {code:'FG',inventoryId:'FG',description:'Finished Good',type:'Stock Item',trackQuantity:true,costingMethod:'Standard Cost',standardCost:fgStandardCost,cost:fgStandardCost,inventoryAccount:'1509',defaultWarehouse:'MAIN',defaultLocation:'FG'}
  ];
  const inventoryBalances=[
    {itemId:'RM',warehouse:'MAIN',location:'A1',qtyOnHand:20,qtyAllocated:0,averageCost:5},
    {itemId:'FG',warehouse:'MAIN',location:'FG',qtyOnHand:0,qtyAllocated:0,averageCost:fgStandardCost}
  ];
  const inventoryTransactions=[],purchaseOrders=[],purchaseOrderLines=[],purchaseReceiptLines=[],journalEntries=[],vendors=[],salesOrders=[],salesOrderLines=[];
  const warehouses=[{warehouseId:'MAIN'},{warehouseId:'PROD'}],inventoryLocations=[{warehouse:'MAIN',locationId:'A1'},{warehouse:'MAIN',locationId:'FG'},{warehouse:'PROD',locationId:'PROD-WIP'}];
  const getBalance=(itemId,warehouse,location)=>{let row=inventoryBalances.find(r=>r.itemId===itemId&&r.warehouse===warehouse&&r.location===location);if(!row){row={itemId,warehouse,location,qtyOnHand:0,qtyAllocated:0,averageCost:0};inventoryBalances.push(row);}return row;};
  const helpers={
    getBalance,qtyAvail:b=>Number(b.qtyOnHand||0)-Number(b.qtyAllocated||0),itemCost:i=>Number(i?.costingMethod==='Standard Cost'?i?.standardCost:(i?.averageCost||i?.cost||0)),
    adjustInventoryBalance:({itemId,warehouse,location,qtyIn=0,qtyOut=0,allocatedDelta=0,unitCost=0})=>{const b=getBalance(itemId,warehouse,location);b.qtyOnHand=Number(b.qtyOnHand||0)+Number(qtyIn)-Number(qtyOut);b.qtyAllocated=Math.max(0,Number(b.qtyAllocated||0)+Number(allocatedDelta));if(qtyIn&&unitCost)b.averageCost=Number(unitCost);return b;},
    createInvAudit:r=>{inventoryTransactions.push(r);return r;},
    createPostedJournal:j=>{const row={...j,jeNumber:`JE-${String(journalEntries.length+1).padStart(4,'0')}`};journalEntries.push(row);return row;},
    periodFromDate:d=>String(d).slice(0,7),validateInventoryAndGlOpen:()=>{},validatePeriodOpen:()=>{},requireAccount:c=>String(c),
    calcPoLine:(x,i,poId)=>({id:`${poId}-L${i+1}`,poId,...x}),recalcPo:po=>po,nextPoId:(prefix,rows)=>`${prefix}-${rows.length+1}`
  };
  const runtime=createManufacturingRuntime({itemMaster,inventoryBalances,inventoryTransactions,purchaseOrders,purchaseOrderLines,purchaseReceiptLines,journalEntries,vendors,salesOrders,salesOrderLines,warehouses,inventoryLocations,helpers});
  const call=async(method,pathname,body={},user='controller')=>{const response=await runtime.handle({method,pathname,query:{},readBody:async()=>body,user:{user:{id:user}}});if(response.status>=400)throw new Error(response.body.error);return response.body;};
  return{runtime,call,getBalance,inventoryTransactions,journalEntries};
}

async function configure(f,{withRouting=false}={}){
  await f.call('POST','/api/manufacturing/boms',{itemId:'FG',revision:'A',status:'Active',effectiveFrom:'2026-01-01',baseQty:1,yieldPct:100,components:[{lineId:'L1',itemId:'RM',qtyPer:1,supplyType:'Buy',issueMethod:'Manual'}],clientRequestId:'BOM-A'},'engineer');
  if(withRouting)await f.call('POST','/api/manufacturing/routings',{itemId:'FG',revision:'A',status:'Active',effectiveFrom:'2026-01-01',operations:[{sequence:10,workCenterId:'WC-ASSY',description:'Assembly',runHoursPerUnit:0.1}],clientRequestId:'ROUTE-A'},'engineer');
}

async function completeBasic(f,{quantity=2,withOperation=false}={}){
  const order=await f.call('POST','/api/manufacturing/orders',{itemId:'FG',quantity,clientRequestId:`ORDER-${quantity}-${withOperation}`});
  await f.call('POST',`/api/manufacturing/orders/${order.id}/release`,{clientRequestId:`REL-${order.id}`});
  await f.call('POST',`/api/manufacturing/orders/${order.id}/issue-materials`,{lines:[{lineId:'L1',quantity}],clientRequestId:`ISSUE-${order.id}`});
  if(withOperation)await f.call('POST',`/api/manufacturing/orders/${order.id}/report-operation`,{sequence:10,laborHours:0.1,machineHours:0,qtyGood:quantity,qtyScrap:0,clientRequestId:`OP-${order.id}`});
  return await f.call('POST',`/api/manufacturing/orders/${order.id}/complete`,{quantity,scrapQty:0,clientRequestId:`COMP-${order.id}`});
}

test('reversal patch is idempotent and protected by explicit permissions',()=>{
  assert.equal(reviewed,applyManufacturingAgent3ReversalRuntimePatch(reviewed));
  assert.match(reviewed,/completionHistory/);
  assert.match(reviewed,/Completion Reversed/);
  assert.match(reviewed,/Manufacturing reopen/);
  assert.equal(routePermission('POST','/api/manufacturing/orders/MO-1001/reopen'),'SYSTEM_CONFIGURATION_ADMIN');
  assert.equal(routePermission('POST','/api/manufacturing/orders/MO-1001/reverse-completion'),'INVENTORY_POST');
});

test('closed order cannot reverse FG until reopened, then reversal restores WIP and inventory history',async()=>{
  const f=fixture({fgStandardCost:5});await configure(f);const completed=await completeBasic(f,{quantity:2});
  assert.equal(completed.status,'Completed');
  assert.equal(completed.qtyCompleted,2);
  assert.equal(completed.costs.finishedGoods,10);
  assert.equal(f.getBalance('FG','MAIN','FG').qtyOnHand,2);
  assert.equal(completed.completionHistory.length,1);
  const closed=await f.call('POST',`/api/manufacturing/orders/${completed.id}/close`,{clientRequestId:'CLOSE-1'});
  assert.equal(closed.status,'Closed');
  assert.equal(closed.closeHistory.length,1);
  await assert.rejects(()=>f.call('POST',`/api/manufacturing/orders/${completed.id}/reverse-completion`,{quantity:1,reason:'Correction',clientRequestId:'REV-CLOSED'}),/Reopen the production order/);
  await assert.rejects(()=>f.call('POST',`/api/manufacturing/orders/${completed.id}/reopen`,{clientRequestId:'REOPEN-NOREASON'}),/reopen reason is required/);
  const reopened=await f.call('POST',`/api/manufacturing/orders/${completed.id}/reopen`,{reason:'Controller authorized production correction.',clientRequestId:'REOPEN-1'},'controller');
  assert.equal(reopened.status,'Completed');
  assert.equal(reopened.closedAt,'');
  const reversed=await f.call('POST',`/api/manufacturing/orders/${completed.id}/reverse-completion`,{quantity:1,reason:'One finished unit was recorded in error.',clientRequestId:'REV-1'},'production.manager');
  assert.equal(reversed.status,'In Process');
  assert.equal(reversed.qtyCompleted,1);
  assert.equal(reversed.costs.finishedGoods,5);
  assert.equal(reversed.wipBalance,5);
  assert.equal(f.getBalance('FG','MAIN','FG').qtyOnHand,1);
  assert.equal(reversed.completionHistory[0].reversedQuantity,1);
  assert.equal(reversed.completionHistory[0].reversedValue,5);
  assert.equal(reversed.completionReversals.at(-1).reason,'One finished unit was recorded in error.');
  const reversalJe=f.journalEntries.find(je=>je.jeNumber===reversed.completionReversals.at(-1).jeReference);
  assert.equal(reversalJe.lines.some(line=>line.account==='1508'&&Number(line.debit)===5),true);
  assert.equal(reversalJe.lines.some(line=>line.account==='1509'&&Number(line.credit)===5),true);
  assert.equal(f.inventoryTransactions.some(row=>row.transactionType==='Production Receipt Reversal'&&Number(row.quantityOut)===1),true);
});

test('completion reversal is blocked if downstream availability no longer supports it',async()=>{
  const f=fixture({fgStandardCost:5});await configure(f);const completed=await completeBasic(f,{quantity:2});
  f.getBalance('FG','MAIN','FG').qtyAllocated=2;
  await assert.rejects(()=>f.call('POST',`/api/manufacturing/orders/${completed.id}/reverse-completion`,{quantity:1,reason:'Correction after allocation.',clientRequestId:'REV-ALLOC'}),/Finished goods are no longer available/);
  assert.equal(f.getBalance('FG','MAIN','FG').qtyOnHand,2);
  assert.equal(completed.qtyCompleted,2);
});

test('reopen reverses close variance and restores WIP without deleting the original close journal',async()=>{
  const f=fixture({fgStandardCost:5});await configure(f,{withRouting:true});const completed=await completeBasic(f,{quantity:1,withOperation:true});
  assert.equal(completed.costs.material,5);
  assert.equal(completed.costs.finishedGoods,5);
  assert.ok(completed.wipBalance>0);
  const closed=await f.call('POST',`/api/manufacturing/orders/${completed.id}/close`,{clientRequestId:'CLOSE-VAR'});
  const closeRow=closed.closeHistory.at(-1),residual=closeRow.residual;
  assert.ok(residual>0);
  assert.equal(closed.wipBalance,0);
  assert.ok(closeRow.jeReference);
  const originalCloseJe=f.journalEntries.find(je=>je.jeNumber===closeRow.jeReference);
  assert.ok(originalCloseJe);
  const reopened=await f.call('POST',`/api/manufacturing/orders/${completed.id}/reopen`,{reason:'Reopen to correct final production cost.',clientRequestId:'REOPEN-VAR'},'controller');
  const reopenedClose=reopened.closeHistory.at(-1);
  assert.equal(reopened.status,'Completed');
  assert.equal(reopened.costs.variance,0);
  assert.equal(reopened.wipBalance,residual);
  assert.equal(reopenedClose.reopenReason,'Reopen to correct final production cost.');
  assert.ok(reopenedClose.reversalJeReference);
  assert.ok(f.journalEntries.find(je=>je.jeNumber===originalCloseJe.jeNumber));
  const reversalJe=f.journalEntries.find(je=>je.jeNumber===reopenedClose.reversalJeReference);
  assert.equal(reversalJe.lines.some(line=>line.account==='1508'&&Number(line.debit)===residual),true);
  assert.equal(reversalJe.lines.some(line=>line.account==='5109'&&Number(line.credit)===residual),true);
});

test('reversal UI compiles after all prior manufacturing client patches',async()=>{
  const client=await readFile(new URL('../public/manufacturingModule.js',import.meta.url),'utf8');
  const advanced=applyManufacturingAgent3UiClientPatch(client),engineering=applyManufacturingAgent3EngineeringClientPatch(advanced),idempotent=applyManufacturingAgent3IdempotencyClientPatch(engineering),mrp=applyManufacturingAgent3MrpExceptionsClientPatch(idempotent),substitution=applyManufacturingAgent3SubstitutionClientPatch(mrp),reversal=applyManufacturingAgent3ReversalClientPatch(substitution);
  assert.equal(reversal,applyManufacturingAgent3ReversalClientPatch(reversal));
  assert.doesNotThrow(()=>new Function(reversal));
  assert.match(reversal,/Reverse Completion/);
  assert.match(reversal,/reverse-completion/);
  assert.match(reversal,/Reopen Closed Order/);
  assert.match(reversal,/Reopen Order/);
});
