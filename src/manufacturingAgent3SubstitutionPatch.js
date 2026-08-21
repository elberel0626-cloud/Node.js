import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const runtimePath=path.join(here,'.manufacturingRuntime-agent3.js');
const clientPath=path.join(here,'../public/manufacturingModule.js');

function replaceOnceOrAlready(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`Agent 3 manufacturing substitution patch failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Agent 3 manufacturing substitution patch failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyManufacturingAgent3SubstitutionRuntimePatch(source){
  source=replaceOnceOrAlready(
    source,
    "alternateGroup:line.alternateGroup||''};});",
    "alternateGroup:line.alternateGroup||'',approvedSubstitutes:(line.approvedSubstitutes||line.substituteItems||line.substituteItemIds||[]).map((candidate,candidateIndex)=>{const substituteId=String(typeof candidate==='string'?candidate:(candidate.itemId||candidate.inventoryId||''));if(!item(substituteId))throw new Error(`Approved substitute ${candidateIndex+1} on BOM line ${index+1} was not found.`);if(substituteId===itemId)throw new Error('A manufactured item cannot substitute for itself on its BOM.');if(substituteId===componentId)throw new Error(`Approved substitute ${substituteId} duplicates the primary component.`);const qtyRatio=assertPositive(typeof candidate==='string'?1:(candidate.qtyRatio??candidate.quantityRatio??1),`Approved substitute ${substituteId} quantity ratio`);return{itemId:substituteId,description:item(substituteId)?.description||item(substituteId)?.name||substituteId,qtyRatio:qty(qtyRatio)};})};});",
    'approved BOM substitute definitions'
  );

  source=replaceOnceOrAlready(
    source,
    "issueMethod:line.issueMethod,warehouse:line.warehouse,location:line.location,unitCost:money(h.itemCost(item(line.itemId)))",
    "issueMethod:line.issueMethod,warehouse:line.warehouse,location:line.location,approvedSubstitutes:(line.approvedSubstitutes||[]).map(row=>({...row})),originalItemId:line.itemId,unitCost:money(h.itemCost(item(line.itemId)))",
    'frozen approved substitutes on production material requirements'
  );

  source=replaceOnceOrAlready(
    source,
    "const req=requested?.find(row=>String(row.itemId||row.inventoryId)===String(line.itemId));",
    "const req=requested?.find(row=>row.lineId?String(row.lineId)===String(line.lineId):String(row.itemId||row.inventoryId)===String(line.itemId));",
    'line-specific material issue selection'
  );

  source=replaceOnceOrAlready(
    source,
    "if(need>0)lines.push({itemId:line.itemId,quantity:need});",
    "if(need>0)lines.push({lineId:line.lineId,itemId:line.itemId,quantity:need});",
    'line-specific backflush selection'
  );

  source=replaceOnceOrAlready(
    source,
    "function outsideProcessingLines(order){",
    `function substituteMaterial(order,input={},user='system'){
    if(!['Released','Material Shortage','In Process'].includes(order.status))throw new Error('Component substitution is allowed only on active released production orders.');const lineId=String(input.lineId||''),line=(order.materials||[]).find(row=>String(row.lineId)===lineId);if(!line)throw new Error('Select a production material line to substitute.');if(line.isSubstitute)throw new Error('A substitute material line cannot be substituted again.');const substituteItemId=String(input.substituteItemId||input.itemId||''),approved=(line.approvedSubstitutes||[]).find(row=>String(row.itemId)===substituteItemId);if(!approved)throw new Error(substituteItemId+' is not an approved substitute for '+line.itemId+'. Update the BOM through Engineering Changes first.');const substituteItem=item(substituteItemId);if(!substituteItem||substituteItem.trackQuantity===false)throw new Error('Approved substitute must be an active stock item.');const reason=String(input.reason||'').trim();if(!reason)throw new Error('A substitution reason is required.');const remainingPrimary=Math.max(0,Number(line.requiredQty||0)-Number(line.qtyIssued||0));const primaryQty=qty(assertPositive(input.quantity??input.primaryQuantity??remainingPrimary,'Primary quantity to substitute'));if(primaryQty>remainingPrimary+0.000001)throw new Error('Substitution quantity exceeds the unissued primary component requirement.');const ratio=assertPositive(approved.qtyRatio||1,'Substitute quantity ratio'),substituteQty=qty(primaryQty*ratio);if(substituteQty<=0)throw new Error('Calculated substitute quantity must be greater than zero.');const releaseReserved=Math.min(Number(line.qtyReserved||0),primaryQty);if(releaseReserved>0){h.adjustInventoryBalance({itemId:line.itemId,warehouse:line.warehouse,location:line.location,allocatedDelta:-releaseReserved});line.qtyReserved=qty(Number(line.qtyReserved||0)-releaseReserved);}line.requiredQty=qty(Number(line.requiredQty||0)-primaryQty);line.shortageQty=qty(Math.max(0,Number(line.requiredQty||0)-Number(line.qtyIssued||0)-Number(line.qtyReserved||0)));line.substitutedPrimaryQty=qty(Number(line.substitutedPrimaryQty||0)+primaryQty);const subLineId=line.lineId+'-SUB'+String((order.materials||[]).filter(row=>String(row.originalLineId||'')===String(line.lineId)).length+1),warehouse=input.warehouse||substituteItem.defaultWarehouse||line.warehouse,location=input.location||substituteItem.defaultLocation||line.location,balance=h.getBalance(substituteItemId,warehouse,location),available=Math.max(0,Number(h.qtyAvail(balance)||0)),reserve=Math.min(substituteQty,available);if(reserve>0)h.adjustInventoryBalance({itemId:substituteItemId,warehouse,location,allocatedDelta:reserve});const substituteLine={lineId:subLineId,itemId:substituteItemId,description:substituteItem.description||substituteItem.name||substituteItemId,requiredQty:substituteQty,qtyReserved:qty(reserve),qtyIssued:0,issuedValue:0,shortageQty:qty(Math.max(0,substituteQty-reserve)),uom:substituteItem.uom||line.uom||'EA',supplyType:'Substitute',issueMethod:line.issueMethod,warehouse,location,unitCost:money(h.itemCost(substituteItem)),extendedRequiredCost:money(substituteQty*h.itemCost(substituteItem)),approvedSubstitutes:[],originalLineId:line.lineId,originalItemId:line.itemId,isSubstitute:true,substitutionReason:reason,substitutedBy:user,substitutedAt:new Date().toISOString(),quantityRatio:ratio};order.materials.push(substituteLine);order.substitutionHistory=order.substitutionHistory||[];order.substitutionHistory.push({id:'SUB-'+String(order.substitutionHistory.length+1).padStart(4,'0'),lineId:line.lineId,originalItemId:line.itemId,substituteLineId:subLineId,substituteItemId,primaryQuantity:primaryQty,substituteQuantity:substituteQty,quantityRatio:ratio,reason,user,timestamp:new Date().toISOString()});order.materialShortage=(order.materials||[]).some(row=>Number(row.shortageQty||0)>0);if(order.materialShortage&&order.status==='Released')order.status='Material Shortage';else if(!order.materialShortage&&order.status==='Material Shortage')order.status='Released';order.updatedAt=new Date().toISOString();audit('Production Order',order.id,'Material Substituted',line.itemId+' x '+primaryQty+' replaced with '+substituteItemId+' x '+substituteQty+'. Reason: '+reason,user);return order;
  }
  function outsideProcessingLines(order){`,
    'controlled material substitution workflow'
  );

  source=replaceOnceOrAlready(
    source,
    "(?:\\/(release|issue-materials|return-materials|create-subcontract-po|report-operation|complete|close|cancel))?$/",
    "(?:\\/(release|issue-materials|return-materials|substitute-material|create-subcontract-po|report-operation|complete|close|cancel))?$/",
    'substitute material production route'
  );

  source=replaceOnceOrAlready(
    source,
    "else if(action==='return-materials')returnMaterials(order,input,actor);else if(action==='create-subcontract-po')",
    "else if(action==='return-materials')returnMaterials(order,input,actor);else if(action==='substitute-material')substituteMaterial(order,input,actor);else if(action==='create-subcontract-po')",
    'substitute material production action'
  );
  return source;
}

export function applyManufacturingAgent3SubstitutionClientPatch(source){
  source=replaceOnceOrAlready(
    source,
    "${field('Issue',`mfgCompIssue${index}`,{options:[{value:'Backflush',label:'Backflush'},{value:'Manual',label:'Manual'}]})}<button",
    "${field('Issue',`mfgCompIssue${index}`,{options:[{value:'Backflush',label:'Backflush'},{value:'Manual',label:'Manual'}]})}${field('Approved Substitutes',`mfgCompSubs${index}`,{placeholder:'ITEM-2001, ITEM-2002'})}<button",
    'BOM approved substitutes field'
  );

  source=replaceOnceOrAlready(
    source,
    "issueMethod:document.getElementById(`mfgCompIssue${i}`).value};}).filter(x=>x.itemId);",
    "issueMethod:document.getElementById(`mfgCompIssue${i}`).value,approvedSubstitutes:String(document.getElementById(`mfgCompSubs${i}`).value||'').split(',').map(value=>value.trim()).filter(Boolean).map(itemId=>({itemId,qtyRatio:1}))};}).filter(x=>x.itemId);",
    'BOM approved substitutes payload'
  );

  source=replaceOnceOrAlready(
    source,
    "{label:'Issue Method',key:'issueMethod'},{label:'Warehouse'",
    "{label:'Issue Method',key:'issueMethod'},{label:'Approved Substitutes',render:r=>(r.approvedSubstitutes||[]).map(s=>`${esc(s.itemId)} (${fmtNum(s.qtyRatio||1)}:1)`).join(', ')||'—'},{label:'Substitution',render:r=>r.isSubstitute?`${badge('Substitute')} ${esc(r.originalItemId)} → ${esc(r.itemId)}<div class='mfg-muted'>${esc(r.substitutionReason||'')}</div>`:''},{label:'Warehouse'",
    'production material substitution columns'
  );

  source=replaceOnceOrAlready(
    source,
    "<div class='mfg-action-card'><h4>Report Operation</h4>",
    "<div class='mfg-action-card'><h4>Substitute Component</h4><p>Use only BOM-approved substitutes. The production-order change is audited and does not alter the released BOM revision.</p><div class='mfg-mini-grid'>${field('Material Line ID','mfgSubLine',{placeholder:'L1'})}${field('Substitute Item','mfgSubItem',{options:itemOptions()})}${field('Primary Qty to Replace','mfgSubQty',{type:'number',value:1,step:'0.0001',min:0})}${field('Reason','mfgSubReason',{placeholder:'Shortage, approved alternate, quality issue...'})}</div>${button('Apply Substitute',{id:'mfgSubstituteMaterial',disabled:!['Released','Material Shortage','In Process'].includes(order.status)})}</div><div class='mfg-action-card'><h4>Report Operation</h4>",
    'production substitution action card'
  );

  source=replaceOnceOrAlready(
    source,
    "document.getElementById('mfgIssueMaterials')?.addEventListener('click',()=>action('issue-materials'));",
    "document.getElementById('mfgIssueMaterials')?.addEventListener('click',()=>action('issue-materials'));\n  document.getElementById('mfgSubstituteMaterial')?.addEventListener('click',()=>action('substitute-material',{lineId:document.getElementById('mfgSubLine').value,substituteItemId:document.getElementById('mfgSubItem').value,quantity:Number(document.getElementById('mfgSubQty').value),reason:document.getElementById('mfgSubReason').value}));",
    'production substitution action handler'
  );
  return source;
}

export async function prepareManufacturingAgent3SubstitutionRuntime(inputModule='./.manufacturingRuntime-agent3.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyManufacturingAgent3SubstitutionRuntimePatch(source);
  await writeFile(runtimePath,patched,'utf8');
  return './.manufacturingRuntime-agent3.js';
}

export async function patchManufacturingAgent3SubstitutionUiFile(){
  const source=await readFile(clientPath,'utf8');
  const patched=applyManufacturingAgent3SubstitutionClientPatch(source);
  if(patched!==source)await writeFile(clientPath,patched,'utf8');
  return clientPath;
}
