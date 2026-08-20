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
const cashPurchaseServerModule = await prepareCashPurchaseApplicationServer();
const incomingPoServerModule = await prepareIncomingPurchaseOrderWorkflowServer(cashPurchaseServerModule);
const poPreferencesServerModule = await preparePurchaseOrderPreferencesServer(incomingPoServerModule);
await makePoPreferencesRuntimeInitializationSafe(poPreferencesServerModule);
const poReportingServerModule = await preparePurchaseOrderReportingServer(poPreferencesServerModule);
const apIncomingConversionServerModule = await prepareApIncomingConversionServer(poReportingServerModule);
const incomingReviewSaveServerModule = await prepareIncomingReviewSaveServer(apIncomingConversionServerModule);
const apRuntimeReliabilityServerModule = await prepareApRuntimeReliabilityServer(incomingReviewSaveServerModule);
const apRuntimeReliabilityServerUrl = new URL(apRuntimeReliabilityServerModule, import.meta.url);
execFileSync(process.execPath, ['--check', fileURLToPath(apRuntimeReliabilityServerUrl)], { stdio: 'inherit' });
await import(apRuntimeReliabilityServerModule);
applyStatementClassification(glAccounts);
