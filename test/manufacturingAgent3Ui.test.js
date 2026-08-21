import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyManufacturingAgent3RuntimePatch } from '../src/manufacturingAgent3ReviewPatch.js';
import { applyManufacturingAgent3PlanningPatch } from '../src/manufacturingAgent3PlanningPatch.js';
import { applyManufacturingAgent3MasterQualityPatch } from '../src/manufacturingAgent3MasterQualityPatch.js';
import { applyManufacturingAgent3AdvancedPatch } from '../src/manufacturingAgent3AdvancedPatch.js';
import { applyManufacturingAgent3FinalizationPatch } from '../src/manufacturingAgent3FinalizationPatch.js';
import { applyManufacturingAgent3UiRuntimePatch, applyManufacturingAgent3UiClientPatch } from '../src/manufacturingAgent3UiPatch.js';

const runtimeSource=await readFile(new URL('../src/manufacturingRuntime.js',import.meta.url),'utf8');
const reviewedRuntime=applyManufacturingAgent3FinalizationPatch(applyManufacturingAgent3AdvancedPatch(applyManufacturingAgent3MasterQualityPatch(applyManufacturingAgent3PlanningPatch(applyManufacturingAgent3RuntimePatch(runtimeSource)))));
const uiRuntime=applyManufacturingAgent3UiRuntimePatch(reviewedRuntime);
const clientSource=await readFile(new URL('../public/manufacturingModule.js',import.meta.url),'utf8');
const uiClient=applyManufacturingAgent3UiClientPatch(clientSource);

test('manufacturing UI runtime patch is idempotent and exposes service items for subcontract routing',()=>{
  assert.equal(uiRuntime,applyManufacturingAgent3UiRuntimePatch(uiRuntime));
  assert.match(uiRuntime,/serviceItems:itemMaster\.filter/);
  assert.match(uiRuntime,/Service Item/);
  assert.match(uiRuntime,/Non-Stock Item/);
});

test('manufacturing client patch is idempotent and compiles as browser JavaScript',()=>{
  assert.equal(uiClient,applyManufacturingAgent3UiClientPatch(uiClient));
  assert.doesNotThrow(()=>new Function(uiClient));
});

test('advanced manufacturing UI exposes outside processing, standard cost, and WIP reconciliation',()=>{
  assert.match(uiClient,/WIP \/ GL Reconciliation/);
  assert.match(uiClient,/Standard Cost Rollup/);
  assert.match(uiClient,/Outside processing/);
  assert.match(uiClient,/Subcontract Vendor/);
  assert.match(uiClient,/Service Item/);
  assert.match(uiClient,/Create Subcontract PO/);
  assert.match(uiClient,/create-subcontract-po/);
  assert.match(uiClient,/mfgCostPreview/);
  assert.match(uiClient,/mfgCostApply/);
  assert.match(uiClient,/wipReconciliationPage/);
  assert.match(uiClient,/outsideProcessingCost/);
});
