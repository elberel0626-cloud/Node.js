import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const reviewedRuntimePath=path.join(here,'.manufacturingRuntime-agent3.js');

function replaceOnceOrAlready(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`Agent 3 manufacturing planning patch failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Agent 3 manufacturing planning patch failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyManufacturingAgent3PlanningPatch(source){
  source=replaceOnceOrAlready(
    source,
    "function supplyFor(itemId){const onHand=inventoryBalances.filter(row=>row.itemId===itemId).reduce((sum,row)=>sum+Math.max(0,Number(row.qtyOnHand||0)-Number(row.qtyAllocated||0)),0),openPo=purchaseOrderLines.filter(line=>line.inventoryId===itemId&&activePoStatus(purchaseOrders.find(po=>po.id===line.poId)?.status)).reduce((sum,line)=>sum+Math.max(0,Number(line.qtyOpen??(Number(line.qtyOrdered||0)-Number(line.qtyReceived||0)-Number(line.qtyCancelled||0)))),0),openMfg=orders.filter(order=>order.itemId===itemId&&activeMfgStatus(order.status)).reduce((sum,order)=>sum+Math.max(0,Number(order.quantity||0)-Number(order.qtyCompleted||0)-Number(order.qtyScrapped||0)),0);return qty(onHand+openPo+openMfg);}",
    "function supplyFor(itemId,dueDate='9999-12-31'){const onHand=inventoryBalances.filter(row=>row.itemId===itemId).reduce((sum,row)=>sum+Math.max(0,Number(row.qtyOnHand||0)-Number(row.qtyAllocated||0)),0),openPo=purchaseOrderLines.filter(line=>{if(line.inventoryId!==itemId)return false;const po=purchaseOrders.find(row=>row.id===line.poId);if(!po||!activePoStatus(po.status))return false;const supplyDate=line.requestedDate||po.promisedDate||po.requestedDate||po.orderDate||'9999-12-31';return supplyDate<=dueDate;}).reduce((sum,line)=>sum+Math.max(0,Number(line.qtyOpen??(Number(line.qtyOrdered||0)-Number(line.qtyReceived||0)-Number(line.qtyCancelled||0)))),0),openMfg=orders.filter(order=>order.itemId===itemId&&activeMfgStatus(order.status)&&(!order.dueDate||order.dueDate<=dueDate)).reduce((sum,order)=>sum+Math.max(0,Number(order.quantity||0)-Number(order.qtyCompleted||0)-Number(order.qtyScrapped||0)),0);return qty(onHand+openPo+openMfg);}",
    'time-phased scheduled supply'
  );

  source=replaceOnceOrAlready(
    source,
    "const supplyRemaining=new Map(stockItems().map(row=>[row.code,supplyFor(row.code)])),planMap=new Map();",
    "for(const row of stockItems()){if(Number(row.safetyStock||0)>0)demands.push({itemId:row.code,quantity:0,sourceType:'Safety Stock',sourceReference:'Safety Stock',dueDate:nowDate()});}const supplyConsumption=new Map(),plannedSupply=new Map(),planMap=new Map(),safetyApplied=new Set();const plannedSupplyBy=(itemId,dueDate)=>(plannedSupply.get(itemId)||[]).filter(row=>row.dueDate<=dueDate).reduce((sum,row)=>sum+Number(row.quantity||0),0),availableSupply=(itemId,dueDate)=>qty(supplyFor(itemId,dueDate)+plannedSupplyBy(itemId,dueDate)-Number(supplyConsumption.get(itemId)||0)),consumeSupply=(itemId,amount)=>supplyConsumption.set(itemId,qty(Number(supplyConsumption.get(itemId)||0)+Number(amount||0))),addPlannedSupply=(itemId,quantity,dueDate)=>{const rows=plannedSupply.get(itemId)||[];rows.push({quantity:qty(quantity),dueDate});plannedSupply.set(itemId,rows);};",
    'time-phased MRP supply ledger'
  );

  source=replaceOnceOrAlready(
    source,
    "const planNeed=(itemId,gross,dueDate,source,stack=[])=>{if(stack.includes(itemId))throw new Error(`MRP encountered a circular BOM: ${[...stack,itemId].join(' -> ')}`);const current=Number(supplyRemaining.get(itemId)||0),used=Math.min(current,gross);supplyRemaining.set(itemId,qty(current-used));let short=Math.max(0,gross-used);if(short<=0)return;const itemRow=item(itemId);short=roundPlanQuantity(itemRow,short);const bom=effectiveBom(itemId,nowDate());if(bom){addPlan('Make',itemId,short,dueDate,source);for(const component of materialRequirements(bom,short)){planNeed(component.itemId,component.requiredQty,dueDate,{sourceType:'BOM Demand',sourceReference:itemId,parentSource:source},[...stack,itemId]);}}else addPlan('Buy',itemId,short,dueDate,source);};",
    "const planNeed=(itemId,gross,dueDate,source,stack=[])=>{if(stack.includes(itemId))throw new Error(`MRP encountered a circular BOM: ${[...stack,itemId].join(' -> ')}`);dueDate=dueDate||datePlusDays(nowDate(),7);const itemRow=item(itemId),safety=safetyApplied.has(itemId)?0:Math.max(0,Number(itemRow?.safetyStock||0));safetyApplied.add(itemId);const totalGross=qty(Number(gross||0)+safety),current=Math.max(0,Number(availableSupply(itemId,dueDate)||0)),used=Math.min(current,totalGross);consumeSupply(itemId,totalGross);let short=Math.max(0,totalGross-used);if(short<=0)return;short=roundPlanQuantity(itemRow,short);const bom=effectiveBom(itemId,dueDate);if(bom){addPlan('Make',itemId,short,dueDate,source);addPlannedSupply(itemId,short,dueDate);const componentNeedDate=dateMinusDays(dueDate,itemRow?.leadTimeDays||0);for(const component of materialRequirements(bom,short)){planNeed(component.itemId,component.requiredQty,componentNeedDate,{sourceType:'BOM Demand',sourceReference:itemId,parentSource:source},[...stack,itemId]);}}else{addPlan('Buy',itemId,short,dueDate,source);addPlannedSupply(itemId,short,dueDate);}};",
    'chronological MRP netting'
  );

  source=replaceOnceOrAlready(
    source,
    "const grouped=new Map();for(const demand of demands){const row=grouped.get(demand.itemId)||{quantity:0,dueDate:demand.dueDate,sources:[]};row.quantity+=Number(demand.quantity||0);if(demand.dueDate<row.dueDate)row.dueDate=demand.dueDate;row.sources.push(demand);grouped.set(demand.itemId,row);}for(const [itemId,row] of grouped){const safety=Math.max(0,Number(item(itemId)?.safetyStock||0));planNeed(itemId,row.quantity+safety,row.dueDate,{sourceType:'Demand',sourceReference:row.sources.map(x=>x.sourceReference).filter(Boolean).join(', '),details:row.sources});}",
    "for(const demand of demands.slice().sort((a,b)=>String(a.dueDate||'').localeCompare(String(b.dueDate||''))))planNeed(demand.itemId,Number(demand.quantity||0),demand.dueDate,demand);",
    'chronological demand processing'
  );

  source=replaceOnceOrAlready(
    source,
    "Math.max(0,Number(op.plannedTotalHours||0)-Number(op.actualLaborHours||0)-Number(op.actualMachineHours||0))",
    "Math.max(0,Number(op.plannedTotalHours||0)-Math.max(Number(op.actualLaborHours||0),Number(op.actualMachineHours||0)))",
    'capacity remaining-load calculation'
  );

  return source;
}

export async function prepareManufacturingAgent3PlanningRuntime(inputModule='./.manufacturingRuntime-agent3.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyManufacturingAgent3PlanningPatch(source);
  await writeFile(reviewedRuntimePath,patched,'utf8');
  return './.manufacturingRuntime-agent3.js';
}
