import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { glAccounts, arDocuments, apDocuments } from './data/seed.js';
import { applyStatementClassification } from './accountStatementClassification.js';
import { normalizeSampleUnreleasedDocuments } from './sampleDataRuntime.js';
import { prepareCashPurchaseApplicationServer } from './cashPurchaseApplicationsPatch.js';
import { prepareIncomingPurchaseOrderWorkflowServer } from './incomingPurchaseOrderWorkflowPatch.js';
import { preparePurchaseOrderPreferencesServer } from './purchaseOrderPreferencesPatch.js';
import { preparePurchaseOrderReportingServer } from './purchaseOrderReportingPatch.js';
import { prepareApIncomingConversionServer } from './apIncomingConversionPatch.js';
import { prepareIncomingReviewSaveServer } from './incomingReviewSavePatch.js';
import { prepareApRuntimeReliabilityServer } from './apRuntimeReliabilityPatch.js';
import { prepareArProfessionalDocumentsServer } from './arProfessionalDocumentsPatch.js';
import { prepareFinancialReportMappingServer } from './financialReportMappingPatch.js';
import { prepareManufacturingAgent3Runtime } from './manufacturingAgent3ReviewPatch.js';
import { prepareManufacturingAgent3PlanningRuntime } from './manufacturingAgent3PlanningPatch.js';
import { prepareManufacturingAgent3MasterQualityRuntime } from './manufacturingAgent3MasterQualityPatch.js';
import { prepareManufacturingAgent3AdvancedRuntime } from './manufacturingAgent3AdvancedPatch.js';
import { prepareManufacturingAgent3FinalizedRuntime } from './manufacturingAgent3FinalizationPatch.js';
import { prepareManufacturingServer } from './manufacturingModulePatch.js';
import { patchApBillsGridFile } from './apBillsGridPatch.js';

async function makePoPreferencesRuntimeInitializationSafe(modulePath){
  const moduleUrl=new URL(modulePath,import.meta.url);
  const moduleFile=fileURLToPath(moduleUrl);
  const source=await readFile(moduleFile,'utf8');
  const postingAccountsIndex=source.indexOf('const POSTING_ACCOUNTS=');
  if(postingAccountsIndex<0)throw new Error('Generated PO runtime is missing POSTING_ACCOUNTS initialization.');
  const beforePostingAccounts=source.slice(0,postingAccountsIndex);
  const safeBeforePostingAccounts=beforePostingAccounts.replaceAll('POSTING_ACCOUNTS.poRni',"'2020'");
  if(safeBeforePostingAccounts!==beforePostingAccounts){
    await writeFile(moduleFile,safeBeforePostingAccounts+source.slice(postingAccountsIndex),'utf8');
  }
  return modulePath;
}

normalizeSampleUnreleasedDocuments({ arDocuments, apDocuments });
applyStatementClassification(glAccounts);
await patchApBillsGridFile();
const cashPurchaseServerModule = await prepareCashPurchaseApplicationServer();
const incomingPoServerModule = await prepareIncomingPurchaseOrderWorkflowServer(cashPurchaseServerModule);
const poPreferencesServerModule = await preparePurchaseOrderPreferencesServer(incomingPoServerModule);
await makePoPreferencesRuntimeInitializationSafe(poPreferencesServerModule);
const poReportingServerModule = await preparePurchaseOrderReportingServer(poPreferencesServerModule);
const apIncomingConversionServerModule = await prepareApIncomingConversionServer(poReportingServerModule);
const incomingReviewSaveServerModule = await prepareIncomingReviewSaveServer(apIncomingConversionServerModule);
const apRuntimeReliabilityServerModule = await prepareApRuntimeReliabilityServer(incomingReviewSaveServerModule);
const arProfessionalDocumentsServerModule = await prepareArProfessionalDocumentsServer(apRuntimeReliabilityServerModule);
const financialReportMappingServerModule = await prepareFinancialReportMappingServer(arProfessionalDocumentsServerModule);
await prepareManufacturingAgent3Runtime();
await prepareManufacturingAgent3PlanningRuntime();
await prepareManufacturingAgent3MasterQualityRuntime();
await prepareManufacturingAgent3AdvancedRuntime();
await prepareManufacturingAgent3FinalizedRuntime();
const manufacturingServerModule = await prepareManufacturingServer(financialReportMappingServerModule);
const manufacturingServerUrl = new URL(manufacturingServerModule, import.meta.url);
execFileSync(process.execPath, ['--check', fileURLToPath(manufacturingServerUrl)], { stdio: 'inherit' });
await import(manufacturingServerModule);
applyStatementClassification(glAccounts);
