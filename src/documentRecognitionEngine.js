// DocumentRecognitionEngine defines the AP-embedded recognition service contract.
// The runtime implementation in server.js wires these capabilities directly to
// AP bills, vendors, purchase orders, receipts, inventory, accounts, periods,
// approval workflow, and attachments rather than creating a separate OCR silo.
export class DocumentRecognitionEngine {
  constructor({ processDocument, extractFields, findVendor, findPO, extractLines, learnCorrection } = {}) {
    this.processDocument = processDocument;
    this.extractFields = extractFields;
    this.findVendor = findVendor;
    this.findPO = findPO;
    this.extractLines = extractLines;
    this.learnCorrection = learnCorrection;
  }

  ProcessDocument(document) { return this.processDocument?.(document); }
  ExtractFields(text, fileName) { return this.extractFields?.(text, fileName); }
  FindVendor(extracted) { return this.findVendor?.(extracted); }
  FindPO(extracted, vendor) { return this.findPO?.(extracted, vendor); }
  ExtractLines(text) { return this.extractLines?.(text); }
  LearnCorrection(correction) { return this.learnCorrection?.(correction); }
}
