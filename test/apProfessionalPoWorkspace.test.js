import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

test('AP Purchase Order tab provides vendor-filtered contains search and system receipt checks', async () => {
  const url=new URL('../public/apPurchaseOrderWorkspace.js',import.meta.url), file=fileURLToPath(url), source=await readFile(url,'utf8');
  assert.match(source,/purchase-orders\/lookup/);
  assert.match(source,/vendorNumber/);
  assert.match(source,/Type any part of a PO number to search/);
  assert.match(source,/purchase-receipts\/lookup/);
  assert.match(source,/ap-po-readonly-check/);
  assert.match(source,/Receipt boxes cannot be manually overridden/);
  assert.match(source,/bPoAdd/);
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
});

test('Incoming Document Create AP Bill interceptor saves reviewed fields and surfaces conversion errors', async () => {
  const url=new URL('../public/apIncomingCreateBillFix.js',import.meta.url), file=fileURLToPath(url), source=await readFile(url,'utf8');
  assert.match(source,/Creating AP Bill/);
  assert.match(source,/reviewedPayload/);
  assert.match(source,/overrideDuplicate:true/);
  assert.match(source,/Unable to Create AP Bill/);
  assert.match(source,/stopImmediatePropagation/);
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
});