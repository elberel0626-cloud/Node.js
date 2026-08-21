import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const balanceFix=await readFile(new URL('../public/arInvoiceBalanceFix.js',import.meta.url),'utf8');
const invoicePdf=await readFile(new URL('../src/invoicePdf.js',import.meta.url),'utf8');

test('posted AR detail keeps original amount separate from remaining balance',()=>{
  assert.match(balanceFix,/POSTED_STATUSES=new Set\(\['Open','Closed','Voided'\]\)/);
  assert.match(balanceFix,/amountInput\.value=Number\(doc\.amount\?\?doc\.grandTotal\?\?0\)\.toFixed\(2\)/);
  assert.match(balanceFix,/balanceInput\.value=Number\(doc\.balance\?\?doc\.amount\?\?doc\.grandTotal\?\?0\)\.toFixed\(2\)/);
});

test('professional AR PDF shows original document total and current balance due separately',()=>{
  assert.match(invoicePdf,/grand=Number\(invoice\.amount\?\?invoice\.grandTotal/);
  assert.match(invoicePdf,/Invoice Total \(USD\)/);
  assert.match(invoicePdf,/pdfMoney\(grand\)/);
  assert.match(invoicePdf,/Balance Due \(USD\)/);
  assert.match(invoicePdf,/pdfMoney\(balance\)/);
});
