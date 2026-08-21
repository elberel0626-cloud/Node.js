import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const runtimePath=path.join(here,'.manufacturingRuntime-agent3.js');
const clientPath=path.join(here,'../public/manufacturingModule.js');

function replaceOnceOrAlready(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`Agent 3 manufacturing traceability patch failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Agent 3 manufacturing traceability patch failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyManufacturingAgent3TraceabilityRuntimePatch(source){
  source=replaceOnceOrAlready(
    source,
    "const itemMaster=context.itemMaster||[],inventoryBalances=context.inventoryBalances||[],inventoryTransactions=context.inventoryTransactions||[],purchaseOrders=context.purchaseOrders||[],purchaseOrderLines=context.purchaseOrderLines||[],purchaseReceiptLines=context.purchaseReceiptLines||[],journalEntries=context.journalEntries||[],vendors=context.vendors||[],salesOrders=context.salesOrders||[],salesOrderLines=context.salesOrderLines||[],warehouses=context.warehouses||[],inventoryLocations=context.inventoryLocations||[];",
    "const itemMaster=context.itemMaster||[],inventoryBalances=context.inventoryBalances||[],inventoryTransactions=context.inventoryTransactions||[],inventoryTraceBalances=context.inventoryTraceBalances||[],inventoryTraceTransactions=context.inventoryTraceTransactions||[],purchaseOrders=context.purchaseOrders||[],purchaseOrderLines=context.purchaseOrderLines||[],purchaseReceiptLines=context.purchaseReceiptLines||[],journalEntries=context.journalEntries||[],vendors=context.vendors||[],salesOrders=context.salesOrders||[],salesOrderLines=context.salesOrderLines||[],warehouses=context.warehouses||[],inventoryLocations=context.inventoryLocations||[];",
    'shared traceability context'
  );

  source=replaceOnceOrAlready(
    source,
    "for(const name of required)if(typeof h[name]!=='function')throw new Error(`Manufacturing integration helper ${name} is required.`);",
    `for(const name of required)if(typeof h[name]!=='function')throw new Error(\`Manufacturing integration helper \${name} is required.\`);
  const traceMode=typeof h.inventoryTrackingMode==='function'?h.inventoryTrackingMode:()=> 'None';
  const traceNormalize=typeof h.normalizeInventoryTraceAllocations==='function'?h.normalizeInventoryTraceAllocations:()=>[];
  const traceSelect=typeof h.selectInventoryTraceAllocations==='function'?h.selectInventoryTraceAllocations:()=>[];
  const traceReceipt=typeof h.applyInventoryTraceReceipt==='function'?h.applyInventoryTraceReceipt:()=>[];
  const traceIssue=typeof h.applyInventoryTraceIssue==='function'?h.applyInventoryTraceIssue:()=>[];
  const traceReport=typeof h.inventoryTraceabilityReport==='function'?h.inventoryTraceabilityReport:()=>({balances:[],transactions:[]});
  function traceNumber(row){return String(row?.traceNumber||row?.lotNumber||row?.serialNumber||'');}
  function selectReturnedTrace(line,returnQty,request={}){const mode=traceMode(item(line.itemId));if(mode==='None')return[];const requested=request.lotSerialAllocations||request.traceAllocations||[];const available=new Map();for(const history of line.traceIssueHistory||[]){for(const allocation of history.traceAllocations||[]){const key=traceNumber(allocation),row=available.get(key)||{...allocation,quantity:0};row.quantity+=Number(allocation.quantity||0);available.set(key,row);}}for(const history of line.traceReturnHistory||[]){for(const allocation of history.traceAllocations||[]){const key=traceNumber(allocation),row=available.get(key);if(row)row.quantity-=Number(allocation.quantity||0);}}let allocations=requested;if(!allocations.length){let remaining=Number(returnQty||0);allocations=[];for(const row of available.values()){if(remaining<=0.000001)break;const take=mode==='Serial'?Math.min(1,remaining,Math.max(0,row.quantity)):Math.min(remaining,Math.max(0,row.quantity));if(take>0){allocations.push({traceNumber:traceNumber(row),quantity:take});remaining-=take;}}if(remaining>0.000001)throw new Error('Issued lot/serial history does not contain enough quantity to return.');}const normalized=allocations.map(raw=>({traceNumber:traceNumber(raw)||String(raw),quantity:mode==='Serial'?1:Number(raw.quantity??raw.qty??1)}));const requestedTotals=new Map();for(const row of normalized)requestedTotals.set(row.traceNumber,(requestedTotals.get(row.traceNumber)||0)+Number(row.quantity||0));for(const [number,quantity] of requestedTotals){if(quantity>(available.get(number)?.quantity||0)+0.000001)throw new Error(mode+' '+number+' was not issued to this production material line or has already been returned.');}const sum=normalized.reduce((total,row)=>total+Number(row.quantity||0),0);if(Math.abs(sum-Number(returnQty||0))>0.000001)throw new Error('Returned lot/serial allocation quantity must equal the material return quantity.');return normalized;}
  function completionReversalTrace(order,manufacturedItem,reverseQty,input={}){const mode=traceMode(manufacturedItem);if(mode==='None')return[];const available=new Map();for(const history of order.completionHistory||[]){for(const allocation of history.traceAllocations||[]){const key=traceNumber(allocation),row=available.get(key)||{...allocation,quantity:0};row.quantity+=Number(allocation.quantity||0);available.set(key,row);}}for(const reversal of order.completionReversals||[]){for(const allocation of reversal.traceAllocations||[]){const key=traceNumber(allocation),row=available.get(key);if(row)row.quantity-=Number(allocation.quantity||0);}}let allocations=input.lotSerialAllocations||input.traceAllocations||[];if(!allocations.length){let remaining=Number(reverseQty||0);allocations=[];for(const row of [...available.values()].reverse()){if(remaining<=0.000001)break;const take=mode==='Serial'?Math.min(1,remaining,Math.max(0,row.quantity)):Math.min(remaining,Math.max(0,row.quantity));if(take>0){allocations.push({traceNumber:traceNumber(row),quantity:take});remaining-=take;}}if(remaining>0.000001)throw new Error('Production completion history does not contain enough tracked quantity to reverse.');}const normalized=traceNormalize(manufacturedItem,reverseQty,allocations,{direction:'Issue',warehouse:order.outputWarehouse,location:order.outputLocation});for(const row of normalized){if(Number(row.quantity||0)>(available.get(traceNumber(row))?.quantity||0)+0.000001)throw new Error(mode+' '+traceNumber(row)+' was not produced by this production order or was already reversed.');}return normalized;}
  function manufacturingGenealogy(query={}){const itemId=String(query.itemId||''),number=String(query.traceNumber||query.lotSerialNumber||''),orderId=String(query.orderId||''),inventory=traceReport({itemId,traceNumber:number}),production=[];for(const order of orders){if(orderId&&order.id!==orderId)continue;const events=[];for(const line of order.materials||[]){for(const history of line.traceIssueHistory||[]){for(const allocation of history.traceAllocations||[]){if((!itemId||line.itemId===itemId)&&(!number||traceNumber(allocation)===number))events.push({event:'Component Issue',itemId:line.itemId,lineId:line.lineId,traceNumber:traceNumber(allocation),quantity:Number(allocation.quantity||0),timestamp:history.timestamp||'',user:history.user||''});}}for(const history of line.traceReturnHistory||[]){for(const allocation of history.traceAllocations||[]){if((!itemId||line.itemId===itemId)&&(!number||traceNumber(allocation)===number))events.push({event:'Component Return',itemId:line.itemId,lineId:line.lineId,traceNumber:traceNumber(allocation),quantity:Number(allocation.quantity||0),timestamp:history.timestamp||'',user:history.user||''});}}}for(const history of order.completionHistory||[]){for(const allocation of history.traceAllocations||[]){if((!itemId||order.itemId===itemId)&&(!number||traceNumber(allocation)===number))events.push({event:'Finished Goods Completion',itemId:order.itemId,traceNumber:traceNumber(allocation),quantity:Number(allocation.quantity||0),timestamp:history.createdAt||'',user:history.createdBy||''});}}for(const reversal of order.completionReversals||[]){for(const allocation of reversal.traceAllocations||[]){if((!itemId||order.itemId===itemId)&&(!number||traceNumber(allocation)===number))events.push({event:'Finished Goods Reversal',itemId:order.itemId,traceNumber:traceNumber(allocation),quantity:Number(allocation.quantity||0),timestamp:reversal.timestamp||'',user:reversal.user||''});}}if(events.length)production.push({orderId:order.id,itemId:order.itemId,bomRevision:order.bomRevision,routingRevision:order.routingRevision,sourceType:order.sourceType,sourceReference:order.sourceReference,events});}return{query:{itemId,traceNumber:number,orderId},balances:inventory.balances,inventoryTransactions:inventory.transactions,production};}`,
    'manufacturing trace helper integration'
  );

  source=replaceOnceOrAlready(
    source,
    "const journalLines=[],auditRows=[];for(const entry of issueList){",
    "for(const entry of issueList){const line=entry.line,req=requested?.find(row=>row.lineId?String(row.lineId)===String(line.lineId):String(row.itemId||row.inventoryId)===String(line.itemId));let allocations=req?.lotSerialAllocations||req?.traceAllocations||[];if(traceMode(item(line.itemId))!=='None'&&!allocations.length)allocations=traceSelect({itemId:line.itemId,quantity:entry.issueQty,warehouse:line.warehouse,location:line.location});entry.traceAllocations=traceNormalize(item(line.itemId),entry.issueQty,allocations,{direction:'Issue',warehouse:line.warehouse,location:line.location});}const journalLines=[],auditRows=[];for(const entry of issueList){",
    'material issue trace prevalidation'
  );
  source=replaceOnceOrAlready(source,'auditRows.push({line,issueQty,unitCost,amount});','auditRows.push({line,issueQty,unitCost,amount,traceAllocations:entry.traceAllocations||[]});','material issue trace audit preparation');
  source=replaceOnceOrAlready(
    source,
    "for(const row of auditRows)h.createInvAudit({transactionType:'Production Material Issue',referenceNumber:order.id,sourceModule:'Manufacturing',sourceReference:order.id,itemId:row.line.itemId,warehouse:row.line.warehouse,location:row.line.location,quantityOut:row.issueQty,unitCost:row.unitCost,postDate:nowDate(),postPeriod:h.periodFromDate(nowDate()),jeReference:jeRef,createdBy:user});",
    "for(const row of auditRows){if(traceMode(item(row.line.itemId))!=='None')traceIssue({itemId:row.line.itemId,warehouse:row.line.warehouse,location:row.line.location,quantity:row.issueQty,allocations:row.traceAllocations,sourceModule:'Manufacturing',sourceReference:order.id,transactionType:'Production Material Issue',postDate:nowDate(),user});h.createInvAudit({transactionType:'Production Material Issue',referenceNumber:order.id,sourceModule:'Manufacturing',sourceReference:order.id,itemId:row.line.itemId,warehouse:row.line.warehouse,location:row.line.location,quantityOut:row.issueQty,unitCost:row.unitCost,postDate:nowDate(),postPeriod:h.periodFromDate(nowDate()),jeReference:jeRef,traceAllocations:row.traceAllocations,createdBy:user});row.line.traceIssueHistory=row.line.traceIssueHistory||[];row.line.traceIssueHistory.push({quantity:row.issueQty,traceAllocations:(row.traceAllocations||[]).map(allocation=>({...allocation})),jeReference:jeRef,user,timestamp:new Date().toISOString()});}",
    'material issue trace posting'
  );

  source=replaceOnceOrAlready(
    source,
    "returns.push({line,returnQty,unitCost,amount});",
    "const traceAllocations=selectReturnedTrace(line,returnQty,request);returns.push({line,returnQty,unitCost,amount,traceAllocations});",
    'material return trace selection'
  );
  source=replaceOnceOrAlready(
    source,
    "h.createInvAudit({transactionType:'Production Material Return',referenceNumber:order.id,sourceModule:'Manufacturing',sourceReference:order.id,itemId:row.line.itemId,warehouse:row.line.warehouse,location:row.line.location,quantityIn:row.returnQty,unitCost:row.unitCost,postDate:nowDate(),postPeriod:period,jeReference:jeRef,createdBy:user});",
    "if(traceMode(item(row.line.itemId))!=='None')traceReceipt({itemId:row.line.itemId,warehouse:row.line.warehouse,location:row.line.location,quantity:row.returnQty,allocations:row.traceAllocations,sourceModule:'Manufacturing',sourceReference:order.id,transactionType:'Production Material Return',postDate:nowDate(),user,allowExistingSerial:true});h.createInvAudit({transactionType:'Production Material Return',referenceNumber:order.id,sourceModule:'Manufacturing',sourceReference:order.id,itemId:row.line.itemId,warehouse:row.line.warehouse,location:row.line.location,quantityIn:row.returnQty,unitCost:row.unitCost,postDate:nowDate(),postPeriod:period,jeReference:jeRef,traceAllocations:row.traceAllocations,createdBy:user});row.line.traceReturnHistory=row.line.traceReturnHistory||[];row.line.traceReturnHistory.push({quantity:row.returnQty,traceAllocations:(row.traceAllocations||[]).map(allocation=>({...allocation})),jeReference:jeRef,user,timestamp:new Date().toISOString()});",
    'material return trace posting'
  );

  source=replaceOnceOrAlready(
    source,
    "const manufacturedItem=item(order.itemId),fgAccount=manufacturedItem?.manufacturingInventoryAccount||settings.finishedGoodsAccount,completionPeriod=h.periodFromDate(nowDate());",
    "const manufacturedItem=item(order.itemId),fgAccount=manufacturedItem?.manufacturingInventoryAccount||settings.finishedGoodsAccount,completionPeriod=h.periodFromDate(nowDate());let outputTraceAllocations=input.lotSerialAllocations||input.traceAllocations||[];if(traceMode(manufacturedItem)!=='None')outputTraceAllocations=traceNormalize(manufacturedItem,completed,outputTraceAllocations,{direction:'Receipt',warehouse:order.outputWarehouse,location:order.outputLocation,allowExistingSerial:false});",
    'finished goods trace prevalidation'
  );
  source=replaceOnceOrAlready(
    source,
    "h.adjustInventoryBalance({itemId:order.itemId,warehouse:order.outputWarehouse,location:order.outputLocation,qtyIn:completed,unitCost});h.createInvAudit({transactionType:'Production Receipt',referenceNumber:order.id,sourceModule:'Manufacturing',sourceReference:order.id,itemId:order.itemId,warehouse:order.outputWarehouse,location:order.outputLocation,quantityIn:completed,unitCost,postDate:nowDate(),postPeriod:period,jeReference:jeRef,createdBy:user});",
    "h.adjustInventoryBalance({itemId:order.itemId,warehouse:order.outputWarehouse,location:order.outputLocation,qtyIn:completed,unitCost});if(traceMode(manufacturedItem)!=='None')traceReceipt({itemId:order.itemId,warehouse:order.outputWarehouse,location:order.outputLocation,quantity:completed,allocations:outputTraceAllocations,sourceModule:'Manufacturing',sourceReference:order.id,transactionType:'Production Receipt',postDate:nowDate(),user,allowExistingSerial:false});h.createInvAudit({transactionType:'Production Receipt',referenceNumber:order.id,sourceModule:'Manufacturing',sourceReference:order.id,itemId:order.itemId,warehouse:order.outputWarehouse,location:order.outputLocation,quantityIn:completed,unitCost,postDate:nowDate(),postPeriod:period,jeReference:jeRef,traceAllocations:outputTraceAllocations,createdBy:user});",
    'finished goods trace receipt'
  );
  source=replaceOnceOrAlready(
    source,
    "reversedValue:0,createdBy:user,createdAt:new Date().toISOString()",
    "reversedValue:0,traceAllocations:(outputTraceAllocations||[]).map(allocation=>({...allocation})),createdBy:user,createdAt:new Date().toISOString()",
    'completion history trace identity'
  );

  source=replaceOnceOrAlready(
    source,
    "const fgBalance=h.getBalance(order.itemId,order.outputWarehouse,order.outputLocation),availableFg=Math.max(0,Number(h.qtyAvail(fgBalance)||0));",
    "const manufacturedItem=item(order.itemId),reversalTraceAllocations=completionReversalTrace(order,manufacturedItem,reverseQty,input),fgBalance=h.getBalance(order.itemId,order.outputWarehouse,order.outputLocation),availableFg=Math.max(0,Number(h.qtyAvail(fgBalance)||0));",
    'completion reversal trace selection'
  );
  source=replaceOnceOrAlready(
    source,
    "h.adjustInventoryBalance({itemId:order.itemId,warehouse:order.outputWarehouse,location:order.outputLocation,qtyOut:reverseQty,unitCost:money(reverseValue/reverseQty)});h.createInvAudit({transactionType:'Production Receipt Reversal',referenceNumber:order.id,sourceModule:'Manufacturing',sourceReference:order.id,itemId:order.itemId,warehouse:order.outputWarehouse,location:order.outputLocation,quantityOut:reverseQty,unitCost:money(reverseValue/reverseQty),postDate:nowDate(),postPeriod:period,jeReference:jeRef,createdBy:user,reason});",
    "h.adjustInventoryBalance({itemId:order.itemId,warehouse:order.outputWarehouse,location:order.outputLocation,qtyOut:reverseQty,unitCost:money(reverseValue/reverseQty)});if(traceMode(manufacturedItem)!=='None')traceIssue({itemId:order.itemId,warehouse:order.outputWarehouse,location:order.outputLocation,quantity:reverseQty,allocations:reversalTraceAllocations,sourceModule:'Manufacturing',sourceReference:order.id,transactionType:'Production Receipt Reversal',postDate:nowDate(),user});h.createInvAudit({transactionType:'Production Receipt Reversal',referenceNumber:order.id,sourceModule:'Manufacturing',sourceReference:order.id,itemId:order.itemId,warehouse:order.outputWarehouse,location:order.outputLocation,quantityOut:reverseQty,unitCost:money(reverseValue/reverseQty),postDate:nowDate(),postPeriod:period,jeReference:jeRef,traceAllocations:reversalTraceAllocations,createdBy:user,reason});",
    'completion reversal trace posting'
  );
  source=replaceOnceOrAlready(
    source,
    "reason,jeReference:jeRef,user,timestamp:new Date().toISOString()});",
    "reason,jeReference:jeRef,traceAllocations:(reversalTraceAllocations||[]).map(allocation=>({...allocation})),user,timestamp:new Date().toISOString()});",
    'completion reversal trace history'
  );

  source=replaceOnceOrAlready(
    source,
    "if(method==='GET'&&pathname==='/api/manufacturing/cost-rollup')",
    "if(method==='GET'&&pathname==='/api/manufacturing/genealogy')return{status:200,body:manufacturingGenealogy(query)};if(method==='GET'&&pathname==='/api/manufacturing/cost-rollup')",
    'manufacturing genealogy endpoint'
  );

  source=replaceOnceOrAlready(
    source,
    "hasRouting:!!effectiveRouting(row.code)})),serviceItems:",
    "hasRouting:!!effectiveRouting(row.code),lotSerialTracking:row.lotSerialTracking||row.trackingMode||'None'})),serviceItems:",
    'tracking mode reference data'
  );
  return source;
}

