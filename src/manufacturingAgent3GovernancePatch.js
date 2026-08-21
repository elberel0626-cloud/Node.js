import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const runtimePath=path.join(here,'.manufacturingRuntime-agent3.js');

function replaceOnceOrAlready(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`Agent 3 manufacturing governance patch failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Agent 3 manufacturing governance patch failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyManufacturingAgent3GovernancePatch(source){
  source=replaceOnceOrAlready(
    source,
    "function dateBefore(value){",
    "function assertDirectRevisionGovernance(rows,input,existing,row,label,contentFields){const siblings=rows.filter(candidate=>candidate.itemId===row.itemId&&candidate.id!==row.id);if(row.status==='Active'&&existing?.status==='Draft')throw new Error(`${label} Draft revisions can become Active only through an approved Engineering Change.`);if(row.status==='Active'&&!existing&&siblings.length)throw new Error(`Create ${label} revision ${row.revision} as Draft and use Engineering Changes to activate it.`);if(existing?.status==='Active'){const structureChanged=contentFields.some(field=>Object.prototype.hasOwnProperty.call(input,field));if(structureChanged)throw new Error(`Active ${label} revisions are frozen. Create a new Draft revision and use Engineering Changes instead.`);if(input.status==='Draft')throw new Error(`Active ${label} revisions cannot be moved back to Draft.`);}}\n  function dateBefore(value){",
    'direct revision governance helper'
  );

  source=replaceOnceOrAlready(
    source,
    "if(method==='POST'&&pathname==='/api/manufacturing/boms'){const input=await getBody(),requestedId=input.id||`BOM-${String(input.itemId||'')}-${String(input.revision||'A')}`,existing=boms.find(row=>row.id===requestedId),row=normalizeBom({...input,id:requestedId},existing);assertEffectiveWindow(row,'BOM');assertBomLineIds(row);assertNoBomCycle(row);assertNoEffectiveOverlap(boms,row,'BOM');if(existing)Object.assign(existing,row);else boms.push(row);audit('BOM',row.id,existing?'Updated':'Created',`${row.itemId} rev ${row.revision}`,actor);return{status:existing?200:201,body:existing||row};}",
    "if(method==='POST'&&pathname==='/api/manufacturing/boms'){const input=await getBody(),requestedId=input.id||`BOM-${String(input.itemId||'')}-${String(input.revision||'A')}`,existing=boms.find(row=>row.id===requestedId),row=normalizeBom({...input,id:requestedId},existing);assertDirectRevisionGovernance(boms,input,existing,row,'BOM',['itemId','revision','components','baseQty','yieldPct','effectiveFrom']);assertEffectiveWindow(row,'BOM');assertBomLineIds(row);assertNoBomCycle(row);assertNoEffectiveOverlap(boms,row,'BOM');if(existing)Object.assign(existing,row);else boms.push(row);audit('BOM',row.id,existing?'Updated':'Created',`${row.itemId} rev ${row.revision}`,actor);return{status:existing?200:201,body:existing||row};}",
    'BOM activation governance'
  );

  source=replaceOnceOrAlready(
    source,
    "if(method==='POST'&&pathname==='/api/manufacturing/routings'){const input=await getBody(),requestedId=input.id||`RT-${String(input.itemId||'')}-${String(input.revision||'A')}`,existing=routings.find(row=>row.id===requestedId),row=normalizeRouting({...input,id:requestedId},existing);assertEffectiveWindow(row,'Routing');assertNoEffectiveOverlap(routings,row,'Routing');if(existing)Object.assign(existing,row);else routings.push(row);audit('Routing',row.id,existing?'Updated':'Created',`${row.itemId} rev ${row.revision}`,actor);return{status:existing?200:201,body:existing||row};}",
    "if(method==='POST'&&pathname==='/api/manufacturing/routings'){const input=await getBody(),requestedId=input.id||`RT-${String(input.itemId||'')}-${String(input.revision||'A')}`,existing=routings.find(row=>row.id===requestedId),row=normalizeRouting({...input,id:requestedId},existing);assertDirectRevisionGovernance(routings,input,existing,row,'Routing',['itemId','revision','operations','effectiveFrom']);assertEffectiveWindow(row,'Routing');assertNoEffectiveOverlap(routings,row,'Routing');if(existing)Object.assign(existing,row);else routings.push(row);audit('Routing',row.id,existing?'Updated':'Created',`${row.itemId} rev ${row.revision}`,actor);return{status:existing?200:201,body:existing||row};}",
    'routing activation governance'
  );
  return source;
}

export async function prepareManufacturingAgent3GovernedRuntime(inputModule='./.manufacturingRuntime-agent3.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyManufacturingAgent3GovernancePatch(source);
  await writeFile(runtimePath,patched,'utf8');
  return './.manufacturingRuntime-agent3.js';
}
