import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateApBillTotals, evaluateApInvoice } from '../src/apInvoiceEvaluation.js';

const rentLines=[
  70346.54,8061.08,2165.01,15660.60,1704.84,1406.93,-1261.33,-4157.68
].map((unitCost,index)=>({description:`Rent line ${index+1}`,qty:1,unitCost,discountAmount:0,expenseAccount:'5110'}));

test('AP bill totals allow signed credit and reconciliation lines',()=>{
  const totals=calculateApBillTotals(rentLines);
  assert.equal(totals.invoiceTotal,93925.99);
  assert.equal(totals.lines.length,8);
  assert.ok(totals.lines.some(line=>line.unitCost<0));
});

test('non-PO invoice evaluation accepts negative reconciliation lines',()=>{
  const result=evaluateApInvoice({
    vendor:{id:'VEND-1001'},
    invoice:{invoiceNumber:'07312026',date:'2026-07-31',currency:'USD',branch:'100'},
    lines:rentLines
  });
  assert.equal(result.classification,'Non-PO Expense Invoice');
  assert.equal(result.totals.invoiceTotal,93925.99);
  assert.equal(result.approvalRequirement,'Approval Required');
});
