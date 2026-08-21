import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const generatedName='.server-manufacturing-runtime.js';
const generatedPath=path.join(here,generatedName);

function replaceOnceOrAlready(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`Manufacturing integration failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Manufacturing integration failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyManufacturingModulePatch(source){
  source=replaceOnceOrAlready(source,"import { financialWorkbook } from './xlsxWorkbook.js';","import { financialWorkbook } from './xlsxWorkbook.js';\nimport { createManufacturingRuntime } from './.manufacturingRuntime-agent3.js';",'manufacturing runtime import');
  source=replaceOnceOrAlready(source,"const periodModules = ['AR','AP','GL','Inventory'];","const periodModules = ['AR','AP','GL','Inventory','Manufacturing'];",'financial period module registry');
  source=replaceOnceOrAlready(source,"const periodFromDate=(date)=>String(date||new Date().toISOString().slice(0,10)).slice(0,7);","const periodFromDate=(date)=>String(date||new Date().toISOString().slice(0,10)).slice(0,7);\nfor(const period of financialPeriods){if(!Object.prototype.hasOwnProperty.call(period,'manufacturingStatus'))period.manufacturingStatus='Open';}",'existing financial period manufacturing status');
  source=replaceOnceOrAlready(source,"if(!p){ p={financialYear:periodId.slice(0,4),periodId,periodDescription:monthName(periodId),startDate:periodStart(periodId),endDate:periodEnd(periodId),arStatus:'Open',apStatus:'Open',glStatus:'Open',inventoryStatus:'Open',closedBy:'',closedDate:''}; financialPeriods.push(p); financialPeriods.sort((a,b)=>a.periodId.localeCompare(b.periodId)); }","if(!p){ p={financialYear:periodId.slice(0,4),periodId,periodDescription:monthName(periodId),startDate:periodStart(periodId),endDate:periodEnd(periodId),arStatus:'Open',apStatus:'Open',glStatus:'Open',inventoryStatus:'Open',manufacturingStatus:'Open',closedBy:'',closedDate:''}; financialPeriods.push(p); financialPeriods.sort((a,b)=>a.periodId.localeCompare(b.periodId)); }",'new financial period manufacturing status');
  source=replaceOnceOrAlready(source," if(mod==='SALES ORDERS'){const shipment=shipments.find(d=>String(d.id)===ref||String(d.shipmentNumber)===ref);if(shipment)return`/sales-orders/shipments/${encodeURIComponent(shipment.shipmentNumber||shipment.id)}`;return`/sales-orders/orders/${encodeURIComponent(ref)}`;}\n return'';\n}"," if(mod==='SALES ORDERS'){const shipment=shipments.find(d=>String(d.id)===ref||String(d.shipmentNumber)===ref);if(shipment)return`/sales-orders/shipments/${encodeURIComponent(shipment.shipmentNumber||shipment.id)}`;return`/sales-orders/orders/${encodeURIComponent(ref)}`;}\n if(mod==='MANUFACTURING')return`/manufacturing/orders/${encodeURIComponent(ref)}`;\n return'';\n}",'finance manufacturing source drilldown');
  source=replaceOnceOrAlready(source,'seedInventory();\nfunction adjustInventoryBalance',`seedInventory();\nlet manufacturingRuntime;\nfunction getManufacturingRuntime(){\n if(!manufacturingRuntime)manufacturingRuntime=createManufacturingRuntime({\n  itemMaster,inventoryBalances,inventoryTransactions,purchaseOrders,purchaseOrderLines,purchaseReceiptLines,journalEntries,vendors,salesOrders,salesOrderLines,warehouses,inventoryLocations,\n  helpers:{getBalance,qtyAvail,itemCost,adjustInventoryBalance,createInvAudit,createPostedJournal,periodFromDate,validateInventoryAndGlOpen,validatePeriodOpen,requireAccount,calcPoLine,recalcPo,nextPoId}\n });\n return manufacturingRuntime;\n}\nfunction adjustInventoryBalance`,'lazy manufacturing runtime initialization');
  source=replaceOnceOrAlready(source,"if(method==='GET'&&pathname==='/api/inventory/summary') return json(res,200,invSummary());",`if(pathname.startsWith('/api/manufacturing')){\n   try{\n    const mfgResponse=await getManufacturingRuntime().handle({method,pathname,query,readBody:()=>body(req),user:req.auth});\n    if(mfgResponse)return json(res,mfgResponse.status||200,mfgResponse.body);\n   }catch(error){return json(res,error.statusCode||400,{error:error.message,code:error.code||'MANUFACTURING_VALIDATION'});}\n  }\n if(method==='GET'&&pathname==='/api/inventory/summary') return json(res,200,invSummary());`,'manufacturing API router');
  return source;
}

export async function prepareManufacturingServer(inputModule='./server.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyManufacturingModulePatch(source);
  await writeFile(generatedPath,patched,'utf8');
  return `./${generatedName}`;
}
