import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyApPaymentNoApprovalPatch } from '../src/apPaymentNoApprovalPatch.js';

test('AP payment patch supports bill payments, PO-applied prepayments, cash GL line distributions, and deposit-funded receipts', async () => {
  const base = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  const patched = applyApPaymentNoApprovalPatch(base);

  assert.match(patched, /doc\.type==='Payment'\) doc\.paymentApprovalStatus='Not Required'/);
  assert.match(patched, /doc\.type==='Cash Payment'/);
  assert.match(patched, /Cash payment GL account line/);
  assert.match(patched, /doc\.lines\|\|\[\]/);
  assert.match(patched, /Cash Payment Amount must equal the total GL distribution lines/);
  assert.match(patched, /poApplications/);
  assert.match(patched, /Apply the vendor prepayment to at least one open Purchase Order before posting/);
  assert.match(patched, /Prepayment Amount must equal the total amount applied to Purchase Orders/);
  assert.match(patched, /syncPostedPrepaymentToPo/);
  assert.match(patched, /sourceApDocumentId/);
  assert.match(patched, /remainingVendorDeposit/);
  assert.match(patched, /POSTING_ACCOUNTS\.vendorDeposit,credit:depositApplied/);
  assert.match(patched, /receiptDepositApplied/);
  assert.match(patched, /sourceRecords=poPrepayments\.filter/);
  assert.match(patched, /b\.type==='Cash Payment'\?'CASH-AP'/);

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'erp-ap-payment-types-'));
  const target = path.join(tmp, 'server.mjs');
  try {
    await writeFile(target, patched, 'utf8');
    execFileSync(process.execPath, ['--check', target], { stdio:'pipe' });
  } finally {
    await rm(tmp, { recursive:true, force:true });
  }
});
