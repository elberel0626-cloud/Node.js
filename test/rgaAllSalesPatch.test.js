import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRgaAllSalesPatch } from '../src/rgaAllSalesPatch.js';

test('RGA eligibility keeps paid and closed invoices instead of filtering by returnable status', () => {
  const source = "const rows = arDocuments.filter(doc => doc.type === 'Invoice' && doc.posted && doc.status !== 'Voided' && (!query.customerId || doc.customerId === query.customerId)).map(rgaInvoiceSummary).filter(row => row.returnableLines.some(line => Number(line.availableToReturnQty || 0) > 0));";
  const patched = applyRgaAllSalesPatch(source);
  assert.match(patched, /map\(rgaInvoiceSummary\)\.sort/);
  assert.doesNotMatch(patched, /filter\(row => row\.returnableLines/);
});
