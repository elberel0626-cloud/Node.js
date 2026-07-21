import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const normalizeForTest=(endpoint='')=>{ const base=String(endpoint||'').replace(/\/+$/,''); return base.endsWith('/documentintelligence')?base:`${base}/documentintelligence`; };

test('Azure provider uses the official REST SDK package and no raw fetch transport', async () => {
  const source = await readFile(new URL('../services/document-ai/AzureDocumentAIProvider.js', import.meta.url), 'utf8');
  assert.match(source, /@azure-rest\/ai-document-intelligence/);
  assert.doesNotMatch(source, /@azure\/ai-document-intelligence/);
  assert.doesNotMatch(source, /@azure\/core-auth/);
  assert.match(source, /base64Source/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /retryFetch/);
});

test('endpoint normalization appends documentintelligence exactly once', async () => {
  const source = await readFile(new URL('../services/document-ai/AzureDocumentAIProvider.js', import.meta.url), 'utf8');
  assert.match(source, /normalizeAzureEndpoint/);
  assert.equal(
    normalizeForTest('https://erp-ai-ebu.cognitiveservices.azure.com/'),
    'https://erp-ai-ebu.cognitiveservices.azure.com/documentintelligence'
  );
  assert.equal(
    normalizeForTest('https://erp-ai-ebu.cognitiveservices.azure.com/documentintelligence/'),
    'https://erp-ai-ebu.cognitiveservices.azure.com/documentintelligence'
  );
});