export function applyManufacturingAgent3TraceabilityClientPatch(source){
  source=replaceOnceOrAlready(
    source,
    "function serviceItemOptions({withBlank=true}={}){",
    "function parseMfgTraceAllocations(value,mode,quantity){const text=String(value||'').trim();if(!text)return[];const tokens=text.split(',').map(v=>v.trim()).filter(Boolean);if(String(mode)==='Lot'){if(tokens.length===1&&!tokens[0].includes(':'))return[{traceNumber:tokens[0],quantity:Number(quantity||0)}];return tokens.map(token=>{const parts=token.split(':');return{traceNumber:parts[0].trim(),quantity:Number(parts[1]||0)};});}return tokens.map(traceNumber=>({traceNumber,quantity:1}));}\nfunction serviceItemOptions({withBlank=true}={}){",
    'trace allocation client parser'
  );

  source=replaceOnceOrAlready(
    source,
    "${field('Scrap Qty','mfgCompleteScrap',{type:'number',value:0,step:'0.01',min:0})}</div>${button('Report Completion'",
    "${field('Scrap Qty','mfgCompleteScrap',{type:'number',value:0,step:'0.01',min:0})}${field('FG Lot / Serial Numbers','mfgCompleteTrace',{placeholder:'Lot: LOT-001 or serials: SN-001, SN-002'})}</div>${button('Report Completion'",
    'finished goods trace input'
  );
  source=replaceOnceOrAlready(
    source,
    "document.getElementById('mfgCompleteOrder')?.addEventListener('click',()=>action('complete',{quantity:Number(document.getElementById('mfgCompleteQty').value),scrapQty:Number(document.getElementById('mfgCompleteScrap').value)}));",
    "document.getElementById('mfgCompleteOrder')?.addEventListener('click',()=>{const quantity=Number(document.getElementById('mfgCompleteQty').value),itemRow=(referenceData?.items||[]).find(row=>row.id===order.itemId),mode=itemRow?.lotSerialTracking||'None';action('complete',{quantity,scrapQty:Number(document.getElementById('mfgCompleteScrap').value),traceAllocations:parseMfgTraceAllocations(document.getElementById('mfgCompleteTrace').value,mode,quantity)});});",
    'finished goods trace completion action'
  );

  source=replaceOnceOrAlready(
    source,
    "${field('Reason','mfgReverseCompletionReason',{placeholder:'Incorrect completion, inspection correction...'})}</div>${button('Reverse Completion'",
    "${field('Reason','mfgReverseCompletionReason',{placeholder:'Incorrect completion, inspection correction...'})}${field('Lot / Serial to Reverse','mfgReverseCompletionTrace',{placeholder:'Optional; blank uses produced trace history'})}</div>${button('Reverse Completion'",
    'completion reversal trace input'
  );
  source=replaceOnceOrAlready(
    source,
    "action('reverse-completion',{quantity:Number(document.getElementById('mfgReverseCompletionQty').value),reason:document.getElementById('mfgReverseCompletionReason').value});",
    "{const quantity=Number(document.getElementById('mfgReverseCompletionQty').value),itemRow=(referenceData?.items||[]).find(row=>row.id===order.itemId),mode=itemRow?.lotSerialTracking||'None';action('reverse-completion',{quantity,reason:document.getElementById('mfgReverseCompletionReason').value,traceAllocations:parseMfgTraceAllocations(document.getElementById('mfgReverseCompletionTrace').value,mode,quantity)});}",
    'completion reversal trace action'
  );

  source=replaceOnceOrAlready(
    source,
    "['Reports',[['/manufacturing/reports/wip','WIP Report'],",
    "['Reports',[['/manufacturing/genealogy','Lot / Serial Genealogy'],['/manufacturing/reports/wip','WIP Report'],",
    'genealogy navigation'
  );
  source=replaceOnceOrAlready(
    source,
    "async function costRollupPage(){",
    `async function genealogyPage(){setTitle('Lot / Serial Genealogy');await loadReference();document.getElementById('view').innerHTML=section('Trace Lot / Serial',\`<div class='mfg-form-grid'>\${field('Item','mfgGenealogyItem',{options:[{value:'',label:'All items'},...itemOptions({withBlank:false})]})}\${field('Lot / Serial Number','mfgGenealogyTrace',{placeholder:'LOT-001 or SN-001'})}\${field('Production Order','mfgGenealogyOrder',{placeholder:'Optional MO number'})}</div><div class='mfg-actions'>\${button('Trace',{id:'mfgGenealogyRun',kind:'primary'})}</div><div id='mfgGenealogyResult' class='mfg-muted'>Search by item, lot/serial number, production order, or a combination.</div>\`);document.getElementById('mfgGenealogyRun').onclick=async()=>{try{const params=new URLSearchParams(),itemId=document.getElementById('mfgGenealogyItem').value,traceNumber=document.getElementById('mfgGenealogyTrace').value,orderId=document.getElementById('mfgGenealogyOrder').value;if(itemId)params.set('itemId',itemId);if(traceNumber)params.set('traceNumber',traceNumber);if(orderId)params.set('orderId',orderId);const result=await api('/api/manufacturing/genealogy?'+params.toString()),events=result.production.flatMap(row=>row.events.map(event=>({...event,orderId:row.orderId,bomRevision:row.bomRevision,routingRevision:row.routingRevision})));document.getElementById('mfgGenealogyResult').innerHTML=\`\${section('Trace Balances',table(result.balances||[],[{label:'Item',key:'itemId'},{label:'Mode',key:'trackingMode'},{label:'Lot / Serial',key:'traceNumber'},{label:'Warehouse',key:'warehouse'},{label:'Location',key:'location'},{label:'On Hand',key:'qtyOnHand'},{label:'Status',render:r=>badge(r.status)}],'No on-hand trace balances.'))}\${section('Inventory Movement History',table(result.inventoryTransactions||[],[{label:'Event',key:'transactionType'},{label:'Item',key:'itemId'},{label:'Lot / Serial',key:'traceNumber'},{label:'In',key:'quantityIn'},{label:'Out',key:'quantityOut'},{label:'Source',render:r=>\`\${esc(r.sourceModule)} \${esc(r.sourceReference)}\`},{label:'Date',key:'postDate'}],'No inventory trace events.'))}\${section('Production Where-Used / Where-From',table(events,[{label:'Order',key:'orderId'},{label:'Event',key:'event'},{label:'Item',key:'itemId'},{label:'Lot / Serial',key:'traceNumber'},{label:'Qty',key:'quantity'},{label:'BOM Rev',key:'bomRevision'},{label:'Routing Rev',key:'routingRevision'},{label:'Time',key:'timestamp'}],'No production genealogy events.'))}\`;}catch(e){showError(e);}};}

async function costRollupPage(){`,
    'genealogy page'
  );
  source=replaceOnceOrAlready(
    source,
    "if(path==='/manufacturing/reports/wip')return await reportPage('wip');",
    "if(path==='/manufacturing/genealogy')return await genealogyPage();if(path==='/manufacturing/reports/wip')return await reportPage('wip');",
    'genealogy client route'
  );
  return source;
}

export async function prepareManufacturingAgent3TraceabilityRuntime(inputModule='./.manufacturingRuntime-agent3.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyManufacturingAgent3TraceabilityRuntimePatch(source);
  await writeFile(runtimePath,patched,'utf8');
  return './.manufacturingRuntime-agent3.js';
}

export async function patchManufacturingAgent3TraceabilityUiFile(){
  const source=await readFile(clientPath,'utf8');
  const patched=applyManufacturingAgent3TraceabilityClientPatch(source);
  if(patched!==source)await writeFile(clientPath,patched,'utf8');
  return clientPath;
}
