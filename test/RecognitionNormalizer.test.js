import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAzureDate, normalizeAzureInvoiceResult, flattenRecognizedInvoice } from '../services/document-ai/RecognitionNormalizer.js';
import { validateInvoiceAccounting } from '../services/document-ai/InvoiceAccountingValidator.js';

test('invoice date extraction from valueDate and content', () => {
  assert.equal(extractAzureDate({ valueDate: '2025-11-25', content: 'wrong' }), '2025-11-25');
  assert.equal(extractAzureDate({ content: '25-Nov-2025' }), '2025-11-25');
});

test('due-date extraction and invoice normalization fields', () => {
  const normalized = normalizeAzureInvoiceResult({ providerName:'t', providerModel:'prebuilt-invoice', analyzeResult:{ content:'', documents:[{ fields:{ InvoiceDate:{content:'Nov 25, 2025',confidence:.95}, DueDate:{valueString:'12/10/2025',confidence:.9}, InvoiceId:{content:'INV-1'}, InvoiceTotal:{valueCurrency:{amount:120,currencyCode:'USD'}}, TotalTax:{valueCurrency:{amount:10}}, SubTotal:{valueCurrency:{amount:100}}, Shipping:{valueCurrency:{amount:10}}, Items:{valueArray:[{valueObject:{Description:{content:'Line'},Quantity:{valueNumber:1},UnitPrice:{valueCurrency:{amount:100}},Amount:{valueCurrency:{amount:100}}}}]} }}] }});
  const flat = flattenRecognizedInvoice(normalized);
  assert.equal(flat.invoiceDate, '2025-11-25');
  assert.equal(flat.dueDate, '2025-12-10');
  assert.equal(flat.lines.length, 1);
});

test('invoice-total calculation and header-line variance', () => {
  const result = validateInvoiceAccounting({ merchandiseSubtotal: 100, freightAmount: 10, taxAmount: 5, discount: 2, grossInvoiceAmount: 113, prepaymentApplied: 13, amountDue: 100 });
  assert.equal(result.grossValid, true);
  assert.equal(result.expectedGross, 113);
});
