import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyIncomingPurchaseOrderWorkflowPatch } from '../src/incomingPurchaseOrderWorkflowPatch.js';
import { applyPurchaseOrderPreferencesPatch } from '../src/purchaseOrderPreferencesPatch.js';
import { applyPurchaseOrderReportingPatch } from '../src/purchaseOrderReportingPatch.js';

test('PO reporting patch closes fully received goods POs and keeps unvouched receipts billable', async () => {
  const base=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  const incoming=applyIncomingPurchaseOrderWorkflowPatch(base);
  const preferences=applyPurchaseOrderPreferencesPatch(incoming);
  const patched=applyPurchaseOrderReportingPatch(preferences);

  assert.match(patched,/if\(fullyComplete\)next='Closed'/);
  assert.match(patched,/po\.status==='Closed'&&billableLinesForPo\(po\)\.length>0/);
  assert.match(patched,/pathname==='\/api\/purchase-orders\/reports\/operational'/);
  assert.match(patched,/receivedNotVouchedAmount/);
  assert.match(patched,/prepaymentAvailable/);
  assert.match(patched,/synchronizeReceiptBilledQuantities\(poLine\)/);
});
