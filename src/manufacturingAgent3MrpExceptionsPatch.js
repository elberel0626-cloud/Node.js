import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const runtimePath=path.join(here,'.manufacturingRuntime-agent3.js');
const clientPath=path.join(here,'../public/manufacturingModule.js');

function replaceOnceOrAlready(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`Agent 3 MRP exception patch failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Agent 3 MRP exception patch failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyManufacturingAgent3MrpExceptionsRuntimePatch(source){
  source=replaceOnceOrAlready(
    source,
    "function salesDemand(){",
    `function dayDistance(from,to){return Math.round((new Date(String(to)+'T12:00:00Z')-new Date(String(from)+'T12:00:00Z'))/86400000);}
  function mrpPlanningNeeds(){const rows=salesDemand().map(row=>({...row,needType:'Independent Demand'}));for(const order of orders.filter(row=>activeMfgStatus(row.status))){for(const line of order.materials||[]){const remaining=Math.max(0,Number(line.requiredQty||0)-Number(line.qtyIssued||0)-Number(line.qtyReserved||0));if(remaining>0)rows.push({itemId:line.itemId,quantity:qty(remaining),sourceType:'Production Component',sourceReference:order.id,dueDate:order.startDate||order.dueDate||nowDate(),needType:'Dependent Demand'});}}return rows;}
  function mrpFirmSupplies(){const rows=[];for(const line of purchaseOrderLines){const po=purchaseOrders.find(row=>row.id===line.poId);if(!po||!['Open','Partially Received'].includes(String(po.status||'')))continue;const quantity=Math.max(0,Number(line.qtyOpen??(Number(line.qtyOrdered||0)-Number(line.qtyReceived||0)-Number(line.qtyCancelled||0))));if(quantity<=0)continue;rows.push({supplyType:'Purchase Order',reference:po.poNumber||po.id,lineReference:line.id,itemId:line.inventoryId||line.itemId,quantity:qty(quantity),date:line.requestedDate||po.promisedDate||po.requestedDate||po.orderDate||datePlusDays(nowDate(),settings.planningHorizonDays),status:po.status});}for(const order of orders.filter(row=>['Planned','Released','Material Shortage','In Process'].includes(String(row.status||'')))){const quantity=Math.max(0,Number(order.quantity||0)-Number(order.qtyCompleted||0)-Number(order.qtyScrapped||0));if(quantity<=0)continue;rows.push({supplyType:'Production Order',reference:order.id,lineReference:'',itemId:order.itemId,quantity:qty(quantity),date:order.dueDate||datePlusDays(nowDate(),settings.planningHorizonDays),status:order.status});}return rows;}
  function mrpActionMessages(input={}){const deferDays=Math.max(1,Number(input.deferDays||7)),horizonDays=Math.max(1,Number(input.horizonDays||settings.planningHorizonDays||90)),horizonDate=datePlusDays(nowDate(),horizonDays),needs=mrpPlanningNeeds(),supplies=mrpFirmSupplies(),items=new Set([...needs.map(row=>row.itemId),...supplies.map(row=>row.itemId)]),messages=[];for(const itemId of items){const itemRow=item(itemId),safety=Math.max(0,Number(itemRow?.safetyStock||0)),itemNeeds=needs.filter(row=>row.itemId===itemId&&(!row.dueDate||row.dueDate<=horizonDate)).map(row=>({...row,dueDate:row.dueDate||horizonDate,remaining:Number(row.quantity||0)})).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)),itemSupplies=supplies.filter(row=>row.itemId===itemId&&row.date<=horizonDate).map(row=>({...row,remaining:Number(row.quantity||0)})).sort((a,b)=>a.date.localeCompare(b.date));if(safety>0)itemNeeds.push({itemId,quantity:safety,remaining:safety,sourceType:'Safety Stock',sourceReference:'Safety Stock',dueDate:horizonDate,needType:'Safety Stock'});let available=inventoryBalances.filter(row=>row.itemId===itemId).reduce((sum,row)=>sum+Math.max(0,Number(row.qtyOnHand||0)-Number(row.qtyAllocated||0)),0),supplyIndex=0;const add=(type,supply,quantity,targetDate,need)=>{const key=[type,supply.supplyType,supply.reference,supply.lineReference,targetDate].join('|'),existing=messages.find(row=>row.key===key),amount=qty(quantity);if(existing){existing.quantity=qty(existing.quantity+amount);return;}messages.push({key,id:'',type,severity:type==='Expedite'?'High':type==='Cancel / Reduce'?'Medium':'Low',supplyType:supply.supplyType,reference:supply.reference,lineReference:supply.lineReference,itemId,description:itemRow?.description||itemRow?.name||itemId,quantity:amount,currentDate:supply.date,recommendedDate:targetDate||'',needDate:need?.dueDate||'',needSource:need?.sourceType||'',needReference:need?.sourceReference||'',reason:type==='Expedite'?(supply.supplyType+' arrives after required demand.'):type==='Defer'?(supply.supplyType+' arrives more than '+deferDays+' days before the demand it supports.'):'Firm supply exceeds known demand plus safety stock inside the planning horizon.'});};for(const need of itemNeeds){let remaining=Number(need.remaining||0),use=Math.min(available,remaining);available-=use;remaining-=use;while(remaining>0.000001&&supplyIndex<itemSupplies.length){const supply=itemSupplies[supplyIndex];if(supply.remaining<=0.000001){supplyIndex++;continue;}const allocated=Math.min(remaining,supply.remaining);if(supply.date>need.dueDate)add('Expedite',supply,allocated,need.dueDate,need);else if(dayDistance(supply.date,need.dueDate)>deferDays)add('Defer',supply,allocated,need.dueDate,need);supply.remaining-=allocated;remaining-=allocated;if(supply.remaining<=0.000001)supplyIndex++;}}for(const supply of itemSupplies){if(supply.remaining>0.000001)add('Cancel / Reduce',supply,supply.remaining,'',null);}}messages.forEach((row,index)=>row.id='MRP-ACT-'+String(index+1).padStart(4,'0'));return messages.map(({key,...row})=>row);}
  function salesDemand(){`,
    'MRP action-message engine'
  );

  source=replaceOnceOrAlready(
    source,
    "return{run,plannedOrders:created,demands};",
    "return{run,plannedOrders:created,demands,actionMessages:mrpActionMessages()};",
    'MRP run action messages'
  );

  source=replaceOnceOrAlready(
    source,
    "if(method==='GET'&&pathname==='/api/manufacturing/mrp/runs')",
    "if(method==='GET'&&pathname==='/api/manufacturing/mrp/action-messages')return{status:200,body:mrpActionMessages({horizonDays:Number(query.horizonDays||settings.planningHorizonDays),deferDays:Number(query.deferDays||7)})};if(method==='GET'&&pathname==='/api/manufacturing/mrp/runs')",
    'MRP action-message endpoint'
  );
  return source;
}

export function applyManufacturingAgent3MrpExceptionsClientPatch(source){
  return replaceOnceOrAlready(
    source,
    "async function mrpPage(){setTitle('Material Requirements Planning');const runs=await api('/api/manufacturing/mrp/runs');const suggestions=await api('/api/manufacturing/planned-orders');document.getElementById('view').innerHTML=`${section('Run MRP'",
    "async function mrpPage(){setTitle('Material Requirements Planning');const [runs,suggestions,actionMessages]=await Promise.all([api('/api/manufacturing/mrp/runs'),api('/api/manufacturing/planned-orders'),api('/api/manufacturing/mrp/action-messages')]);document.getElementById('view').innerHTML=`${section('Planner Action Messages',table(actionMessages,[{label:'Action',render:r=>badge(r.type)},{label:'Severity',render:r=>badge(r.severity)},{label:'Supply',render:r=>`${esc(r.supplyType)} ${esc(r.reference)}`},{label:'Item',key:'itemId'},{label:'Qty',key:'quantity'},{label:'Current Date',key:'currentDate'},{label:'Recommended Date',key:'recommendedDate'},{label:'Need',render:r=>`${esc(r.needSource||'')} ${esc(r.needReference||'')}`},{label:'Reason',key:'reason'}],'No expedite, defer, or cancel/reduce recommendations.'))}${section('Run MRP'",
    'MRP action-message UI'
  );
}

export async function prepareManufacturingAgent3MrpExceptionsRuntime(inputModule='./.manufacturingRuntime-agent3.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyManufacturingAgent3MrpExceptionsRuntimePatch(source);
  await writeFile(runtimePath,patched,'utf8');
  return './.manufacturingRuntime-agent3.js';
}

export async function patchManufacturingAgent3MrpExceptionsUiFile(){
  const source=await readFile(clientPath,'utf8');
  const patched=applyManufacturingAgent3MrpExceptionsClientPatch(source);
  if(patched!==source)await writeFile(clientPath,patched,'utf8');
  return clientPath;
}
