import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const runtimePath=path.join(here,'.manufacturingRuntime-agent3.js');
const clientPath=path.join(here,'../public/manufacturingModule.js');

function replaceOnceOrAlready(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`Agent 3 engineering patch failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Agent 3 engineering patch failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyManufacturingAgent3EngineeringRuntimePatch(source){
  source=replaceOnceOrAlready(source,"const auditTrail=[];","const auditTrail=[];\n  const engineeringChanges=[];",'engineering change store');

  source=replaceOnceOrAlready(
    source,
    "function upsertWorkCenter(input={},user='system'){",
    `function dateBefore(value){const d=new Date(String(value||nowDate())+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}
  function engineeringDraft(itemId,revision,scope){const bom=scope!=='Routing'?boms.find(row=>row.itemId===itemId&&String(row.revision)===String(revision)&&row.status==='Draft'):null,routing=scope!=='BOM'?routings.find(row=>row.itemId===itemId&&String(row.revision)===String(revision)&&row.status==='Draft'):null;if(scope!=='Routing'&&!bom)throw new Error('A Draft BOM revision '+revision+' is required before creating this engineering change.');if(scope!=='BOM'&&!routing)throw new Error('A Draft routing revision '+revision+' is required before creating this engineering change.');return{bom,routing};}
  function createEngineeringChange(input={},user='system'){const itemId=String(input.itemId||''),scope=String(input.scope||'BOM & Routing'),revision=String(input.proposedRevision||input.revision||''),effectiveDate=String(input.effectiveDate||'');if(!item(itemId))throw new Error('Engineering change item is required.');if(!['BOM','Routing','BOM & Routing'].includes(scope))throw new Error('Engineering change scope must be BOM, Routing, or BOM & Routing.');if(!revision)throw new Error('Proposed revision is required.');if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(effectiveDate))throw new Error('Engineering change effective date is required.');engineeringDraft(itemId,revision,scope);const duplicate=engineeringChanges.find(row=>row.itemId===itemId&&row.proposedRevision===revision&&!['Rejected','Cancelled'].includes(row.status));if(duplicate)throw new Error('An active engineering change already exists for '+itemId+' revision '+revision+'.');const row={id:nextId('ECO',engineeringChanges),changeNumber:'',itemId,scope,proposedRevision:revision,effectiveDate,reason:String(input.reason||''),status:'Draft',requestedBy:user,requestedAt:new Date().toISOString(),submittedAt:'',approvedBy:'',approvedAt:'',appliedBy:'',appliedAt:'',rejectedBy:'',rejectedAt:'',rejectionReason:'',affectedOpenOrders:orders.filter(order=>order.itemId===itemId&&activeMfgStatus(order.status)).map(order=>order.id)};if(!row.reason)throw new Error('Engineering change reason is required.');row.changeNumber=row.id;engineeringChanges.push(row);audit('Engineering Change',row.id,'Created',itemId+' revision '+revision+' ('+scope+').',user);return row;}
  function submitEngineeringChange(row,user='system'){if(!['Draft','Rejected'].includes(row.status))throw new Error('Only Draft or Rejected engineering changes can be submitted.');engineeringDraft(row.itemId,row.proposedRevision,row.scope);row.status='Pending Approval';row.requestedBy=user;row.submittedAt=new Date().toISOString();row.approvedBy='';row.approvedAt='';row.rejectionReason='';audit('Engineering Change',row.id,'Submitted','Pending approval.',user);return row;}
  function approveEngineeringChange(row,user='system'){if(row.status!=='Pending Approval')throw new Error('Only Pending Approval engineering changes can be approved.');if(String(user)===String(row.requestedBy))throw new Error('Engineering change approval requires a different user than the requester.');engineeringDraft(row.itemId,row.proposedRevision,row.scope);row.status='Approved';row.approvedBy=user;row.approvedAt=new Date().toISOString();audit('Engineering Change',row.id,'Approved','Approved for '+row.effectiveDate+'.',user);return row;}
  function rejectEngineeringChange(row,input={},user='system'){if(!['Pending Approval','Approved'].includes(row.status))throw new Error('Only pending or approved engineering changes can be rejected.');if(String(user)===String(row.requestedBy))throw new Error('Engineering change rejection requires a different user than the requester.');row.status='Rejected';row.rejectedBy=user;row.rejectedAt=new Date().toISOString();row.rejectionReason=String(input.reason||'');if(!row.rejectionReason)throw new Error('A rejection reason is required.');audit('Engineering Change',row.id,'Rejected',row.rejectionReason,user);return row;}
  function validateEngineeringActivation(rows,draft,effectiveDate,label){const prior=rows.find(row=>row.itemId===draft.itemId&&row.status==='Active'&&row.id!==draft.id&&(!row.effectiveFrom||row.effectiveFrom<=effectiveDate)&&(!row.effectiveTo||row.effectiveTo>=effectiveDate)),end=dateBefore(effectiveDate);if(prior&&prior.effectiveFrom&&end<prior.effectiveFrom)throw new Error(label+' effectivity would end the current revision before it begins.');const conflict=rows.find(row=>row.itemId===draft.itemId&&row.status==='Active'&&row.id!==draft.id&&row.id!==prior?.id&&(row.effectiveFrom||'0000-01-01')<=(draft.effectiveTo||'9999-12-31')&&(row.effectiveTo||'9999-12-31')>=effectiveDate);if(conflict)throw new Error(label+' activation overlaps active revision '+conflict.revision+'.');return{prior,end};}
  function applyEngineeringChange(row,user='system'){if(row.status!=='Approved')throw new Error('Only Approved engineering changes can be applied.');if(!row.approvedBy)throw new Error('Engineering change approval is missing.');const draft=engineeringDraft(row.itemId,row.proposedRevision,row.scope),changes=[];const bomActivation=draft.bom?validateEngineeringActivation(boms,draft.bom,row.effectiveDate,'BOM'):null,routingActivation=draft.routing?validateEngineeringActivation(routings,draft.routing,row.effectiveDate,'Routing'):null;if(draft.bom){assertEffectiveWindow({...draft.bom,status:'Active',effectiveFrom:row.effectiveDate},'BOM');assertBomLineIds(draft.bom);assertNoBomCycle({...draft.bom,status:'Active',effectiveFrom:row.effectiveDate});if(bomActivation.prior)bomActivation.prior.effectiveTo=bomActivation.end;draft.bom.status='Active';draft.bom.effectiveFrom=row.effectiveDate;changes.push('BOM '+draft.bom.revision);}if(draft.routing){assertEffectiveWindow({...draft.routing,status:'Active',effectiveFrom:row.effectiveDate},'Routing');if(routingActivation.prior)routingActivation.prior.effectiveTo=routingActivation.end;draft.routing.status='Active';draft.routing.effectiveFrom=row.effectiveDate;changes.push('Routing '+draft.routing.revision);}row.status='Applied';row.appliedBy=user;row.appliedAt=new Date().toISOString();row.appliedChanges=changes;row.frozenOpenOrders=orders.filter(order=>order.itemId===row.itemId&&activeMfgStatus(order.status)).map(order=>({orderId:order.id,bomRevision:order.bomRevision,routingRevision:order.routingRevision}));audit('Engineering Change',row.id,'Applied',changes.join(', ')+' effective '+row.effectiveDate+'. Existing released orders retained frozen revisions.',user);return row;}
  function upsertWorkCenter(input={},user='system'){`,
    'engineering change workflow functions'
  );

  source=replaceOnceOrAlready(
    source,
    "if(method==='GET'&&pathname==='/api/manufacturing/work-centers')return{status:200,body:workCenters};",
    "if(method==='GET'&&pathname==='/api/manufacturing/engineering-changes')return{status:200,body:engineeringChanges};if(method==='POST'&&pathname==='/api/manufacturing/engineering-changes')return{status:201,body:createEngineeringChange(await getBody(),actor)};const ecoMatch=pathname.match(/^\\/api\\/manufacturing\\/engineering-changes\\/([^/]+)\\/(submit|approve|reject|apply)$/);if(method==='POST'&&ecoMatch){const row=engineeringChanges.find(change=>change.id===decodeURIComponent(ecoMatch[1]));if(!row)return{status:404,body:{error:'Engineering change not found.'}};const input=await getBody(),action=ecoMatch[2];if(action==='submit')return{status:200,body:submitEngineeringChange(row,actor)};if(action==='approve')return{status:200,body:approveEngineeringChange(row,actor)};if(action==='reject')return{status:200,body:rejectEngineeringChange(row,input,actor)};return{status:200,body:applyEngineeringChange(row,actor)};}if(method==='GET'&&pathname==='/api/manufacturing/work-centers')return{status:200,body:workCenters};",
    'engineering change endpoints'
  );

  source=replaceOnceOrAlready(
    source,
    "maintenanceOrders,auditTrail}};",
    "maintenanceOrders,engineeringChanges,auditTrail}};",
    'engineering change runtime state'
  );
  return source;
}

export function applyManufacturingAgent3EngineeringClientPatch(source){
  if(!source.includes("['Draft','Active','Inactive','Obsolete']"))source=source.replaceAll("['Active','Inactive','Obsolete']","['Draft','Active','Inactive','Obsolete']");
  source=replaceOnceOrAlready(
    source,
    "['Manage',[['/manufacturing/boms','Bills of Material'],['/manufacturing/routings','Routings'],['/manufacturing/work-centers','Work Centers']]],",
    "['Manage',[['/manufacturing/boms','Bills of Material'],['/manufacturing/routings','Routings'],['/manufacturing/engineering-changes','Engineering Changes'],['/manufacturing/work-centers','Work Centers']]],",
    'engineering change navigation'
  );
  source=replaceOnceOrAlready(
    source,
    "async function workCentersPage(){",
    `async function engineeringChangesPage(){setTitle('Engineering Changes');await loadReference();const rows=await api('/api/manufacturing/engineering-changes');const actionButtons=row=>{if(row.status==='Draft'||row.status==='Rejected')return \`<button class='mfg-btn mfg-eco-action' data-id='\${esc(row.id)}' data-action='submit'>Submit</button>\`;if(row.status==='Pending Approval')return \`<button class='mfg-btn primary mfg-eco-action' data-id='\${esc(row.id)}' data-action='approve'>Approve</button><button class='mfg-btn danger mfg-eco-action' data-id='\${esc(row.id)}' data-action='reject'>Reject</button>\`;if(row.status==='Approved')return \`<button class='mfg-btn primary mfg-eco-action' data-id='\${esc(row.id)}' data-action='apply'>Apply Revision</button><button class='mfg-btn danger mfg-eco-action' data-id='\${esc(row.id)}' data-action='reject'>Reject</button>\`;return'';};document.getElementById('view').innerHTML=\`\${section('Create Engineering Change',\`<div class='mfg-form-grid'>\${field('Item','mfgEcoItem',{options:itemOptions()})}\${field('Scope','mfgEcoScope',{options:['BOM','Routing','BOM & Routing'].map(value=>({value,label:value}))})}\${field('Proposed Draft Revision','mfgEcoRevision',{value:'B'})}\${field('Effective Date','mfgEcoDate',{type:'date',value:today()})}\${field('Reason / Change Description','mfgEcoReason')}</div><div class='mfg-alert'><strong>Controlled revision process</strong><span>Create the new BOM/routing revision as Draft first. The ECO then requires submission and approval by a different user before that Draft revision can become Active. Existing released production orders retain their frozen revisions.</span></div><div class='mfg-actions'>\${button('Create Engineering Change',{id:'mfgEcoCreate',kind:'primary'})}</div>\`)}\${section('Engineering Change Register',table(rows,[{label:'ECO',key:'id'},{label:'Item',key:'itemId'},{label:'Scope',key:'scope'},{label:'Revision',key:'proposedRevision'},{label:'Effective',key:'effectiveDate'},{label:'Reason',key:'reason'},{label:'Status',render:r=>badge(r.status)},{label:'Requester',key:'requestedBy'},{label:'Approver',key:'approvedBy'},{label:'Action',render:actionButtons}],'No engineering changes.'))}\`;document.getElementById('mfgEcoCreate').onclick=async()=>{try{await api('/api/manufacturing/engineering-changes',{method:'POST',body:{itemId:document.getElementById('mfgEcoItem').value,scope:document.getElementById('mfgEcoScope').value,proposedRevision:document.getElementById('mfgEcoRevision').value,effectiveDate:document.getElementById('mfgEcoDate').value,reason:document.getElementById('mfgEcoReason').value}});toast('Engineering change created.');await engineeringChangesPage();}catch(e){showError(e);}};document.getElementById('view').addEventListener('click',async event=>{const btn=event.target.closest('.mfg-eco-action');if(!btn)return;try{const body=btn.dataset.action==='reject'?{reason:prompt('Rejection reason')||''}:{};await api(\`/api/manufacturing/engineering-changes/\${encodeURIComponent(btn.dataset.id)}/\${btn.dataset.action}\`,{method:'POST',body});toast('Engineering change updated.');await engineeringChangesPage();}catch(e){showError(e);}});}

async function workCentersPage(){`,
    'engineering change page'
  );
  source=replaceOnceOrAlready(
    source,
    "if(path==='/manufacturing/routings')return await routingsPage();",
    "if(path==='/manufacturing/routings')return await routingsPage();if(path==='/manufacturing/engineering-changes')return await engineeringChangesPage();",
    'engineering change client route'
  );
  return source;
}

export async function prepareManufacturingAgent3EngineeringRuntime(inputModule='./.manufacturingRuntime-agent3.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyManufacturingAgent3EngineeringRuntimePatch(source);
  await writeFile(runtimePath,patched,'utf8');
  return './.manufacturingRuntime-agent3.js';
}

export async function patchManufacturingAgent3EngineeringUiFile(){
  const source=await readFile(clientPath,'utf8');
  const patched=applyManufacturingAgent3EngineeringClientPatch(source);
  if(patched!==source)await writeFile(clientPath,patched,'utf8');
  return clientPath;
}
