import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyInventoryNavigationPatch } from '../src/inventoryNavigationPatch.js';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const patched=applyInventoryNavigationPatch(source);

test('Inventory navigation patch is idempotent and keeps item master under Manage',()=>{
  assert.equal(patched,applyInventoryNavigationPatch(patched));
  const inventoryStart=patched.indexOf("moduleName==='Inventory'?");
  const inventoryEnd=patched.indexOf(":moduleName==='AP'?",inventoryStart);
  assert.ok(inventoryStart>=0&&inventoryEnd>inventoryStart);
  const inventoryNav=patched.slice(inventoryStart,inventoryEnd);
  assert.match(inventoryNav,/\['Enter', \[\['\/inventory\/receipts','Receipts'\]/);
  assert.doesNotMatch(inventoryNav,/\['Enter', \[\['\/inventory\/items','Inventory Items'\]/);
  assert.match(inventoryNav,/\['Manage', \[\['\/inventory\/items','Inventory Items'\],\['\/inventory\/warehouses','Warehouses'\]/);
});
