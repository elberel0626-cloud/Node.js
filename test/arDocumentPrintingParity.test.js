import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const hotfix=await readFile(new URL('../public/arProfessionalDocumentsHotfix.js',import.meta.url),'utf8');
const serverPatch=await readFile(new URL('../src/arProfessionalDocumentsPatch.js',import.meta.url),'utf8');

test('AR document preview stays in the ERP and never forces a new browser tab',()=>{
  assert.match(hotfix,/openPdfPreviewUrl/);
  assert.match(hotfix,/ar-parity-pdf-overlay/);
  assert.doesNotMatch(hotfix,/window\.open\s*\(/);
});

test('invoice, credit memo, and debit memo share the Print AR Documents PDF endpoint',()=>{
  for(const type of ['Invoice','Credit Memo','Debit Memo'])assert.match(hotfix,new RegExp(type));
  assert.match(hotfix,/\/api\/ar\/documents\/\$\{encodeURIComponent\(id\)\}\/pdf/);
  assert.match(hotfix,/value='view'>View \$\{esc\(type\)\}/);
  assert.match(hotfix,/value='download'>Download \$\{esc\(type\)\}/);
  assert.match(hotfix,/value='print'>Print \$\{esc\(type\)\}/);
});

test('individual AR documents expose PDF actions only through Inquiry',()=>{
  assert.match(hotfix,/view\.querySelector\('#arDetailPdfView'\)\?\.remove\(\)/);
  assert.doesNotMatch(hotfix,/createElement\('button'\).*arDetailPdfView/);
  assert.match(hotfix,/replacement\.id='inqSel'/);
});

test('Inquiry PDF actions are captured before the legacy invoice onchange handler',()=>{
  assert.match(hotfix,/document\.addEventListener\('change',event=>/);
  assert.match(hotfix,/select\.id!=='inqSel'/);
  assert.match(hotfix,/PDF_ACTIONS\.has\(action\)/);
  assert.match(hotfix,/event\.stopImmediatePropagation\(\)/);
  assert.match(hotfix,/runDocumentPdfAction\(action,context\.id,context\.type\)/);
});

test('Print AR and individual Inquiry call the same document PDF action function',()=>{
  assert.match(hotfix,/arParityView'\)\.onclick=\(\)=>selected&&runDocumentPdfAction\('view',selected\.id,selected\.type\)/);
  assert.match(hotfix,/arParityPrint'\)\.onclick=\(\)=>selected&&runDocumentPdfAction\('print',selected\.id,selected\.type\)/);
  assert.match(hotfix,/if\(action==='view'\)return openPdfPreviewUrl\(documentPdfUrl\(id,false\)/);
  assert.match(hotfix,/if\(action==='print'\)return printUrl\(documentPdfUrl\(id,false\)\)/);
});

test('AR PDF endpoints allow only same-origin framing for the in-app preview',()=>{
  const sameOriginHeaders=(serverPatch.match(/'X-Frame-Options':'SAMEORIGIN'/g)||[]).length;
  const frameAncestors=(serverPatch.match(/Content-Security-Policy':"frame-ancestors 'self'"/g)||[]).length;
  assert.equal(sameOriginHeaders,2);
  assert.equal(frameAncestors,2);
});

test('Print AR Documents includes posted invoices and memos',()=>{
  assert.match(hotfix,/location\.pathname==='\/ar\/processes\/print-ar'/);
  assert.match(hotfix,/PRINTABLE_TYPES\.has\(document\.type\)/);
  assert.match(hotfix,/document\.posted===true/);
  assert.match(hotfix,/No posted invoices, credit memos, or debit memos/);
});
