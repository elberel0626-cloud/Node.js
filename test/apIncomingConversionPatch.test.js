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

test('reviewed incoming invoice converts to current AP bill lines and remains valid with full PO runtime', async () => {
  const base=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  const incoming=applyIncomingPurchaseOrderWorkflowPatch(base);
  const preferences=applyPurchaseOrderPreferencesPatch(incoming);
  const reporting=applyPurchaseOrderReportingPatch(preferences);
  const patched=applyApIncomingConversionPatch(reporting);
  assert.match(patched,/reviewedBillLines/);
  assert.match(patched,/poLineId:poLine\?\.id/);
  assert.match(patched,/matchedPoNumber:currentPo\?\.poNumber/);
  assert.match(patched,/evaluatePoThreeWayMatch\(d\)/);
  assert.match(patched,/status:'Saved'/);
  const tmp=await mkdtemp(path.join(os.tmpdir(),'erp-ap-incoming-conversion-'));
  const target=path.join(tmp,'server.mjs');
  try {
    await writeFile(target,patched,'utf8');
    execFileSync(process.execPath,['--check',target],{stdio:'pipe'});
  } finally {
    await rm(tmp,{recursive:true,force:true});
  }
});