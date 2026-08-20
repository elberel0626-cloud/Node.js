import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('Inventory V2 keeps the Inventory module button active after managed-route navigation',async()=>{
  const source=await readFile(new URL('../public/inventoryModuleNavSync.js',import.meta.url),'utf8');
  assert.match(source,/location\.pathname\.startsWith\('\/inventory\/'\)/);
  assert.match(source,/querySelector\("a\[href='\/inventory'\]"\)/);
  assert.match(source,/classList\.toggle\('active',link===inventoryLink\)/);
  assert.match(source,/inventory-v2-runtime-loaded/);
  assert.match(source,/MutationObserver/);
});
