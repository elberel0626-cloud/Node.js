import { execFileSync } from 'node:child_process';

export class DocumentAIProvider {
  async analyzeInvoice(file) { return this.extractText(file); }
  async analyzeLayout(file) { return { pages: [], tables: [] }; }
  async extractText(_file) { throw new Error('extractText not implemented'); }
  async healthCheck() { return { ok: true, provider: this.constructor.name }; }
}

export class MockDocumentAIProvider extends DocumentAIProvider {
  async extractText(file) { return { text: file.text || '', pages: [], providerName: 'mock', providerDocumentId: `mock-${Date.now()}` }; }
}

export class LocalPdfDocumentAIProvider extends DocumentAIProvider {
  async extractText(file) {
    let text = '';
    try { text = execFileSync('pdftotext', ['-layout', file.path, '-'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }); } catch {}
    return { text, pages: [], providerName: 'local-pdf-tools', providerDocumentId: `local-${Date.now()}` };
  }
}

export function createDocumentAIProvider() {
  const provider = String(process.env.DOCUMENT_AI_PROVIDER || 'local').toLowerCase();
  if (provider === 'mock') return new MockDocumentAIProvider();
  return new LocalPdfDocumentAIProvider();
}
