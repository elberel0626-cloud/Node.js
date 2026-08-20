import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyIncomingPurchaseOrderWorkflowPatch } from '../src/incomingPurchaseOrderWorkflowPatch.js';
import { applyPurchaseOrderPreferencesPatch } from '../src/purchaseOrderPreferencesPatch.js';
import { applyPurchaseOrderReportingPatch } from '../src/purchaseOrderReportingPatch.js';
import { applyApIncomingConversionPatch } from '../src/apIncomingConversionPatch.js';
import { applyIncomingReviewSavePatch } from '../src/incomingReviewSavePatch.js';

test('blank reviewed PO is a valid non-PO save and stale PO classification is cleared', async () => {
  const base=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  const incoming=applyIncomingPurchaseOrderWorkflowPatch(base);
  const preferences=applyPurchaseOrderPreferencesPatch(incoming);
  const reporting=applyPurchaseOrderReportingPatch(preferences);
  const conversion=applyApIncomingConversionPatch(reporting);
  const patched=applyIncomingReviewSavePatch(conversion);
  assert.match(patched,/if\(!reviewedPoNumber\)\{b\.invoiceClassification='';r\.invoiceClassification=''/);
  assert.match(patched,/r\.draftBill\.classificationOverrideReason=''/);
  const tmp=await mkdtemp(path.join(os.tmpdir(),'erp-incoming-save-'));
  const target=path.join(tmp,'server.mjs');
  try { await writeFile(target,patched,'utf8'); execFileSync(process.execPath,['--check',target],{stdio:'pipe'}); }
  finally { await rm(tmp,{recursive:true,force:true}); }
});
