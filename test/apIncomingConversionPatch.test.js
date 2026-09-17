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

test('reviewed incoming document creates either a Bill or Credit Memo and cannot convert twice', async () => {
  const base=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  const incoming=applyIncomingPurchaseOrderWorkflowPatch(base);
  const preferences=applyPurchaseOrderPreferencesPatch(incoming);
  const reporting=applyPurchaseOrderReportingPatch(preferences);
  const patched=applyApIncomingConversionPatch(reporting);
  assert.match(patched,/reviewedBillLines/);
  assert.match(patched,/reviewedSourceLines=Array\.isArray\(r\.extracted\?\.lines\)\?r\.extracted\.lines/);
  assert.match(patched,/selectedDocumentType=\['Bill','Credit Adjustment'\]\.includes\(r\.draftBill\?\.type\)/);
  assert.doesNotMatch(patched,/selectedDocumentType=\['Bill','Prepayment'\]/);
  assert.match(patched,/selectedDocumentType==='Credit Adjustment'\?'CM-AP':'BILL'/);
  assert.match(patched,/type:selectedDocumentType/);
  assert.match(patched,/already been converted to an AP document and cannot create another one/);
  assert.match(patched,/poLineId:poLine\?\.id/);
  assert.match(patched,/matchedPoNumber:currentPo\?\.poNumber/);
  assert.match(patched,/selectedDocumentType==='Bill'\)\{const incomingMatch=evaluatePoThreeWayMatch\(d\)/);
  const tmp=await mkdtemp(path.join(os.tmpdir(),'erp-ap-incoming-conversion-'));
  const target=path.join(tmp,'server.mjs');
  try {
    await writeFile(target,patched,'utf8');
    execFileSync(process.execPath,['--check',target],{stdio:'pipe'});
  } finally {
    await rm(tmp,{recursive:true,force:true});
  }
});
