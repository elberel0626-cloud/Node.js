import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyIncomingPurchaseOrderWorkflowPatch } from '../src/incomingPurchaseOrderWorkflowPatch.js';
import { applyPurchaseOrderPreferencesPatch } from '../src/purchaseOrderPreferencesPatch.js';

test('purchase-order preferences patch integrates strict 3-way matching and parses', async () => {
  const base = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  const incomingPatched = applyIncomingPurchaseOrderWorkflowPatch(base);
  const patched = applyPurchaseOrderPreferencesPatch(incomingPatched);

  assert.match(patched, /\/api\/purchase-orders\/preferences/);
  assert.match(patched, /Quantity Exception - Pending Purchasing Approval/);
  assert.match(patched, /Approved Match Exception - Ready to Post/);
  assert.match(patched, /validatePoThreeWayPostability\(doc\)/);
  assert.match(patched, /refreshPoLinkedBillMatchStatuses\(po\.id\)/);
  assert.match(patched, /purchasePriceVarianceAccount/);
  assert.match(patched, /purchaseQuantityVarianceAccount/);
  assert.match(patched, /receiptNotInvoicedAccount/);
  assert.match(patched, /POVAR-/);
  assert.match(patched, /poReceiptMatchedBilledQty/);
  assert.match(patched, /processApBillPoMatchesProfessional/);

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'erp-po-preferences-'));
  const target = path.join(tmp, 'server.mjs');
  try {
    await writeFile(target, patched, 'utf8');
    execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
