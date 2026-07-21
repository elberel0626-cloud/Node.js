import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Azure provider uses the official SDK package and no raw fetch transport', async () => {
  const source = await readFile(new URL('../services/document-ai/AzureDocumentAIProvider.js', import.meta.url), 'utf8');
  assert.match(source, /@azure\/ai-document-intelligence/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /retryFetch/);
});
