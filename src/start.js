import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { glAccounts, arDocuments, apDocuments } from './data/seed.js';
import { applyStatementClassification } from './accountStatementClassification.js';
import { normalizeSampleUnreleasedDocuments } from './sampleDataRuntime.js';
import { prepareCashPurchaseApplicationServer } from './cashPurchaseApplicationsPatch.js';
import { prepareIncomingPurchaseOrderWorkflowServer } from './incomingPurchaseOrderWorkflowPatch.js';
import { preparePurchaseOrderPreferencesServer } from './purchaseOrderPreferencesPatch.js';

normalizeSampleUnreleasedDocuments({ arDocuments, apDocuments });
applyStatementClassification(glAccounts);
const cashPurchaseServerModule = await prepareCashPurchaseApplicationServer();
const incomingPoServerModule = await prepareIncomingPurchaseOrderWorkflowServer(cashPurchaseServerModule);
const poPreferencesServerModule = await preparePurchaseOrderPreferencesServer(incomingPoServerModule);
const poPreferencesServerUrl = new URL(poPreferencesServerModule, import.meta.url);
execFileSync(process.execPath, ['--check', fileURLToPath(poPreferencesServerUrl)], { stdio: 'inherit' });
await import(poPreferencesServerModule);
applyStatementClassification(glAccounts);
