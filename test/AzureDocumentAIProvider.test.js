import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAzureAnalyzeUrl } from '../services/document-ai/AzureDocumentAIProvider.js';

test('buildAzureAnalyzeUrl constructs the exact prebuilt invoice analyze URL', () => {
  assert.equal(
    buildAzureAnalyzeUrl(
      'https://example.cognitiveservices.azure.com/',
      'prebuilt-invoice',
      '2024-11-30'
    ),
    'https://example.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-invoice:analyze?_overload=analyzeDocument&api-version=2024-11-30'
  );
});
