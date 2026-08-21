import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const reviewedRuntimePath=path.join(here,'.manufacturingRuntime-agent3.js');

function replaceOnceOrAlready(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`Agent 3 manufacturing master/quality patch failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Agent 3 manufacturing master/quality patch failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyManufacturingAgent3MasterQualityPatch(source){
  source=replaceOnceOrAlready(
    source,
    "walk(candidate.itemId,[]);\n  }\n  function normalizeRouting",
    "walk(candidate.itemId,[]);\n  }\n  function assertEffectiveWindow(row,label){const allowed=new Set(['Draft','Active','Inactive','Obsolete']);if(!allowed.has(row.status))throw new Error(`${label} status must be Draft, Active, Inactive, or Obsolete.`);if(row.effectiveFrom&&row.effectiveTo&&row.effectiveFrom>row.effectiveTo)throw new Error(`${label} effective-from date cannot be after effective-to date.`);}\n  function assertNoEffectiveOverlap(rows,candidate,label){if(candidate.status!=='Active')return;const start=candidate.effectiveFrom||'0000-01-01',end=candidate.effectiveTo||'9999-12-31';const conflict=rows.find(row=>row.id!==candidate.id&&row.itemId===candidate.itemId&&row.status==='Active'&&(row.effectiveFrom||'0000-01-01')<=end&&(row.effectiveTo||'9999-12-31')>=start);if(conflict)throw new Error(`${label} ${candidate.itemId} revision ${candidate.revision} overlaps active revision ${conflict.revision}. End-date or deactivate the existing revision first.`);}\n  function assertBomLineIds(row){const ids=(row.components||[]).map(line=>String(line.lineId||''));if(new Set(ids).size!==ids.length)throw new Error('BOM component line IDs must be unique.');}\n  function normalizeRouting",
    'effective revision controls'
  );

  source=replaceOnceOrAlready(
    source,
    "if(method==='POST'&&pathname==='/api/manufacturing/boms'){const input=await getBody(),existing=boms.find(row=>row.id===input.id),row=normalizeBom(input,existing);assertNoBomCycle(row);if(existing)Object.assign(existing,row);else boms.push(row);audit('BOM',row.id,existing?'Updated':'Created',`${row.itemId} rev ${row.revision}`,actor);return{status:existing?200:201,body:existing||row};}",
    "if(method==='POST'&&pathname==='/api/manufacturing/boms'){const input=await getBody(),requestedId=input.id||`BOM-${String(input.itemId||'')}-${String(input.revision||'A')}`,existing=boms.find(row=>row.id===requestedId),row=normalizeBom({...input,id:requestedId},existing);assertEffectiveWindow(row,'BOM');assertBomLineIds(row);assertNoBomCycle(row);assertNoEffectiveOverlap(boms,row,'BOM');if(existing)Object.assign(existing,row);else boms.push(row);audit('BOM',row.id,existing?'Updated':'Created',`${row.itemId} rev ${row.revision}`,actor);return{status:existing?200:201,body:existing||row};}",
    'BOM revision upsert and overlap validation'
  );

  source=replaceOnceOrAlready(
    source,
    "if(method==='POST'&&pathname==='/api/manufacturing/routings'){const input=await getBody(),existing=routings.find(row=>row.id===input.id),row=normalizeRouting(input,existing);if(existing)Object.assign(existing,row);else routings.push(row);audit('Routing',row.id,existing?'Updated':'Created',`${row.itemId} rev ${row.revision}`,actor);return{status:existing?200:201,body:existing||row};}",
    "if(method==='POST'&&pathname==='/api/manufacturing/routings'){const input=await getBody(),requestedId=input.id||`RT-${String(input.itemId||'')}-${String(input.revision||'A')}`,existing=routings.find(row=>row.id===requestedId),row=normalizeRouting({...input,id:requestedId},existing);assertEffectiveWindow(row,'Routing');assertNoEffectiveOverlap(routings,row,'Routing');if(existing)Object.assign(existing,row);else routings.push(row);audit('Routing',row.id,existing?'Updated':'Created',`${row.itemId} rev ${row.revision}`,actor);return{status:existing?200:201,body:existing||row};}",
    'routing revision upsert and overlap validation'
  );

  source=replaceOnceOrAlready(
    source,
    "const req=requested?.find(row=>String(row.itemId||row.inventoryId)===String(line.itemId));if(requested&&!req)continue;",
    "const req=requested?.find(row=>row.lineId?String(row.lineId)===String(line.lineId):String(row.itemId||row.inventoryId)===String(line.itemId));if(requested&&!req)continue;if(requested&&req&&!req.lineId&&(order.materials||[]).filter(row=>String(row.itemId)===String(line.itemId)).length>1)throw new Error('Component '+line.itemId+' appears on multiple BOM lines. Specify lineId when issuing material.');",
    'unambiguous material issue line selection'
  );

  source=replaceOnceOrAlready(
    source,
    "function inspectionAcceptedQty(order,sequence){return inspections.filter(row=>row.productionOrderId===order.id&&Number(row.operationSequence)===Number(sequence)&&row.result==='Pass').reduce((sum,row)=>sum+Number(row.qtyAccepted||0),0);}",
    "function inspectionAcceptedQty(order,sequence){const passed=inspections.filter(row=>row.productionOrderId===order.id&&Number(row.operationSequence)===Number(sequence)&&row.result==='Pass').reduce((sum,row)=>sum+Number(row.qtyAccepted||0),0),useAsIs=nonconformances.filter(row=>row.productionOrderId===order.id&&Number(row.operationSequence)===Number(sequence)&&row.status==='Closed'&&row.disposition==='Use As Is').reduce((sum,row)=>sum+Number(row.qtyRejected||0),0);return passed+useAsIs;}",
    'quality-gate accepted disposition quantity'
  );

  source=replaceOnceOrAlready(
    source,
    "row.inspectionNumber=row.id;inspections.push(row);if(result==='Fail'||rejected>0){",
    "row.inspectionNumber=row.id;inspections.push(row);if(result==='Pass'&&rejected<=0){const completedRework=nonconformances.find(ncr=>ncr.productionOrderId===order.id&&ncr.status==='Rework Pending'&&Number(ncr.reworkOperationSequence)===Number(row.operationSequence)&&Number(row.qtyAccepted||0)+0.000001>=Number(ncr.qtyRejected||0));if(completedRework){completedRework.status='Closed';completedRework.disposition='Rework Completed';completedRework.closedAt=new Date().toISOString();completedRework.closedBy=user;audit('Nonconformance',completedRework.id,'Rework Accepted',`Rework operation ${row.operationSequence} passed inspection.`,user);if(!nonconformances.some(ncr=>ncr.productionOrderId===order.id&&ncr.status!=='Closed'))order.qualityHold=false;}}if(result==='Fail'||rejected>0){",
    'rework acceptance handling'
  );

  source=replaceOnceOrAlready(
    source,
    "function dispositionNcr(ncr,input={},user='system'){\n    if(ncr.status==='Closed')throw new Error('Nonconformance is already closed.');const disposition=input.disposition||'';if(!['Rework','Scrap','Use As Is','Return to Vendor'].includes(disposition))throw new Error('A valid nonconformance disposition is required.');ncr.disposition=disposition;ncr.dispositionNotes=input.notes||'';ncr.status='Closed';ncr.closedAt=new Date().toISOString();ncr.closedBy=user;const order=orders.find(row=>row.id===ncr.productionOrderId);if(order&&!nonconformances.some(row=>row.productionOrderId===order.id&&row.status==='Open'))order.qualityHold=false;audit('Nonconformance',ncr.id,'Disposed',disposition,user);return ncr;\n  }",
    `function dispositionNcr(ncr,input={},user='system'){
    if(ncr.status==='Closed')throw new Error('Nonconformance is already closed.');const disposition=input.disposition||'';if(!['Rework','Scrap','Use As Is','Return to Vendor'].includes(disposition))throw new Error('A valid nonconformance disposition is required.');const order=orders.find(row=>row.id===ncr.productionOrderId);if(!order)throw new Error('Production order for nonconformance was not found.');ncr.dispositionNotes=input.notes||'';
    if(disposition==='Return to Vendor')throw new Error('Return to Vendor is not valid for a production-order inspection NCR. Use the purchasing receipt quality workflow for vendor returns.');
    if(disposition==='Rework'){if(ncr.status==='Rework Pending')throw new Error('Rework is already pending for this nonconformance.');const sourceOp=(order.operations||[]).find(op=>Number(op.sequence)===Number(ncr.operationSequence))||(order.operations||[]).at(-1)||{},sequence=Math.max(0,...(order.operations||[]).map(op=>Number(op.sequence||0)))+10,reworkHours=Math.max(0.1,Number(input.reworkHours||Number(ncr.qtyRejected||1)*Math.max(0.1,Number(sourceOp.runHoursPerUnit||0.25))));order.operations.push({...sourceOp,sequence,description:'Rework '+ncr.id,plannedSetupHours:0,plannedRunHours:reworkHours,plannedTotalHours:reworkHours,actualLaborHours:0,actualMachineHours:0,qtyGood:0,qtyScrap:0,status:'Pending',startedAt:'',completedAt:'',laborCost:0,machineCost:0,overheadCost:0,qualityCheckpoint:true,reworkForNcr:ncr.id});ncr.disposition='Rework';ncr.status='Rework Pending';ncr.reworkOperationSequence=sequence;ncr.reworkCreatedAt=new Date().toISOString();order.qualityHold=true;audit('Nonconformance',ncr.id,'Rework Created','Rework operation '+sequence+' created.',user);return ncr;}
    if(disposition==='Scrap'){const remaining=Math.max(0,Number(order.quantity||0)-Number(order.qtyCompleted||0)-Number(order.qtyScrapped||0)),scrapQty=qty(Math.min(Number(ncr.qtyRejected||0),remaining));if(scrapQty<=0)throw new Error('No remaining production quantity is available to scrap for this NCR.');const availableWip=Math.max(0,money(wipAdded(order)-wipRelieved(order)));if(availableWip<=0)throw new Error('No WIP cost is available to scrap. Issue materials or report production activity before scrapping the NCR quantity.');const itemRow=item(order.itemId),standardUnit=Math.max(0,Number(itemRow?.standardCost||itemRow?.cost||0)),scrapValue=money(Math.min(availableWip,standardUnit>0?standardUnit*scrapQty:availableWip*(scrapQty/Math.max(0.000001,remaining))));let jeRef='';if(scrapValue>0){jeRef=postJournal(order,'Manufacturing NCR scrap '+ncr.id,[{account:settings.scrapVarianceAccount,debit:scrapValue,credit:0,description:'NCR scrap '+order.itemId,sourceReference:order.id},{account:settings.wipAccount,debit:0,credit:scrapValue,description:'WIP NCR scrap relief '+order.id,sourceReference:order.id}],user);order.costs.scrap=money(Number(order.costs.scrap||0)+scrapValue);}order.qtyScrapped=qty(Number(order.qtyScrapped||0)+scrapQty);const period=h.periodFromDate(nowDate());h.createInvAudit({transactionType:'Production Scrap',referenceNumber:ncr.id,sourceModule:'Manufacturing',sourceReference:order.id,itemId:order.itemId,warehouse:order.wipWarehouse,location:order.wipLocation,quantityOut:scrapQty,unitCost:scrapQty?scrapValue/scrapQty:0,postDate:nowDate(),postPeriod:period,jeReference:jeRef,createdBy:user});ncr.dispositionJeReference=jeRef;ncr.scrapValue=scrapValue;if(Number(order.qtyCompleted||0)+Number(order.qtyScrapped||0)+0.000001>=Number(order.quantity||0)){order.status='Completed';releaseReservations(order);order.completedAt=new Date().toISOString();}}
    ncr.disposition=disposition;ncr.status='Closed';ncr.closedAt=new Date().toISOString();ncr.closedBy=user;if(!nonconformances.some(row=>row.productionOrderId===order.id&&row.status!=='Closed'))order.qualityHold=false;audit('Nonconformance',ncr.id,'Disposed',disposition,user);return ncr;
  }`,
    'operational NCR dispositions'
  );

  return source;
}

export async function prepareManufacturingAgent3MasterQualityRuntime(inputModule='./.manufacturingRuntime-agent3.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyManufacturingAgent3MasterQualityPatch(source);
  await writeFile(reviewedRuntimePath,patched,'utf8');
  return './.manufacturingRuntime-agent3.js';
}
