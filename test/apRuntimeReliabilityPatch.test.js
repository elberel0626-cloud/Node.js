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
import { applyApRuntimeReliabilityPatch } from '../src/apRuntimeReliabilityPatch.js';

test('final AP runtime initializes incoming review state and posts signed AP lines on conventional GL sides',async()=>{
  const base=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  let source=applyIncomingPurchaseOrderWorkflowPatch(base);source=applyPurchaseOrderPreferencesPatch(source);source=applyPurchaseOrderReportingPatch(source);source=applyApIncomingConversionPatch(source);source=applyIncomingReviewSavePatch(source);source=applyApRuntimeReliabilityPatch(source);
  assert.match(source,/r\.draftBill=r\.draftBill\|\|\{\}/);
  assert.match(source,/submittedPoField/);
  assert.match(source,/r\.extracted\.purchaseOrderNumber=submittedPo;r\.extracted\.poNumber=submittedPo/);
  assert.match(source,/reviewedPoNumber\?matchIncomingPo/);
  assert.match(source,/Object\.prototype\.hasOwnProperty\.call\(r\.extracted\|\|\{\},'purchaseOrderNumber'\)/);
  assert.match(source,/matchType:'Non-PO'/);
  assert.match(source,/allowed\.has\(p\.status\)\|\|billableLinesForPo\(p\)\.length>0/);
  assert.doesNotMatch(source,/filter\(p=>!\['Draft','Cancelled','Voided'\]\.includes\(p\.status\)\)/);
  assert.match(source,/INCOMING_ATTACHMENT_RETAIN_FAILED/);
  assert.match(source,/debit:lineAmount>0\?lineAmount:0,credit:lineAmount<0\?Math\.abs\(lineAmount\):0/);
  assert.doesNotMatch(source,/account:expenseAccount,debit:lineAmount,credit:0/);
  const tmp=await mkdtemp(path.join(os.tmpdir(),'ap-runtime-reliability-')),target=path.join(tmp,'server.mjs');try{await writeFile(target,source);execFileSync(process.execPath,['--check',target],{stdio:'pipe'});}finally{await rm(tmp,{recursive:true,force:true});}
});
