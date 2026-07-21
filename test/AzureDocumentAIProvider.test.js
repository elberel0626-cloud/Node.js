import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Azure provider follows the official REST SDK sample shape', async () => {
  const source = await readFile(new URL('../services/document-ai/AzureDocumentAIProvider.js', import.meta.url), 'utf8');
  assert.match(source, /@azure-rest\/ai-document-intelligence/);
  assert.doesNotMatch(source, /@azure\/ai-document-intelligence/);
  assert.doesNotMatch(source, /@azure\/core-auth/);
  assert.match(source, /DocumentIntelligence\(this\.endpoint,\{key:this\.key\}\)/);
  assert.match(source, /replace\(\/\\\/\+\$\/,'\'\)/);
  assert.doesNotMatch(source, /documentintelligence`/);
  assert.doesNotMatch(source, /apiVersion:this\.apiVersion/);
  assert.match(source, /base64Source=Buffer\.from\(document\)\.toString\('base64'\)/);
  assert.match(source, /contentType:'application\/json', body:\{base64Source\}/);
  assert.match(source, /client\.path\('\/documentModels\/\{modelId\}:analyze', this\.model\)/);
  assert.match(source, /getLongRunningPoller\(this\.client, initialResponse\)/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /retryFetch/);
});

test('package.json pins the REST SDK version', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies['@azure-rest/ai-document-intelligence'], '1.1.0');
});


test('endpoint validation message includes only the sanitized pathname', async () => {
  const source = await readFile(new URL('../services/document-ai/AzureDocumentAIProvider.js', import.meta.url), 'utf8');
  assert.match(source, /new URL\(endpoint\)/);
  assert.match(source, /Current pathname:/);
  assert.doesNotMatch(source, /Current key:/);
});
