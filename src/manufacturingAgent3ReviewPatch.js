import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const generatedName='.manufacturingRuntime-agent3.js';
const generatedPath=path.join(here,generatedName);

function replaceOnceOrAlready(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`Agent 3 manufacturing review patch failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Agent 3 manufacturing review patch failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyManufacturingAgent3RuntimePatch(source){
  source=replaceOnceOrAlready(
    source,
    "const required=['getBalance','qtyAvail','itemCost','adjustInventoryBalance','createInvAudit','createPostedJournal','periodFromDate','validateInventoryAndGlOpen','calcPoLine','recalcPo','nextPoId'];",
    "const required=['getBalance','qtyAvail','itemCost','adjustInventoryBalance','createInvAudit','createPostedJournal','periodFromDate','validateInventoryAndGlOpen','validatePeriodOpen','requireAccount','calcPoLine','recalcPo','nextPoId'];",
    'required integration helpers'
  );

  source=replaceOnceOrAlready(
    source,
    "function postJournal(order,description,lines,user){if(!lines.length)return'';const postDate=nowDate(),period=h.periodFromDate(postDate);h.validateInventoryAndGlOpen(period);",
    "function postJournal(order,description,lines,user){if(!lines.length)return'';const postDate=nowDate(),period=h.periodFromDate(postDate);h.validatePeriodOpen('Manufacturing',period);h.validateInventoryAndGlOpen(period);for(const line of lines)h.requireAccount(line.account,'Manufacturing posting account');",
    'manufacturing period/account validation'
  );

  source=replaceOnceOrAlready(
    source,
    "if(method==='PUT'&&pathname==='/api/manufacturing/settings'){Object.assign(settings,await getBody());audit('Manufacturing Settings','SETTINGS','Updated','',actor);return{status:200,body:settings};}",
    "if(method==='PUT'&&pathname==='/api/manufacturing/settings'){const input=await getBody(),next={...settings,...input};for(const field of ['rawMaterialAccount','wipAccount','finishedGoodsAccount','laborOverheadAbsorptionAccount','productionLaborExpenseAccount','scrapVarianceAccount'])next[field]=h.requireAccount(next[field],`Manufacturing ${field}`);if(!warehouses.some(row=>String(row.warehouseId||row.id)===String(next.defaultWipWarehouse)))throw new Error('Default WIP warehouse was not found.');if(next.defaultWipLocation&&!inventoryLocations.some(row=>String(row.warehouse)===String(next.defaultWipWarehouse)&&String(row.locationId||row.id)===String(next.defaultWipLocation)))throw new Error('Default WIP location was not found in the selected WIP warehouse.');for(const field of ['planningHorizonDays','capacityHorizonDays']){const value=Number(next[field]);if(!Number.isInteger(value)||value<1||value>3650)throw new Error(`${field} must be a whole number between 1 and 3650.`);next[field]=value;}for(const field of ['allowReleaseWithShortage','allowNegativeInventory','autoBackflush','requireQualityBeforeCompletion'])next[field]=next[field]===true;Object.assign(settings,next);audit('Manufacturing Settings','SETTINGS','Updated','Validated posting accounts and production controls.',actor);return{status:200,body:settings};}",
    'validated manufacturing settings update'
  );

  source=replaceOnceOrAlready(
    source,
    "if(!issueList.length)throw new Error('No material quantity remains to issue.');const journalLines=[],auditRows=[];for(const entry of issueList){",
    "if(!issueList.length)throw new Error('No material quantity remains to issue.');const issuePeriod=h.periodFromDate(nowDate());h.validatePeriodOpen('Manufacturing',issuePeriod);h.validateInventoryAndGlOpen(issuePeriod);h.requireAccount(settings.wipAccount,'Manufacturing WIP account');const aggregate=new Map();for(const entry of issueList){const line=entry.line,key=[line.itemId,line.warehouse,line.location].join('|'),current=aggregate.get(key)||{line,quantity:0};current.quantity+=Number(entry.issueQty||0);aggregate.set(key,current);h.requireAccount(item(line.itemId)?.inventoryAccount||settings.rawMaterialAccount,'Manufacturing component inventory account');}for(const current of aggregate.values()){const balance=h.getBalance(current.line.itemId,current.line.warehouse,current.line.location),available=settings.allowNegativeInventory?Number.POSITIVE_INFINITY:Number(balance.qtyOnHand||0);if(available+0.000001<current.quantity)throw new Error('Insufficient on-hand quantity for '+current.line.itemId+'. Required '+current.quantity+', on hand '+Number(balance.qtyOnHand||0)+'.');}const journalLines=[],auditRows=[];for(const entry of issueList){",
    'atomic material issue prevalidation'
  );

  source=replaceOnceOrAlready(
    source,
    "line.qtyIssued=qty(Number(line.qtyIssued||0)+issueQty);line.shortageQty=qty(Math.max(0,Number(line.requiredQty||0)-Number(line.qtyIssued||0)-Number(line.qtyReserved||0)));",
    "line.qtyIssued=qty(Number(line.qtyIssued||0)+issueQty);line.issuedValue=money(Number(line.issuedValue||0)+amount);line.shortageQty=qty(Math.max(0,Number(line.requiredQty||0)-Number(line.qtyIssued||0)-Number(line.qtyReserved||0)));",
    'material issued value tracking'
  );

  source=replaceOnceOrAlready(
    source,
    "\n  function operationCost(op,input){",
    `\n  function returnMaterials(order,input={},user='system'){
    if(!['Released','Material Shortage','In Process'].includes(order.status))throw new Error('Material returns are allowed only on active released production orders.');const requested=Array.isArray(input.lines)&&input.lines.length?input.lines:[];if(!requested.length)throw new Error('Select at least one issued material line to return.');const returns=[];
    for(const request of requested){const matches=(order.materials||[]).filter(line=>request.lineId?String(line.lineId)===String(request.lineId):String(line.itemId)===String(request.itemId||request.inventoryId));if(matches.length!==1)throw new Error('Material return lines must identify exactly one BOM line. Use lineId when an item appears more than once on the BOM.');const line=matches[0],returnQty=qty(assertPositive(request.quantity??request.qty??0,'Return quantity'));if(returnQty>Number(line.qtyIssued||0)+0.000001)throw new Error('Return quantity for '+line.itemId+' exceeds the quantity issued to the production order.');const issuedQty=Math.max(0.000001,Number(line.qtyIssued||0)),unitCost=money(Number(line.issuedValue||0)/issuedQty||h.itemCost(item(line.itemId))||0),amount=money(returnQty*unitCost);if(amount<=0)throw new Error('Returned material must have a positive issued cost.');returns.push({line,returnQty,unitCost,amount});}
    const period=h.periodFromDate(nowDate());h.validatePeriodOpen('Manufacturing',period);h.validateInventoryAndGlOpen(period);h.requireAccount(settings.wipAccount,'Manufacturing WIP account');const journalLines=[];for(const row of returns){const inventoryAccount=item(row.line.itemId)?.inventoryAccount||settings.rawMaterialAccount;h.requireAccount(inventoryAccount,'Manufacturing component inventory account');journalLines.push({account:inventoryAccount,debit:row.amount,credit:0,description:'Material return '+row.line.itemId,sourceReference:order.id},{account:settings.wipAccount,debit:0,credit:row.amount,description:'WIP material return '+row.line.itemId,sourceReference:order.id});}
    const jeRef=postJournal(order,'Manufacturing material return '+order.id,journalLines,user);for(const row of returns){h.adjustInventoryBalance({itemId:row.line.itemId,warehouse:row.line.warehouse,location:row.line.location,qtyIn:row.returnQty,unitCost:row.unitCost});row.line.qtyIssued=qty(Math.max(0,Number(row.line.qtyIssued||0)-row.returnQty));row.line.issuedValue=money(Math.max(0,Number(row.line.issuedValue||0)-row.amount));row.line.shortageQty=qty(Math.max(0,Number(row.line.requiredQty||0)-Number(row.line.qtyIssued||0)-Number(row.line.qtyReserved||0)));order.costs.material=money(Math.max(0,Number(order.costs.material||0)-row.amount));h.createInvAudit({transactionType:'Production Material Return',referenceNumber:order.id,sourceModule:'Manufacturing',sourceReference:order.id,itemId:row.line.itemId,warehouse:row.line.warehouse,location:row.line.location,quantityIn:row.returnQty,unitCost:row.unitCost,postDate:nowDate(),postPeriod:period,jeReference:jeRef,createdBy:user});}order.materialShortage=(order.materials||[]).some(line=>Number(line.shortageQty||0)>0);order.updatedAt=new Date().toISOString();audit('Production Order',order.id,'Material Return',returns.length+' component line(s) returned from WIP.',user);return{order,jeReference:jeRef};
  }
  function operationCost(op,input){`,
    'material return workflow'
  );

  source=replaceOnceOrAlready(
    source,
    "const projectedCompleted=Number(order.qtyCompleted||0)+completed;ensureQualityGate(order,projectedCompleted);backflush(order,Number(order.qtyCompleted||0)+Number(order.qtyScrapped||0)+completed+scrapped,user);\n    const manufacturedItem=item(order.itemId),availableWip=money(wipAdded(order)-wipRelieved(order));",
    "const projectedCompleted=Number(order.qtyCompleted||0)+completed;ensureQualityGate(order,projectedCompleted);const manufacturedItem=item(order.itemId),fgAccount=manufacturedItem?.manufacturingInventoryAccount||settings.finishedGoodsAccount,completionPeriod=h.periodFromDate(nowDate());h.validatePeriodOpen('Manufacturing',completionPeriod);h.validateInventoryAndGlOpen(completionPeriod);h.requireAccount(fgAccount,'Manufacturing finished goods account');h.requireAccount(settings.wipAccount,'Manufacturing WIP account');backflush(order,Number(order.qtyCompleted||0)+Number(order.qtyScrapped||0)+completed+scrapped,user);\n    const availableWip=money(wipAdded(order)-wipRelieved(order));",
    'completion prevalidation before backflush'
  );

  source=replaceOnceOrAlready(
    source,
    "const unitCost=money(receiptValue/completed);const period=h.periodFromDate(nowDate());h.validateInventoryAndGlOpen(period);const fgAccount=manufacturedItem?.manufacturingInventoryAccount||settings.finishedGoodsAccount;const jeRef=postJournal",
    "const unitCost=money(receiptValue/completed);const period=completionPeriod;const jeRef=postJournal",
    'completion validated period reuse'
  );

  source=replaceOnceOrAlready(
    source,
    "for(const component of materialRequirements(bom,short)){planNeed(component.itemId,component.requiredQty,dueDate,{sourceType:'BOM Demand'",
    "for(const component of materialRequirements(bom,short)){planNeed(component.itemId,component.requiredQty,dateMinusDays(dueDate,itemRow?.leadTimeDays||0),{sourceType:'BOM Demand'",
    'MRP component release-date offset'
  );

  source=replaceOnceOrAlready(
    source,
    "(?:\\/(release|issue-materials|report-operation|complete|close|cancel))?$/",
    "(?:\\/(release|issue-materials|return-materials|report-operation|complete|close|cancel))?$/",
    'production order material return route'
  );

  source=replaceOnceOrAlready(
    source,
    "else if(action==='issue-materials')issueMaterials(order,input,actor);else if(action==='report-operation')reportOperation(order,input,actor);",
    "else if(action==='issue-materials')issueMaterials(order,input,actor);else if(action==='return-materials')returnMaterials(order,input,actor);else if(action==='report-operation')reportOperation(order,input,actor);",
    'production order material return action'
  );

  source=replaceOnceOrAlready(
    source,
    "return{handle,overview,runMrp,createOrder,releaseOrder,issueMaterials,reportOperation,completeOrder,closeOrder,createInspection,capacityReport,wipReport,varianceReport,shortageReport,productionReport,state:",
    "return{handle,overview,runMrp,createOrder,releaseOrder,issueMaterials,returnMaterials,reportOperation,completeOrder,closeOrder,createInspection,capacityReport,wipReport,varianceReport,shortageReport,productionReport,state:",
    'material return runtime export'
  );

  return source;
}

export async function prepareManufacturingAgent3Runtime(inputModule='./manufacturingRuntime.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyManufacturingAgent3RuntimePatch(source);
  await writeFile(generatedPath,patched,'utf8');
  return `./${generatedName}`;
}
