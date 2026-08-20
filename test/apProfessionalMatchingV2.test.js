import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

test('AP PO matching v2 uses bill vendor, checkbox PO linking, receipt states, PPV references, and Finance details', async () => {
  const url=new URL('../public/apProfessionalMatchingV2.js',import.meta.url),file=fileURLToPath(url),source=await readFile(url,'utf8');
  assert.match(source,/Bill Vendor/);
  assert.match(source,/Vendor comes from the bill header/);
  assert.match(source,/poPickV2/);
  assert.match(source,/Save PO Connections/);
  assert.match(source,/Waiting for receipt/);
  assert.match(source,/Partially received/);
  assert.match(source,/Fully received/);
  assert.match(source,/varianceAdjustments/);
  assert.match(source,/Estimated PPV/);
  assert.match(source,/billFinanceV2/);
  assert.match(source,/Journal Entry Lines/);
  assert.match(source,/finance\/journal-transactions/);
  assert.match(source,/ex\.poNumber=po/);
  assert.match(source,/ERP will not guess/);
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
});
