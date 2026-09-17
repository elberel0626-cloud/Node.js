export const RGA_STATUSES = Object.freeze([
  'Draft',
  'Awaiting Return',
  'Partially Received',
  'Received',
  'Credit Pending',
  'Credited',
  'Closed',
  'Cancelled',
  'Rejected'
]);

export const RGA_RETURN_REASONS = Object.freeze([
  'Defective',
  'Damaged in Transit',
  'Wrong Item',
  'Customer Return',
  'Warranty',
  'Duplicate Shipment',
  'Other'
]);

const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export const roundMoney = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;

function proportionalTax(line, qty) {
  const invoicedQty = Math.abs(number(line.qty || line.quantity || 0));
  if (!invoicedQty) return 0;
  return roundMoney(number(line.tax || 0) * (number(qty) / invoicedQty));
}

export function rgaLineCreditAmount(line) {
  const qty = Math.max(0, number(line.returnQty));
  const unitPrice = number(line.unitPrice);
  const discountPct = number(line.discountPct);
  const extended = roundMoney(qty * unitPrice);
  const discount = roundMoney(extended * discountPct / 100);
  const tax = line.taxAmount !== undefined
    ? roundMoney(line.taxAmount)
    : roundMoney(number(line.taxPerUnit) * qty);
  return roundMoney(extended - discount + tax);
}

export function calculateRgaTotals(lines = []) {
  const selected = (Array.isArray(lines) ? lines : []).filter(line => number(line.returnQty) > 0);
  const merchandise = roundMoney(selected.reduce((sum, line) => {
    const extended = number(line.returnQty) * number(line.unitPrice);
    return sum + extended - (extended * number(line.discountPct) / 100);
  }, 0));
  const tax = roundMoney(selected.reduce((sum, line) => sum + number(line.taxAmount ?? number(line.taxPerUnit) * number(line.returnQty)), 0));
  return {
    merchandise,
    tax,
    total: roundMoney(merchandise + tax),
    quantity: selected.reduce((sum, line) => sum + number(line.returnQty), 0)
  };
}

export function buildRgaLinesFromInvoice(invoice, committedByLine = {}) {
  if (!invoice || invoice.type !== 'Invoice') throw new Error('RGA requires an original customer invoice.');
  const invoiceLines = Array.isArray(invoice.lines) ? invoice.lines : [];
  return invoiceLines.map((line, index) => {
    const invoiceQty = Math.max(0, number(line.qty || line.quantity));
    const committed = Math.max(0, number(committedByLine[index]));
    const available = Math.max(0, invoiceQty - committed);
    const taxPerUnit = invoiceQty ? roundMoney(number(line.tax || 0) / invoiceQty) : 0;
    return {
      lineId: `RGAL-${index + 1}`,
      invoiceLineIndex: index,
      itemCode: line.itemCode || line.itemId || line.inventoryId || '',
      description: line.description || '',
      uom: line.uom || 'EA',
      invoiceQty,
      alreadyReturnedQty: committed,
      availableToReturnQty: available,
      returnQty: 0,
      receivedQty: 0,
      unitPrice: number(line.unitPrice),
      discountPct: number(line.discountPct),
      taxable: !!line.taxable,
      taxPerUnit,
      taxAmount: 0,
      creditAmount: 0,
      revenueAccount: line.revenueAccount || line.salesAccount || '',
      inventoryAccount: line.inventoryAccount || '',
      cogsAccount: line.cogsAccount || '',
      sourceSalesOrderLineId: line.sourceSalesOrderLineId || ''
    };
  });
}

export function mergeRequestedRgaLines(baseLines = [], requestedLines = []) {
  const requested = new Map((Array.isArray(requestedLines) ? requestedLines : []).map(line => [Number(line.invoiceLineIndex), line]));
  return baseLines.map(line => {
    const req = requested.get(Number(line.invoiceLineIndex)) || {};
    const returnQty = Math.max(0, number(req.returnQty));
    const taxAmount = proportionalTax({ qty: line.invoiceQty, tax: number(line.taxPerUnit) * line.invoiceQty }, returnQty);
    const merged = {
      ...line,
      returnQty,
      reason: req.reason || '',
      condition: req.condition || '',
      taxAmount
    };
    merged.creditAmount = rgaLineCreditAmount(merged);
    return merged;
  });
}

export function validateRgaLines(lines = []) {
  const selected = (Array.isArray(lines) ? lines : []).filter(line => number(line.returnQty) > 0);
  if (!selected.length) throw new Error('Select at least one invoiced line to return.');
  for (const line of selected) {
    const qty = number(line.returnQty);
    const available = number(line.availableToReturnQty);
    if (qty <= 0) throw new Error('Return quantity must be greater than zero.');
    if (qty > available + 1e-9) {
      throw new Error(`${line.itemCode || 'Invoice line'} return quantity cannot exceed ${available}.`);
    }
    if (number(line.unitPrice) < 0) throw new Error('Original invoice price is invalid.');
  }
  return selected;
}

export function rgaReceiptComplete(lines = []) {
  const selected = (Array.isArray(lines) ? lines : []).filter(line => number(line.returnQty) > 0);
  return selected.length > 0 && selected.every(line => number(line.receivedQty) + 1e-9 >= number(line.returnQty));
}

export function rgaRemainingReceiptQty(line) {
  return Math.max(0, number(line.returnQty) - number(line.receivedQty));
}
