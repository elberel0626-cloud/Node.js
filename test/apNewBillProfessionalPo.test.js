import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

test('new AP bills use the professional PO workspace instead of legacy PO subgrids', async () => {
  const url=new URL('../public/apNewBillProfessionalPo.js',import.meta.url),file=fileURLToPath(url),source=await readFile(url,'utf8');
  assert.match(source,/\/ap\\\/bills\\\/(?:new\|__new__)/);
  assert.match(source,/ap-po-new-v2-active/);
  assert.match(source,/Bill Vendor/);
  assert.match(source,/Apply PO Connections/);
  assert.match(source,/purchase-orders\/lookup\?vendorNumber/);
  assert.match(source,/Receipt State/);
  assert.match(source,/Current 3-Way Match/);
  assert.match(source,/Save bill to calculate official match/);
  assert.match(source,/purchase-receipts\/lookup/);
  assert.match(source,/PO connections applied/);
  assert.match(source,/\.ln-po/);
  assert.match(source,/ERP will not guess|matches more than one selected PO line/);
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
});
