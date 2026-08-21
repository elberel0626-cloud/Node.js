import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const reviewedRuntimePath=path.join(here,'.manufacturingRuntime-agent3.js');

function replaceOnceOrAlready(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`Agent 3 manufacturing advanced patch failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Agent 3 manufacturing advanced patch failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyManufacturingAgent3AdvancedPatch(source){
  source=replaceOnceOrAlready(
    source,
    "const itemMaster=context.itemMaster||[],inventoryBalances=context.inventoryBalances||[],inventoryTransactions=context.inventoryTransactions||[],purchaseOrders=context.purchaseOrders||[],purchaseOrderLines=context.purchaseOrderLines||[],vendors=context.vendors||[],salesOrders=context.salesOrders||[],salesOrderLines=context.salesOrderLines||[],warehouses=context.warehouses||[],inventoryLocations=context.inventoryLocations||[];",
    "const itemMaster=context.itemMaster||[],inventoryBalances=context.inventoryBalances||[],inventoryTransactions=context.inventoryTransactions||[],purchaseOrders=context.purchaseOrders||[],purchaseOrderLines=context.purchaseOrderLines||[],purchaseReceiptLines=context.purchaseReceiptLines||[],journalEntries=context.journalEntries||[],vendors=context.vendors||[],salesOrders=context.salesOrders||[],salesOrderLines=context.salesOrderLines||[],warehouses=context.warehouses||[],inventoryLocations=context.inventoryLocations||[];",
    'advanced accounting context'
  );

  source=replaceOnceOrAlready(
    source,
    "qualityCheckpoint:op.qualityCheckpoint===true",
    "qualityCheckpoint:op.qualityCheckpoint===true,outsideProcessing:op.outsideProcessing===true,vendorId:op.vendorId||'',serviceItemId:op.serviceItemId||'',outsideUnitCost:Math.max(0,Number(op.outsideUnitCost||0))",
    'routing outside-processing fields'
  );

  source=replaceOnceOrAlready(
    source,
    "function materialRequirements(bom,productionQty){\n    const yieldFactor=Math.max(0.000001,Number(bom.yieldPct||100)/100);return (bom.components||[]).map(line=>{const required=Number(productionQty)*Number(line.qtyPer||0)/Number(bom.baseQty||1)/yieldFactor*(1+Number(line.scrapPct||0)/100);return{lineId:line.lineId,itemId:line.itemId,description:line.description,requiredQty:qty(required),qtyReserved:0,qtyIssued:0,shortageQty:0,uom:line.uom,supplyType:line.supplyType,issueMethod:line.issueMethod,warehouse:line.warehouse,location:line.location,unitCost:money(h.itemCost(item(line.itemId))),extendedRequiredCost:money(required*h.itemCost(item(line.itemId)))};});\n  }",
    `function materialRequirements(bom,productionQty,stack=[]){
    if(stack.includes(bom.itemId))throw new Error('Phantom BOM circular reference detected: '+[...stack,bom.itemId].join(' -> '));const yieldFactor=Math.max(0.000001,Number(bom.yieldPct||100)/100),rows=[];
    for(const line of bom.components||[]){const required=Number(productionQty)*Number(line.qtyPer||0)/Number(bom.baseQty||1)/yieldFactor*(1+Number(line.scrapPct||0)/100);if(line.supplyType==='Phantom'){const phantom=effectiveBom(line.itemId,nowDate());if(!phantom)throw new Error('Phantom component '+line.itemId+' requires an active BOM.');for(const child of materialRequirements(phantom,required,[...stack,bom.itemId]))rows.push({...child,lineId:String(line.lineId)+'>'+String(child.lineId),phantomParent:line.itemId});continue;}rows.push({lineId:line.lineId,itemId:line.itemId,description:line.description,requiredQty:qty(required),qtyReserved:0,qtyIssued:0,shortageQty:0,uom:line.uom,supplyType:line.supplyType,issueMethod:line.issueMethod,warehouse:line.warehouse,location:line.location,unitCost:money(h.itemCost(item(line.itemId))),extendedRequiredCost:money(required*h.itemCost(item(line.itemId)))});}return rows;
  }`,
    'phantom BOM explosion'
  );

  source=replaceOnceOrAlready(
    source,
    "function operationCost(op,input){",
    `function outsideProcessingLines(order){return purchaseOrderLines.filter(line=>line.outsideProcessing===true&&String(line.sourceProductionOrder||'')===String(order.id));}
  function outsideProcessingReceivedCost(order){return money(outsideProcessingLines(order).reduce((sum,line)=>sum+Math.max(0,Number(line.qtyReceived||0))*Math.max(0,Number(line.unitCost||0)),0));}
  function outsideProcessingReceiptRefs(order){const poLineIds=new Set(outsideProcessingLines(order).map(line=>String(line.id)));return new Set(purchaseReceiptLines.filter(line=>poLineIds.has(String(line.poLineId||line.id))).map(line=>String(line.receiptId||'')));}
  function createSubcontractPo(order,input={},user='system'){
    if(!['Planned','Released','Material Shortage','In Process'].includes(order.status))throw new Error('Subcontract purchase orders can be created only for active production orders.');const sequence=Number(input.sequence),op=(order.operations||[]).find(row=>Number(row.sequence)===sequence);if(!op)throw new Error('Production operation was not found.');if(!op.outsideProcessing)throw new Error('The selected routing operation is not configured for outside processing.');if(op.subcontractPoId&&purchaseOrders.some(po=>po.id===op.subcontractPoId&&!['Cancelled','Voided'].includes(po.status)))throw new Error('A subcontract purchase order already exists for this operation.');const vendorId=input.vendorId||op.vendorId,vendor=vendors.find(row=>String(row.id)===String(vendorId)&&row.status!=='Inactive');if(!vendor)throw new Error('An active subcontract vendor is required.');const serviceItemId=input.serviceItemId||op.serviceItemId,serviceItem=item(serviceItemId);if(!serviceItem)throw new Error('A non-stock service item is required for outside processing.');if(serviceItem.trackQuantity!==false&&['Stock Item','Inventory'].includes(serviceItem.type))throw new Error('Outside processing must use a non-stock or service item so the PO receipt capitalizes cost to WIP instead of inventory.');const quantity=qty(assertPositive(input.quantity??order.quantity,'Subcontract quantity')),unitCost=money(Number(input.unitCost??op.outsideUnitCost??h.itemCost(serviceItem)||0));if(unitCost<=0)throw new Error('Outside-processing unit cost must be greater than zero.');const poId=h.nextPoId('PO',purchaseOrders),today=nowDate(),po={id:poId,poNumber:poId,poType:'SV',status:'Saved',orderDate:today,requestedDate:input.requestedDate||order.dueDate,promisedDate:'',postDate:today,postPeriod:h.periodFromDate(today),vendorId:vendor.id,vendorName:vendor.name,vendorLocation:'MAIN',branch:input.branch||'100',warehouse:order.wipWarehouse,currency:vendor.currency||'USD',terms:vendor.terms||'NET30',buyer:input.buyer||'BUYER-01',shipVia:'Best Way',fobPoint:'Destination',vendorRef:'',description:'Outside processing '+order.id+' operation '+sequence,freight:0,prepaymentRequired:0,sourceManufacturingOrder:order.id,sourceOperationSequence:sequence};const line=h.calcPoLine({inventoryId:serviceItemId,qtyOrdered:quantity,unitCost,warehouse:order.wipWarehouse,location:order.wipLocation,requestedDate:po.requestedDate,expenseAccount:settings.wipAccount},0,poId);line.expenseAccount=settings.wipAccount;line.sourceProductionOrder=order.id;line.sourceOperationSequence=sequence;line.outsideProcessing=true;purchaseOrders.push(po);purchaseOrderLines.push(line);h.recalcPo(po);op.subcontractPoId=poId;op.vendorId=vendor.id;op.serviceItemId=serviceItemId;op.outsideUnitCost=unitCost;audit('Production Order',order.id,'Subcontract PO Created','Operation '+sequence+' linked to '+poId+'.',user);return{productionOrder:order,purchaseOrder:po,purchaseOrderLine:line};
  }
  function operationCost(op,input){`,
    'outside processing functions'
  );

  source=replaceOnceOrAlready(
    source,
    "if(wc?.isDown)throw new Error(`${wc.name||wc.id} is down for maintenance.`);const c=operationCost(op,input),total=money(c.laborCost+c.machineCost+c.overheadCost);",
    "if(wc?.isDown)throw new Error(`${wc.name||wc.id} is down for maintenance.`);if(op.outsideProcessing){const linked=outsideProcessingLines(order).filter(line=>Number(line.sourceOperationSequence)===sequence),received=qty(linked.reduce((sum,line)=>sum+Number(line.qtyReceived||0),0));if(!linked.length)throw new Error('Create the subcontract purchase order before completing this outside operation.');if(received+0.000001<Number(order.quantity||0))throw new Error('Outside operation cannot be completed until the subcontract PO receipt is posted. Received '+received+' of '+order.quantity+'.');op.qtyGood=qty(Math.max(Number(op.qtyGood||0),Math.min(Number(order.quantity||0),received)));op.status='Completed';if(!op.startedAt)op.startedAt=new Date().toISOString();op.completedAt=new Date().toISOString();order.status='In Process';order.updatedAt=new Date().toISOString();audit('Production Order',order.id,'Outside Operation Completed','Operation '+sequence+' completed from subcontract receipt.',user);return order;}const c=operationCost(op,input),total=money(c.laborCost+c.machineCost+c.overheadCost);",
    'outside operation receipt gate'
  );

  source=replaceOnceOrAlready(
    source,
    "function wipAdded(order){return money(Number(order.costs.material||0)+Number(order.costs.labor||0)+Number(order.costs.machine||0)+Number(order.costs.overhead||0));}",
    "function wipAdded(order){return money(Number(order.costs.material||0)+Number(order.costs.labor||0)+Number(order.costs.machine||0)+Number(order.costs.overhead||0)+outsideProcessingReceivedCost(order));}",
    'subcontract cost in WIP subledger'
  );

  source=replaceOnceOrAlready(
    source,
    "function wipReport(){return orders.filter(order=>!['Planned','Cancelled','Closed'].includes(order.status)).map(order=>({orderNumber:order.id,itemId:order.itemId,description:order.description,status:order.status,quantity:order.quantity,qtyCompleted:order.qtyCompleted,materialCost:money(order.costs.material),laborCost:money(order.costs.labor),machineCost:money(order.costs.machine),overheadCost:money(order.costs.overhead),wipAdded:wipAdded(order),wipRelieved:wipRelieved(order),wipBalance:money(wipAdded(order)-wipRelieved(order)),dueDate:order.dueDate,materialShortage:order.materialShortage,qualityHold:order.qualityHold}));}",
    "function wipReport(){return orders.filter(order=>!['Planned','Cancelled','Closed'].includes(order.status)).map(order=>({orderNumber:order.id,itemId:order.itemId,description:order.description,status:order.status,quantity:order.quantity,qtyCompleted:order.qtyCompleted,materialCost:money(order.costs.material),laborCost:money(order.costs.labor),machineCost:money(order.costs.machine),overheadCost:money(order.costs.overhead),outsideProcessingCost:outsideProcessingReceivedCost(order),wipAdded:wipAdded(order),wipRelieved:wipRelieved(order),wipBalance:money(wipAdded(order)-wipRelieved(order)),dueDate:order.dueDate,materialShortage:order.materialShortage,qualityHold:order.qualityHold}));}",
    'outside cost in WIP report'
  );

  source=replaceOnceOrAlready(
    source,
    "function shortageReport(){",
    `function rollStandardCost(itemId,onDate=nowDate(),stack=[]){if(stack.includes(itemId))throw new Error('Standard-cost rollup circular reference: '+[...stack,itemId].join(' -> '));const itemRow=item(itemId);if(!itemRow)throw new Error('Item '+itemId+' was not found.');const bom=effectiveBom(itemId,onDate);if(!bom){const purchased=money(h.itemCost(itemRow));return{itemId,material:purchased,labor:0,machine:0,overhead:0,outsideProcessing:0,total:purchased,components:[],routing:[]};}const yieldFactor=Math.max(0.000001,Number(bom.yieldPct||100)/100),components=[];let materialCost=0;for(const line of bom.components||[]){const perUnit=Number(line.qtyPer||0)/Math.max(0.000001,Number(bom.baseQty||1))/yieldFactor*(1+Number(line.scrapPct||0)/100),childBom=(line.supplyType==='Make'||line.supplyType==='Phantom')?effectiveBom(line.itemId,onDate):null,unitCost=childBom?rollStandardCost(line.itemId,onDate,[...stack,itemId]).total:money(h.itemCost(item(line.itemId))),extended=money(perUnit*unitCost);materialCost=money(materialCost+extended);components.push({itemId:line.itemId,supplyType:line.supplyType,quantityPerFinishedUnit:qty(perUnit),unitCost,extendedCost:extended});}const routing=effectiveRouting(itemId,onDate),operations=[];let labor=0,machine=0,overhead=0,outsideProcessing=0;for(const op of routing?.operations||[]){if(op.outsideProcessing){outsideProcessing=money(outsideProcessing+Number(op.outsideUnitCost||0));operations.push({sequence:op.sequence,type:'Outside Processing',cost:money(op.outsideUnitCost||0)});continue;}const setupPerUnit=Number(op.setupHours||0)/Math.max(0.000001,Number(bom.baseQty||1)),hours=setupPerUnit+Number(op.runHoursPerUnit||0),laborCost=money(hours*Number(op.laborRate||0)),machineCost=money(hours*Number(op.machineRate||0)),overheadCost=money(hours*Number(op.overheadRate||0));labor=money(labor+laborCost);machine=money(machine+machineCost);overhead=money(overhead+overheadCost);operations.push({sequence:op.sequence,type:'Internal',hours:qty(hours),laborCost,machineCost,overheadCost});}const total=money(materialCost+labor+machine+overhead+outsideProcessing);return{itemId,bomId:bom.id,bomRevision:bom.revision,routingId:routing?.id||'',routingRevision:routing?.revision||'',material:materialCost,labor,machine,overhead,outsideProcessing,total,components,routing:operations};}
  function applyStandardCost(input={},user='system'){const itemId=String(input.itemId||''),itemRow=item(itemId);if(!itemRow)throw new Error('Manufactured item is required for standard-cost rollup.');if(itemRow.costingMethod!=='Standard Cost')throw new Error('Standard-cost rollup can be applied only to items using Standard Cost costing method.');if(input.confirm!==true)throw new Error('Set confirm=true to apply a standard-cost rollup.');const result=rollStandardCost(itemId,input.effectiveDate||nowDate()),oldCost=money(itemRow.standardCost||0);itemRow.standardCost=result.total;itemRow.standardCostPrevious=oldCost;itemRow.standardCostUpdatedAt=new Date().toISOString();itemRow.standardCostUpdatedBy=user;audit('Standard Cost',itemId,'Rolled Up','Standard cost '+oldCost+' -> '+result.total+'.',user);return{...result,previousStandardCost:oldCost,applied:true};}
  function wipReconciliationReport(){return orders.filter(order=>!['Planned','Cancelled'].includes(order.status)).map(order=>{const receiptRefs=outsideProcessingReceiptRefs(order),relevant=journalEntries.filter(je=>String(je.sourceRef||'')===String(order.id)||receiptRefs.has(String(je.sourceRef||''))),glWip=money(relevant.reduce((sum,je)=>sum+(je.lines||[]).filter(line=>String(line.account)===String(settings.wipAccount)).reduce((lineSum,line)=>lineSum+Number(line.debit||0)-Number(line.credit||0),0),0)),subledgerWip=money(wipAdded(order)-wipRelieved(order)),difference=money(subledgerWip-glWip);return{orderNumber:order.id,itemId:order.itemId,status:order.status,subledgerWip,glWip,difference,inBalance:Math.abs(difference)<0.01,journalCount:relevant.length,outsideReceiptCount:receiptRefs.size};});}
  function shortageReport(){`,
    'standard cost rollup and WIP reconciliation'
  );

  source=replaceOnceOrAlready(
    source,
    "if(method==='GET'&&pathname==='/api/manufacturing/orders')return{status:200,body:orders.map(serializeOrder)};",
    "if(method==='GET'&&pathname==='/api/manufacturing/cost-rollup'){const itemId=String(query.itemId||'');if(!itemId)return{status:400,body:{error:'itemId is required.'}};return{status:200,body:rollStandardCost(itemId,query.effectiveDate||nowDate())};}if(method==='POST'&&pathname==='/api/manufacturing/cost-rollup/apply')return{status:200,body:applyStandardCost(await getBody(),actor)};if(method==='GET'&&pathname==='/api/manufacturing/reports/wip-reconciliation')return{status:200,body:wipReconciliationReport()};if(method==='GET'&&pathname==='/api/manufacturing/orders')return{status:200,body:orders.map(serializeOrder)};",
    'advanced manufacturing endpoints'
  );

  source=replaceOnceOrAlready(
    source,
    "(?:\\/(release|issue-materials|return-materials|report-operation|complete|close|cancel))?$/",
    "(?:\\/(release|issue-materials|return-materials|create-subcontract-po|report-operation|complete|close|cancel))?$/",
    'subcontract production route'
  );

  source=replaceOnceOrAlready(
    source,
    "else if(action==='return-materials')returnMaterials(order,input,actor);else if(action==='report-operation')reportOperation(order,input,actor);",
    "else if(action==='return-materials')returnMaterials(order,input,actor);else if(action==='create-subcontract-po'){const result=createSubcontractPo(order,input,actor);return{status:200,body:{...result,productionOrder:serializeOrder(order)}};}else if(action==='report-operation')reportOperation(order,input,actor);",
    'subcontract production action'
  );

  return source;
}

export async function prepareManufacturingAgent3AdvancedRuntime(inputModule='./.manufacturingRuntime-agent3.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyManufacturingAgent3AdvancedPatch(source);
  await writeFile(reviewedRuntimePath,patched,'utf8');
  return './.manufacturingRuntime-agent3.js';
}
