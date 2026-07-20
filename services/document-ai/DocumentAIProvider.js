export class DocumentAIProvider {
  async analyzeInvoice(_document, _mimeType) { throw new Error('analyzeInvoice not implemented'); }
  async analyzeLayout(_document, _mimeType) { throw new Error('analyzeLayout not implemented'); }
  async extractText(_document, _mimeType) { throw new Error('extractText not implemented'); }
  async healthCheck() { return { ok: true, provider: this.constructor.name }; }
}
