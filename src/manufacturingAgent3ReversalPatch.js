import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const runtimePath=path.join(here,'.manufacturingRuntime-agent3.js');
const clientPath=path.join(here,'../public/manufacturingModule.js');

function replaceOnceOrAlready(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`Agent 3 manufacturing reversal patch failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Agent 3 manufacturing reversal patch failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyManufacturingAgent3ReversalRuntimePatch(source){
  source=replaceOnceOrAlready(
    source,
    "order.costs.finishedGoods=money(Number(order.costs.finishedGoods||0)+receiptValue);order.qtyCompleted=qty(Number(order.qtyCompleted||0)+completed);",
    "order.costs.finishedGoods=money(Number(order.costs.finishedGoods||0)+receiptValue);order.qtyCompleted=qty(Number(order.qtyCompleted||0)+completed);order.completionHistory=order.completionHistory||[];order.completionHistory.push({id:'COMP-'+String(order.completionHistory.length+1).padStart(4,'0'),quantity:qty(completed),value:receiptValue,unitCost,jeReference:jeRef,postDate:nowDate(),reversedQuantity:0,reversedValue:0,createdBy:user,createdAt:new Date().toISOString()});",
    'finished goods completion history'
  );

  source=replaceOnceOrAlready(
    source,
    "if(order.status!=='Completed')throw new Error('Only completed production orders can be closed.');releaseReservations(order);const residual=money(wipAdded(order)-wipRelieved(order));if(Math.abs(residual)>=0.01){",
    "if(order.status!=='Completed')throw new Error('Only completed production orders can be closed.');releaseReservations(order);const residual=money(wipAdded(order)-wipRelieved(order));let closeJeReference='';if(Math.abs(residual)>=0.01){",
    'close variance journal reference setup'
  );

  source=replaceOnceOrAlready(
    source,
    "postJournal(order,`Manufacturing close ${order.id}`,lines,user);order.costs.variance=money(Number(order.costs.variance||0)+residual);}",
    "closeJeReference=postJournal(order,`Manufacturing close ${order.id}`,lines,user);order.costs.variance=money(Number(order.costs.variance||0)+residual);}",
    'capture close variance journal'
  );

  source=replaceOnceOrAlready(
    source,
    "order.status='Closed';order.closedAt=new Date().toISOString();order.updatedAt=order.closedAt;audit('Production Order',order.id,'Closed',`Residual WIP variance ${money(residual)}.`,user);return order;",
    "order.closeHistory=order.closeHistory||[];order.closeHistory.push({id:'CLOSE-'+String(order.closeHistory.length+1).padStart(4,'0'),residual,jeReference:closeJeReference,closedBy:user,closedAt:new Date().toISOString(),reopenedAt:'',reopenedBy:'',reopenReason:'',reversalJeReference:''});order.status='Closed';order.closedAt=order.closeHistory.at(-1).closedAt;order.updatedAt=order.closedAt;audit('Production Order',order.id,'Closed',`Residual WIP variance ${money(residual)}.`,user);return order;",
    'close history tracking'
  );

  source=replaceOnceOrAlready(
    source,
    "  function cancelOrder(order,user='system'){",
    `  function reopenOrder(order,input={},user='system'){
    if(order.status!=='Closed')throw new Error('Only closed production orders can be reopened.');const reason=String(input.reason||'').trim();if(!reason)throw new Error('A reopen reason is required.');const closeRow=(order.closeHistory||[]).slice().reverse().find(row=>!row.reopenedAt);if(!closeRow)throw new Error('The production close history required for reopening was not found.');const residual=money(Number(closeRow.residual||0));let reversalJeReference='';if(Math.abs(residual)>=0.01){const amount=Math.abs(residual),lines=residual>0?[{account:settings.wipAccount,debit:amount,credit:0,description:'Reopen WIP '+order.id,sourceReference:order.id},{account:settings.scrapVarianceAccount,debit:0,credit:amount,description:'Reverse close variance '+order.id,sourceReference:order.id}]:[{account:settings.scrapVarianceAccount,debit:amount,credit:0,description:'Reverse close variance '+order.id,sourceReference:order.id},{account:settings.wipAccount,debit:0,credit:amount,description:'Reopen WIP '+order.id,sourceReference:order.id}];reversalJeReference=postJournal(order,'Manufacturing reopen '+order.id,lines,user);order.costs.variance=money(Number(order.costs.variance||0)-residual);}closeRow.reopenedAt=new Date().toISOString();closeRow.reopenedBy=user;closeRow.reopenReason=reason;closeRow.reversalJeReference=reversalJeReference;order.status='Completed';order.closedAt='';order.updatedAt=new Date().toISOString();audit('Production Order',order.id,'Reopened','Reason: '+reason+'. Close variance reversed: '+residual+'.',user);return order;
  }
  function reverseCompletion(order,input={},user='system'){
    if(order.status==='Closed')throw new Error('Reopen the production order before reversing a completion.');if(!['Completed','In Process'].includes(order.status))throw new Error('Completion reversal is allowed only for completed or in-process production orders.');const reason=String(input.reason||'').trim();if(!reason)throw new Error('A completion reversal reason is required.');const reverseQty=qty(assertPositive(input.quantity??input.qty??0,'Completion reversal quantity'));if(reverseQty>Number(order.qtyCompleted||0)+0.000001)throw new Error('Completion reversal quantity exceeds the completed production quantity.');const history=(order.completionHistory||[]).slice().reverse(),allocations=[];let remaining=reverseQty;for(const row of history){const available=Math.max(0,Number(row.quantity||0)-Number(row.reversedQuantity||0));if(available<=0||remaining<=0)continue;const take=Math.min(available,remaining),openValue=Math.max(0,Number(row.value||0)-Number(row.reversedValue||0)),value=money(available>0?openValue*(take/available):0);allocations.push({row,quantity:qty(take),value});remaining=qty(remaining-take);}if(remaining>0.000001)throw new Error('Completion history does not contain enough unreversed quantity.');const fgBalance=h.getBalance(order.itemId,order.outputWarehouse,order.outputLocation),availableFg=Math.max(0,Number(h.qtyAvail(fgBalance)||0));if(availableFg+0.000001<reverseQty)throw new Error('Finished goods are no longer available in the production output location. Reverse downstream allocations, transfers, or shipments first.');const reverseValue=money(allocations.reduce((sum,row)=>sum+Number(row.value||0),0));if(reverseValue<=0)throw new Error('Completion reversal value must be greater than zero.');const manufacturedItem=item(order.itemId),fgAccount=manufacturedItem?.manufacturingInventoryAccount||settings.finishedGoodsAccount,period=h.periodFromDate(nowDate());h.validatePeriodOpen('Manufacturing',period);h.validateInventoryAndGlOpen(period);h.requireAccount(fgAccount,'Manufacturing finished goods account');h.requireAccount(settings.wipAccount,'Manufacturing WIP account');const jeRef=postJournal(order,'Manufacturing completion reversal '+order.id,[{account:settings.wipAccount,debit:reverseValue,credit:0,description:'Restore WIP '+order.id,sourceReference:order.id},{account:fgAccount,debit:0,credit:reverseValue,description:'Reverse finished goods '+order.itemId,sourceReference:order.id}],user);h.adjustInventoryBalance({itemId:order.itemId,warehouse:order.outputWarehouse,location:order.outputLocation,qtyOut:reverseQty,unitCost:money(reverseValue/reverseQty)});h.createInvAudit({transactionType:'Production Receipt Reversal',referenceNumber:order.id,sourceModule:'Manufacturing',sourceReference:order.id,itemId:order.itemId,warehouse:order.outputWarehouse,location:order.outputLocation,quantityOut:reverseQty,unitCost:money(reverseValue/reverseQty),postDate:nowDate(),postPeriod:period,jeReference:jeRef,createdBy:user,reason});for(const allocation of allocations){allocation.row.reversedQuantity=qty(Number(allocation.row.reversedQuantity||0)+allocation.quantity);allocation.row.reversedValue=money(Number(allocation.row.reversedValue||0)+allocation.value);allocation.row.lastReversalJeReference=jeRef;allocation.row.lastReversalReason=reason;}order.costs.finishedGoods=money(Math.max(0,Number(order.costs.finishedGoods||0)-reverseValue));order.qtyCompleted=qty(Math.max(0,Number(order.qtyCompleted||0)-reverseQty));const finished=Number(order.qtyCompleted||0)+Number(order.qtyScrapped||0)+0.000001>=Number(order.quantity||0);order.status=finished?'Completed':'In Process';if(!finished)order.completedAt='';order.updatedAt=new Date().toISOString();order.completionReversals=order.completionReversals||[];order.completionReversals.push({id:'REVCOMP-'+String(order.completionReversals.length+1).padStart(4,'0'),quantity:reverseQty,value:reverseValue,reason,jeReference:jeRef,user,timestamp:new Date().toISOString()});audit('Production Order',order.id,'Completion Reversed',reverseQty+' finished unit(s) reversed for '+reverseValue+'. Reason: '+reason,user);return order;
  }
  function cancelOrder(order,user='system'){`,
    'production reopen and completion reversal workflows'
  );

  source=replaceOnceOrAlready(
    source,
    "(?:\\/(release|issue-materials|return-materials|substitute-material|create-subcontract-po|report-operation|complete|close|cancel))?$/",
    "(?:\\/(release|issue-materials|return-materials|substitute-material|create-subcontract-po|report-operation|complete|reverse-completion|close|reopen|cancel))?$/",
    'reversal production routes'
  );

  source=replaceOnceOrAlready(
    source,
    "else if(action==='report-operation')reportOperation(order,input,actor);else if(action==='complete')completeOrder(order,input,actor);else if(action==='close')closeOrder(order,actor);else if(action==='cancel')cancelOrder(order,actor);",
    "else if(action==='report-operation')reportOperation(order,input,actor);else if(action==='complete')completeOrder(order,input,actor);else if(action==='reverse-completion')reverseCompletion(order,input,actor);else if(action==='close')closeOrder(order,actor);else if(action==='reopen')reopenOrder(order,input,actor);else if(action==='cancel')cancelOrder(order,actor);",
    'reversal production actions'
  );
  return source;
}

export function applyManufacturingAgent3ReversalClientPatch(source){
  source=replaceOnceOrAlready(
    source,
    "<div class='mfg-action-card'><h4>Close</h4><p>Clear residual WIP to production variance and lock the production order.</p>${button('Close Order',{id:'mfgCloseOrder',disabled:order.status!=='Completed'})}</div>",
    "<div class='mfg-action-card'><h4>Reverse Completion</h4><p>Use only to correct a posted finished-goods receipt. Closed orders must be reopened first.</p><div class='mfg-mini-grid'>${field('Qty to Reverse','mfgReverseCompletionQty',{type:'number',value:Math.max(0,Number(order.qtyCompleted||0)),step:'0.01',min:0})}${field('Reason','mfgReverseCompletionReason',{placeholder:'Incorrect completion, inspection correction...'})}</div>${button('Reverse Completion',{id:'mfgReverseCompletion',kind:'danger',disabled:order.status==='Closed'||!['Completed','In Process'].includes(order.status)||Number(order.qtyCompleted||0)<=0})}</div><div class='mfg-action-card'><h4>Close</h4><p>Clear residual WIP to production variance and lock the production order.</p>${button('Close Order',{id:'mfgCloseOrder',disabled:order.status!=='Completed'})}</div><div class='mfg-action-card'><h4>Reopen Closed Order</h4><p>Reverses the close-variance entry and restores WIP. A reason is mandatory.</p>${field('Reopen Reason','mfgReopenReason',{placeholder:'Authorized correction reason...'})}${button('Reopen Order',{id:'mfgReopenOrder',disabled:order.status!=='Closed'})}</div>",
    'production reversal action cards'
  );

  source=replaceOnceOrAlready(
    source,
    "document.getElementById('mfgCompleteOrder')?.addEventListener('click',()=>action('complete',{quantity:Number(document.getElementById('mfgCompleteQty').value),scrapQty:Number(document.getElementById('mfgCompleteScrap').value)}));",
    "document.getElementById('mfgCompleteOrder')?.addEventListener('click',()=>action('complete',{quantity:Number(document.getElementById('mfgCompleteQty').value),scrapQty:Number(document.getElementById('mfgCompleteScrap').value)}));\n  document.getElementById('mfgReverseCompletion')?.addEventListener('click',()=>{if(confirm('Reverse this posted finished-goods completion?'))action('reverse-completion',{quantity:Number(document.getElementById('mfgReverseCompletionQty').value),reason:document.getElementById('mfgReverseCompletionReason').value});});",
    'completion reversal client action'
  );

  source=replaceOnceOrAlready(
    source,
    "document.getElementById('mfgCloseOrder')?.addEventListener('click',()=>action('close'));",
    "document.getElementById('mfgCloseOrder')?.addEventListener('click',()=>action('close'));\n  document.getElementById('mfgReopenOrder')?.addEventListener('click',()=>{if(confirm('Reopen this closed production order and reverse its close variance?'))action('reopen',{reason:document.getElementById('mfgReopenReason').value});});",
    'production reopen client action'
  );
  return source;
}

export async function prepareManufacturingAgent3ReversalRuntime(inputModule='./.manufacturingRuntime-agent3.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyManufacturingAgent3ReversalRuntimePatch(source);
  await writeFile(runtimePath,patched,'utf8');
  return './.manufacturingRuntime-agent3.js';
}

export async function patchManufacturingAgent3ReversalUiFile(){
  const source=await readFile(clientPath,'utf8');
  const patched=applyManufacturingAgent3ReversalClientPatch(source);
  if(patched!==source)await writeFile(clientPath,patched,'utf8');
  return clientPath;
}
