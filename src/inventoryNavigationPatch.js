import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const appPath=path.join(here,'../public/app.js');

const oldEnter="['Enter', [['/inventory/items','Inventory Items'],['/inventory/receipts','Receipts'],['/inventory/issues','Issues'],['/inventory/adjustments','Adjustments'],['/inventory/transfers','Transfers'],['/inventory/physical-counts','Physical Counts']]]";
const newEnter="['Enter', [['/inventory/receipts','Receipts'],['/inventory/issues','Issues'],['/inventory/adjustments','Adjustments'],['/inventory/transfers','Transfers'],['/inventory/physical-counts','Physical Counts']]]";
const oldManage="['Manage', [['/inventory/warehouses','Warehouses'],['/inventory/locations','Locations'],['/inventory/item-classes','Item Classes'],['/inventory/uom','Units of Measure'],['/inventory/reason-codes','Reason Codes'],['/inventory/costing-methods','Costing Methods']]]";
const newManage="['Manage', [['/inventory/items','Inventory Items'],['/inventory/warehouses','Warehouses'],['/inventory/locations','Locations'],['/inventory/item-classes','Item Classes'],['/inventory/uom','Units of Measure'],['/inventory/reason-codes','Reason Codes'],['/inventory/costing-methods','Costing Methods']]]";

function replaceExactlyOnce(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`Inventory navigation patch failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Inventory navigation patch failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyInventoryNavigationPatch(source){
  source=replaceExactlyOnce(source,oldEnter,newEnter,'Inventory Enter group');
  source=replaceExactlyOnce(source,oldManage,newManage,'Inventory Manage group');
  return source;
}

export async function patchInventoryNavigationFile(){
  const source=await readFile(appPath,'utf8');
  const patched=applyInventoryNavigationPatch(source);
  if(patched!==source)await writeFile(appPath,patched,'utf8');
  return appPath;
}
