import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePdfUpload } from '../src/pdfUpload.js';

const pdf=Buffer.from('%PDF-1.4\n%%EOF\n');
test('valid PDF signatures are accepted when browsers omit or generalize MIME type',()=>{
  for(const mimeType of ['', 'application/pdf', 'application/octet-stream']) assert.equal(validatePdfUpload({fileName:'invoice.pdf',mimeType,content:pdf}).mimeType,'application/pdf');
});
test('renamed non-PDF files and unrelated MIME types are rejected',()=>{
  assert.throws(()=>validatePdfUpload({fileName:'invoice.pdf',mimeType:'application/pdf',content:Buffer.from('MZ')}),/not a valid PDF/);
  assert.throws(()=>validatePdfUpload({fileName:'invoice.pdf',mimeType:'text/html',content:pdf}),/not a valid PDF upload/);
});
