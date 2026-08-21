import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const reviewedRuntimePath=path.join(here,'.manufacturingRuntime-agent3.js');
const clientPath=path.join(here,'../public/manufacturingModule.js');

function replaceOnceOrAlready(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`Agent 3 manufacturing UI patch failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Agent 3 manufacturing UI patch failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyManufacturingAgent3UiRuntimePatch(source){
  return replaceOnceOrAlready(
    source,
    "})),warehouses,locations:inventoryLocations,vendors:vendors.filter(v=>v.status!=='Inactive').map(v=>({id:v.id,name:v.name}))",
    "})),serviceItems:itemMaster.filter(row=>row.trackQuantity===false||['Service Item','Non-Stock Item','Expense Item'].includes(row.type)).map(row=>({id:row.code||row.inventoryId,code:row.code||row.inventoryId,description:row.description||row.name||row.code||row.inventoryId,type:row.type,cost:Number(row.lastCost||row.averageCost||row.cost||0)})),warehouses,locations:inventoryLocations,vendors:vendors.filter(v=>v.status!=='Inactive').map(v=>({id:v.id,name:v.name}))",
    'service item reference data'
  );
}

export function applyManufacturingAgent3UiClientPatch(source){
  source=replaceOnceOrAlready(
    source,
    "['Reports',[['/manufacturing/reports/wip','WIP Report'],['/manufacturing/reports/variance','Production Variance'],['/manufacturing/reports/material-shortages','Material Shortages'],['/manufacturing/reports/production','Production Performance']]],",
    "['Reports',[['/manufacturing/reports/wip','WIP Report'],['/manufacturing/reports/wip-reconciliation','WIP / GL Reconciliation'],['/manufacturing/reports/variance','Production Variance'],['/manufacturing/reports/material-shortages','Material Shortages'],['/manufacturing/reports/production','Production Performance'],['/manufacturing/cost-rollup','Standard Cost Rollup']]],",
    'advanced manufacturing navigation'
  );

  source=replaceOnceOrAlready(
    source,
    "function wcOptions({withBlank=true}={}){return[...(withBlank?[{value:'',label:'Select work center'}]:[]),...(window.__mfgWorkCenters||[]).map(w=>({value:w.id,label:`${w.id} — ${w.name}`}))];}",
    "function vendorOptions({withBlank=true}={}){return[...(withBlank?[{value:'',label:'Select vendor'}]:[]),...(referenceData?.vendors||[]).map(v=>({value:v.id,label:`${v.id} — ${v.name}`}))];}\nfunction serviceItemOptions({withBlank=true}={}){return[...(withBlank?[{value:'',label:'Select service item'}]:[]),...(referenceData?.serviceItems||[]).map(i=>({value:i.id,label:`${i.id} — ${i.description}`}))];}\nfunction wcOptions({withBlank=true}={}){return[...(withBlank?[{value:'',label:'Select work center'}]:[]),...(window.__mfgWorkCenters||[]).map(w=>({value:w.id,label:`${w.id} — ${w.name}`}))];}",
    'outside processing UI selectors'
  );

  source=replaceOnceOrAlready(
    source,
    "function operationRow(index){return`<div class='mfg-line mfg-operation-line' data-index='${index}'>${field('Seq',`mfgRouteSeq${index}`,{type:'number',value:(index+1)*10,min:1})}${field('Work Center',`mfgRouteWc${index}`,{options:wcOptions()})}${field('Description',`mfgRouteDesc${index}`,{value:index===0?'Production operation':''})}${field('Setup Hrs',`mfgRouteSetup${index}`,{type:'number',value:0,step:'0.1',min:0})}${field('Run Hrs / Unit',`mfgRouteRun${index}`,{type:'number',value:0.1,step:'0.01',min:0})}<label class='mfg-check'><input id='mfgRouteQc${index}' type='checkbox'> Quality checkpoint</label><button class='mfg-btn danger mfg-remove-line' type='button'>Remove</button></div>`;}",
    "function operationRow(index){return`<div class='mfg-line mfg-operation-line' data-index='${index}'>${field('Seq',`mfgRouteSeq${index}`,{type:'number',value:(index+1)*10,min:1})}${field('Work Center',`mfgRouteWc${index}`,{options:wcOptions()})}${field('Description',`mfgRouteDesc${index}`,{value:index===0?'Production operation':''})}${field('Setup Hrs',`mfgRouteSetup${index}`,{type:'number',value:0,step:'0.1',min:0})}${field('Run Hrs / Unit',`mfgRouteRun${index}`,{type:'number',value:0.1,step:'0.01',min:0})}<label class='mfg-check'><input id='mfgRouteQc${index}' type='checkbox'> Quality checkpoint</label><label class='mfg-check'><input id='mfgRouteOutside${index}' type='checkbox'> Outside processing</label>${field('Subcontract Vendor',`mfgRouteVendor${index}`,{options:vendorOptions()})}${field('Service Item',`mfgRouteService${index}`,{options:serviceItemOptions()})}${field('Outside Cost / Unit',`mfgRouteOutsideCost${index}`,{type:'number',value:0,step:'0.01',min:0})}<button class='mfg-btn danger mfg-remove-line' type='button'>Remove</button></div>`;}",
    'outside processing routing fields'
  );

  source=replaceOnceOrAlready(
    source,
    "qualityCheckpoint:document.getElementById(`mfgRouteQc${i}`).checked};});",
    "qualityCheckpoint:document.getElementById(`mfgRouteQc${i}`).checked,outsideProcessing:document.getElementById(`mfgRouteOutside${i}`).checked,vendorId:document.getElementById(`mfgRouteVendor${i}`).value,serviceItemId:document.getElementById(`mfgRouteService${i}`).value,outsideUnitCost:Number(document.getElementById(`mfgRouteOutsideCost${i}`).value)};});",
    'outside processing routing save payload'
  );

  source=replaceOnceOrAlready(
    source,
    "{label:'Good / Scrap',render:r=>`${fmtNum(r.qtyGood)} / ${fmtNum(r.qtyScrap)}`}]",
    "{label:'Good / Scrap',render:r=>`${fmtNum(r.qtyGood)} / ${fmtNum(r.qtyScrap)}`},{label:'Outside Processing',render:r=>r.outsideProcessing?(r.subcontractPoId?`<strong>${esc(r.subcontractPoId)}</strong>`:`<button class='mfg-btn mfg-create-subcontract' data-seq='${esc(r.sequence)}'>Create Subcontract PO</button>`):''}]",
    'outside processing production order column'
  );

  source=replaceOnceOrAlready(
    source,
    "document.getElementById('mfgIssueMaterials')?.addEventListener('click',()=>action('issue-materials'));",
    "document.getElementById('mfgIssueMaterials')?.addEventListener('click',()=>action('issue-materials'));\n  document.querySelectorAll('.mfg-create-subcontract').forEach(btn=>btn.addEventListener('click',()=>action('create-subcontract-po',{sequence:Number(btn.dataset.seq)})));",
    'subcontract purchase order action'
  );

  source=replaceOnceOrAlready(
    source,
    "['Overhead','overheadCost'],['WIP Balance','wipBalance']",
    "['Overhead','overheadCost'],['Outside Processing','outsideProcessingCost'],['WIP Balance','wipBalance']",
    'outside processing WIP report column'
  );
  source=replaceOnceOrAlready(
    source,
    "'materialCost','laborCost','machineCost','overheadCost','wipBalance'",
    "'materialCost','laborCost','machineCost','overheadCost','outsideProcessingCost','wipBalance'",
    'outside processing WIP money formatting'
  );

  source=replaceOnceOrAlready(
    source,
    "async function settingsPage(){",
    `async function costRollupPage(){setTitle('Standard Cost Rollup');await loadReference();const manufactured=(referenceData.items||[]).filter(row=>row.hasBom);document.getElementById('view').innerHTML=section('Preview and Apply Standard Cost',\`<div class='mfg-form-grid'>\${field('Manufactured Item','mfgCostItem',{options:[{value:'',label:'Select manufactured item'},...manufactured.map(row=>({value:row.id,label:\`\${row.id} — \${row.description}\`}))]})}\${field('Effective Date','mfgCostDate',{type:'date',value:today()})}</div><div class='mfg-actions'>\${button('Preview Rollup',{id:'mfgCostPreview',kind:'primary'})}\${button('Apply Standard Cost',{id:'mfgCostApply'})}</div><div id='mfgCostResult' class='mfg-muted'>Select an item and preview its BOM/routing cost.</div>\`);const run=async apply=>{try{const itemId=document.getElementById('mfgCostItem').value,effectiveDate=document.getElementById('mfgCostDate').value;if(!itemId)throw new Error('Select a manufactured item.');const result=apply?await api('/api/manufacturing/cost-rollup/apply',{method:'POST',body:{itemId,effectiveDate,confirm:true}}):await api(\`/api/manufacturing/cost-rollup?itemId=\${encodeURIComponent(itemId)}&effectiveDate=\${encodeURIComponent(effectiveDate)}\`);document.getElementById('mfgCostResult').innerHTML=\`<div class='mfg-kpis compact'>\${[['Material',result.material],['Labor',result.labor],['Machine',result.machine],['Overhead',result.overhead],['Outside Processing',result.outsideProcessing],['Rolled Standard Cost',result.total]].map(([label,value])=>\`<div class='mfg-kpi'><span>\${esc(label)}</span><strong>\${fmtMoney(value)}</strong></div>\`).join('')}</div>\${section('Component Cost Detail',table(result.components||[],[{label:'Component',key:'itemId'},{label:'Supply',key:'supplyType'},{label:'Qty / FG',key:'quantityPerFinishedUnit'},{label:'Unit Cost',render:r=>fmtMoney(r.unitCost)},{label:'Extended',render:r=>fmtMoney(r.extendedCost)}],'No material components.'))}\${section('Routing Cost Detail',table(result.routing||[],[{label:'Seq',key:'sequence'},{label:'Type',key:'type'},{label:'Hours',key:'hours'},{label:'Labor',render:r=>fmtMoney(r.laborCost||0)},{label:'Machine',render:r=>fmtMoney(r.machineCost||0)},{label:'Overhead / Outside',render:r=>fmtMoney(r.type==='Outside Processing'?r.cost:r.overheadCost||0)}],'No routing operations.'))}\`;if(apply)toast('Standard cost rollup applied.');}catch(e){showError(e);}};document.getElementById('mfgCostPreview').onclick=()=>run(false);document.getElementById('mfgCostApply').onclick=()=>run(true);}
async function wipReconciliationPage(){setTitle('WIP / GL Reconciliation');const rows=await api('/api/manufacturing/reports/wip-reconciliation');document.getElementById('view').innerHTML=\`\${section('Manufacturing WIP Reconciliation',table(rows,[{label:'Order',key:'orderNumber'},{label:'Item',key:'itemId'},{label:'Status',render:r=>badge(r.status)},{label:'Manufacturing Subledger',render:r=>fmtMoney(r.subledgerWip)},{label:'GL WIP',render:r=>fmtMoney(r.glWip)},{label:'Difference',render:r=>\`<strong class='\${r.inBalance?'':'mfg-danger'}'>\${fmtMoney(r.difference)}</strong>\`},{label:'Status',render:r=>badge(r.inBalance?'Balanced':'Out of Balance')},{label:'Journals',key:'journalCount'},{label:'Outside Receipts',key:'outsideReceiptCount'}],'No production WIP to reconcile.'))}<div class='mfg-alert'><strong>Control objective</strong><span>Manufacturing subledger WIP should equal GL account 1508 by production order, including outside-processing purchase receipts capitalized to WIP.</span></div>\`;}

async function settingsPage(){`,
    'advanced costing and reconciliation pages'
  );

  source=replaceOnceOrAlready(
    source,
    "if(path==='/manufacturing/reports/wip')return await reportPage('wip');",
    "if(path==='/manufacturing/reports/wip')return await reportPage('wip');if(path==='/manufacturing/reports/wip-reconciliation')return await wipReconciliationPage();if(path==='/manufacturing/cost-rollup')return await costRollupPage();",
    'advanced manufacturing routes'
  );

  return source;
}

export async function prepareManufacturingAgent3UiRuntime(inputModule='./.manufacturingRuntime-agent3.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyManufacturingAgent3UiRuntimePatch(source);
  await writeFile(reviewedRuntimePath,patched,'utf8');
  return './.manufacturingRuntime-agent3.js';
}

export async function patchManufacturingAgent3UiFile(){
  const source=await readFile(clientPath,'utf8');
  const patched=applyManufacturingAgent3UiClientPatch(source);
  if(patched!==source)await writeFile(clientPath,patched,'utf8');
  return clientPath;
}
