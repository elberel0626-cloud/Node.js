import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

test('legacy AP PO script is cleanup-only and does not compete with V2 renderer', async () => {
  const url=new URL('../public/apPurchaseOrderWorkspace.js',import.meta.url), file=fileURLToPath(url), source=await readFile(url,'utf8');
  assert.match(source,/apProfessionalMatchingV2\.js is the single owner/);
  assert.match(source,/po-match-actions/);
  assert.match(source,/add-po/);
  assert.doesNotMatch(source,/purchase-orders\/lookup/);
  assert.doesNotMatch(source,/purchase-receipts\/lookup/);
  assert.doesNotMatch(source,/renderWorkspace/);
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
