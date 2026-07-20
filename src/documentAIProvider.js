export { DocumentAIProvider } from '../services/document-ai/DocumentAIProvider.js';
export { AzureDocumentAIProvider } from '../services/document-ai/AzureDocumentAIProvider.js';
export { normalizeAzureInvoiceResult, flattenRecognizedInvoice } from '../services/document-ai/RecognitionNormalizer.js';
export { validateInvoiceAccounting } from '../services/document-ai/InvoiceAccountingValidator.js';

import { AzureDocumentAIProvider } from '../services/document-ai/AzureDocumentAIProvider.js';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

class MockDocumentAIProvider {
  async analyzeInvoice(document, mimeType) { const text=document.toString('utf8'); const money=(label,def=0)=>Number((text.match(new RegExp(label+'[ \t]*([0-9]+\\.[0-9]{2})','i'))||[])[1]||def); const content=(label,def='')=>(text.match(new RegExp(label+'[ \t]*[:#-]?[ \t]*([^\\n\\r]*)','i'))||[])[1]?.trim()||def; const isMr=/M\s*&\s*R|MR Printing|M and R/i.test(text); const fields=isMr?{VendorName:{content:'M&R Printing Equipment Inc.',confidence:.98},InvoiceId:{content:content('Invoice Number','1201514'),confidence:.97},InvoiceDate:{content:'2025-11-25',confidence:.96},DueDate:{content:'2025-12-10',confidence:.96},PurchaseOrder:{content:content('CUSTOMER\\s+PO\\s+NUMBER',''),confidence:.91},SubTotal:{valueCurrency:{amount:money('Net Order Value',108.20),currencyCode:'USD'},confidence:.95},Shipping:{valueCurrency:{amount:money('Delivery and Handling',155.53),currencyCode:'USD'},confidence:.94},TotalTax:{valueCurrency:{amount:money('Total Taxes',18.46),currencyCode:'USD'},confidence:.94},InvoiceTotal:{valueCurrency:{amount:282.19,currencyCode:'USD'},confidence:.96},AmountDue:{valueCurrency:{amount:money('Balance Due(?: \(USD\))?',0),currencyCode:'USD'},confidence:.96},Items:{valueArray:[{confidence:.94,valueObject:{ProductCode:{content:'2019092-C'},Description:{content:'1 STA VALVE MFLD ASSY'},Quantity:{valueNumber:1},Unit:{content:'EAC'},UnitPrice:{valueCurrency:{amount:108.20,currencyCode:'USD'}},Amount:{valueCurrency:{amount:108.20,currencyCode:'USD'}}}}]}}:{}; return { providerName: 'mock', providerModel: 'mock-prebuilt-invoice', providerRequestId: `mock-${Date.now()}`, processingDurationMs: 0, analyzeResult: { content: text, pages: [{pageNumber:1}], documents: [{fields,confidence:.95}] }, mimeType }; }
  async analyzeLayout(document, mimeType) { return this.analyzeInvoice(document, mimeType); }
  async extractText(document, mimeType) { const r = await this.analyzeInvoice(document, mimeType); return { text: r.analyzeResult.content, ...r }; }
  async healthCheck() { return { ok: true, provider: 'mock' }; }
}

export { MockDocumentAIProvider };

class LocalPdfDocumentAIProvider {
  async analyzeInvoice(document, mimeType = 'application/pdf') {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ap-local-ai-'));
    const file = path.join(dir, 'invoice.pdf');
    try {
      await writeFile(file, document);
      let text = '';
      let pages = [];
      try { text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }); } catch {}
      try { const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' }); const count = Number((info.match(/Pages:\s*(\d+)/) || [])[1] || 1); pages = Array.from({ length: count }, (_, i) => ({ pageNumber: i + 1 })); } catch { pages = [{ pageNumber: 1 }]; }
      if (!text.trim()) throw new Error('Invoice recognition failed. Please review the document and enter the information manually.');
      return { providerName: 'local-pdf-tools', providerModel: 'pdftotext-layout', providerRequestId: `local-${Date.now()}`, processingDurationMs: 0, analyzeResult: { content: text, pages, documents: [] }, mimeType };
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  async analyzeLayout(document, mimeType) { return this.analyzeInvoice(document, mimeType); }
  async extractText(document, mimeType) { const r = await this.analyzeInvoice(document, mimeType); return { text: r.analyzeResult.content, ...r }; }
  async healthCheck() { return { ok: true, provider: 'local-pdf-tools' }; }
}

export { LocalPdfDocumentAIProvider };

export function createDocumentAIProvider() {
  const provider = String(process.env.DOCUMENT_AI_PROVIDER || 'auto').toLowerCase();
  if (provider === 'mock') return new MockDocumentAIProvider();
  if (provider === 'azure') return new AzureDocumentAIProvider();
  if (provider === 'local') return new LocalPdfDocumentAIProvider();
  if (process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT && process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY) return new AzureDocumentAIProvider();
  return new LocalPdfDocumentAIProvider();
}
