import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRgaLinesFromInvoice,
  mergeRequestedRgaLines,
  calculateRgaTotals,
  validateRgaLines,
  rgaReceiptComplete,
  rgaRemainingReceiptQty
} from '../src/rgaDomain.js';

const invoice = {
  id:'INV-1001', type:'Invoice',
  lines:[
    { itemCode:'ITEM-1', description:'Press Part', qty:2, unitPrice:100, discountPct:10, tax:18, taxable:true },
    { itemCode:'ITEM-2', description:'Service', qty:1, unitPrice:50, tax:0, taxable:false }
  ]
};

test('builds returnable invoice lines after prior authorized returns', () => {
  const lines = buildRgaLinesFromInvoice(invoice, { 0:1 });
  assert.equal(lines[0].invoiceQty, 2);
  assert.equal(lines[0].alreadyReturnedQty, 1);
  assert.equal(lines[0].availableToReturnQty, 1);
  assert.equal(lines[1].availableToReturnQty, 1);
});

test('uses original invoice price, discount and proportional line tax for credit', () => {
  const base = buildRgaLinesFromInvoice(invoice, {});
  const lines = mergeRequestedRgaLines(base, [{ invoiceLineIndex:0, returnQty:1 }]);
  validateRgaLines(lines);
  const totals = calculateRgaTotals(lines);
  assert.equal(totals.merchandise, 90);
  assert.equal(totals.tax, 9);
  assert.equal(totals.total, 99);
  assert.equal(lines[0].creditAmount, 99);
});

test('allocates invoice header tax to taxable lines when line tax is not stored', () => {
  const headerTaxInvoice = {
    id:'INV-HEADER-TAX',
    type:'Invoice',
    taxTotal:16,
    lines:[
      { itemCode:'ITEM-A', description:'Taxable A', qty:2, unitPrice:100, discountPct:0, taxable:true },
      { itemCode:'ITEM-B', description:'Non-taxable service', qty:1, unitPrice:50, taxable:false }
    ]
  };
  const base = buildRgaLinesFromInvoice(headerTaxInvoice, {});
  assert.equal(base[0].originalLineTax, 16);
  assert.equal(base[0].taxPerUnit, 8);
  assert.equal(base[1].originalLineTax, 0);
  const lines = mergeRequestedRgaLines(base, [{ invoiceLineIndex:0, returnQty:1 }]);
  const totals = calculateRgaTotals(lines);
  assert.equal(totals.merchandise, 100);
  assert.equal(totals.tax, 8);
  assert.equal(totals.total, 108);
  assert.equal(lines[0].creditAmount, 108);
});

test('allocates header tax proportionally across multiple taxable lines', () => {
  const headerTaxInvoice = {
    id:'INV-MULTI-TAX',
    type:'Invoice',
    taxTotal:24,
    lines:[
      { itemCode:'ITEM-A', qty:1, unitPrice:100, taxable:true },
      { itemCode:'ITEM-B', qty:1, unitPrice:200, taxable:true }
    ]
  };
  const base = buildRgaLinesFromInvoice(headerTaxInvoice, {});
  assert.equal(base[0].originalLineTax, 8);
  assert.equal(base[1].originalLineTax, 16);
  const lines = mergeRequestedRgaLines(base, [{ invoiceLineIndex:1, returnQty:1 }]);
  assert.equal(calculateRgaTotals(lines).total, 216);
});

test('rejects return quantity above invoice quantity remaining', () => {
  const base = buildRgaLinesFromInvoice(invoice, { 0:1 });
  const lines = mergeRequestedRgaLines(base, [{ invoiceLineIndex:0, returnQty:2 }]);
  assert.throws(() => validateRgaLines(lines), /cannot exceed 1/);
});

test('requires at least one returned invoice line', () => {
  const base = buildRgaLinesFromInvoice(invoice, {});
  assert.throws(() => validateRgaLines(base), /Select at least one/);
});

test('tracks partial and complete warehouse receipt quantities', () => {
  const lines = [{ returnQty:2, receivedQty:1 }, { returnQty:1, receivedQty:1 }];
  assert.equal(rgaReceiptComplete(lines), false);
  assert.equal(rgaRemainingReceiptQty(lines[0]), 1);
  lines[0].receivedQty = 2;
  assert.equal(rgaReceiptComplete(lines), true);
});
