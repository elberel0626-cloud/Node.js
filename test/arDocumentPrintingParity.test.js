import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const hotfix=await readFile(new URL('../public/arProfessionalDocumentsHotfix.js',import.meta.url),'utf8');

test('AR document preview stays in the ERP and never forces a new browser tab',()=>{
  assert.match(hotfix,/openPdfPreview/);
  assert.match(hotfix,/ar-parity-pdf-overlay/);
  assert.doesNotMatch(hotfix,/window\.open\s*\(/);
});

test('invoice, credit memo, and debit memo share the same PDF endpoint',()=>{
  for(const type of ['Invoice','Credit Memo','Debit Memo'])assert.match(hotfix,new RegExp(type));
  assert.match(hotfix,/\/api\/ar\/documents\/\$\{encodeURIComponent\(id\)\}\/pdf/);
  assert.match(hotfix,/View \$\{type\}/);
  assert.match(hotfix,/Download \$\{esc\(type\)\}/);
  assert.match(hotfix,/Print \$\{esc\(type\)\}/);
});

test('Print AR Documents includes posted invoices and memos',()=>{
  assert.match(hotfix,/location\.pathname==='\/ar\/processes\/print-ar'/);
  assert.match(hotfix,/PRINTABLE_TYPES\.has\(document\.type\)/);
  assert.match(hotfix,/document\.posted===true/);
  assert.match(hotfix,/No posted invoices, credit memos, or debit memos/);
});
