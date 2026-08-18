import { randomUUID } from 'node:crypto';
import { test, expect, openView } from './fixtures/authenticated.js';

test.describe.configure({ mode: 'serial' });

async function api(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const text = await response.text();
    let parsed = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { error: text }; }
    return { status: response.status, body: parsed };
  }, { path, method, body });
}

function bill(invoiceNumber, { unitCost = 37.25, expenseAccount = '5110', taxTotal = 0, freight = 0 } = {}) {
  return {
    type: 'Bill', vendorId: 'VEND-1001', date: '2026-08-17', dueDate: '2026-09-16',
    vendorRef: invoiceNumber, invoiceNumber, branch: '100', terms: 'NET30', taxTotal, freight,
    lines: [{ description: 'AP posting safety test', qty: 1, uom: 'EA', unitCost, discountAmount: 0, expenseAccount, branch: '100' }]
  };
}

async function sourceJournals(page, billId) {
  const journals = await api(page, '/api/finance/journal-transactions');
  expect(journals.status).toBe(200);
  return journals.body.filter(j => j.module === 'AP' && j.sourceRef === billId && !j.reversalOf);
}

test('AP bill posting is idempotent and stores meaningful line descriptions', async ({ page }) => {
  await openView(page, '/ap/bills', '#apBillGrid');
  const invoiceNumber = `SAFE-${randomUUID()}`;
  const created = await api(page, '/api/ap/documents', 'POST', bill(invoiceNumber));
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const billId = created.body.id;

  const first = await api(page, '/api/ap/documents/post', 'POST', { id: billId });
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  expect(first.body.posted).toBe(true);
  expect(first.body.journalEntryNumber).toBeTruthy();

  const firstJournals = await sourceJournals(page, billId);
  expect(firstJournals).toHaveLength(1);
  expect(firstJournals[0].lines.length).toBeGreaterThan(0);
  for (const line of firstJournals[0].lines) {
    expect(line.lineDescription).toBeTruthy();
    expect(line.lineDescription).toContain(billId);
  }
  expect(firstJournals[0].lines.some(line => line.lineDescription.includes(invoiceNumber))).toBe(true);

  const second = await api(page, '/api/ap/documents/post', 'POST', { id: billId });
  expect(second.status, JSON.stringify(second.body)).toBe(200);
  expect(second.body.journalEntryNumber).toBe(first.body.journalEntryNumber);
  expect(await sourceJournals(page, billId)).toHaveLength(1);
});

test('AP bill with tax and freight posts as a balanced single journal', async ({ page }) => {
  await openView(page, '/ap/bills', '#apBillGrid');
  const invoiceNumber = `TAXFREIGHT-${randomUUID()}`;
  const created = await api(page, '/api/ap/documents', 'POST', bill(invoiceNumber, { unitCost: 100, taxTotal: 1.25, freight: 2.50 }));
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const billId = created.body.id;
  expect(created.body.amount).toBe(103.75);

  const posted = await api(page, '/api/ap/documents/post', 'POST', { id: billId });
  expect(posted.status, JSON.stringify(posted.body)).toBe(200);
  const journals = await sourceJournals(page, billId);
  expect(journals).toHaveLength(1);
  const debit = journals[0].lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const credit = journals[0].lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
  expect(Math.round(debit * 100)).toBe(10375);
});

test('failed AP posting leaves no journal and can be corrected and posted once', async ({ page }) => {
  await openView(page, '/ap/bills', '#apBillGrid');
  const invoiceNumber = `ROLLBACK-${randomUUID()}`;
  const created = await api(page, '/api/ap/documents', 'POST', bill(invoiceNumber, { expenseAccount: '999999' }));
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const billId = created.body.id;

  const failed = await api(page, '/api/ap/documents/post', 'POST', { id: billId });
  expect(failed.status).toBe(400);
  expect(failed.body.error).toMatch(/account/i);
  const afterFailure = await api(page, `/api/ap/documents/${billId}`);
  expect(afterFailure.body.posted).toBe(false);
  expect(await sourceJournals(page, billId)).toHaveLength(0);

  const corrected = await api(page, `/api/ap/documents/${billId}`, 'PUT', {
    ...bill(invoiceNumber, { expenseAccount: '5110' }),
    approverUserId: afterFailure.body.approverUserId
  });
  expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
  const posted = await api(page, '/api/ap/documents/post', 'POST', { id: billId });
  expect(posted.status, JSON.stringify(posted.body)).toBe(200);
  expect(await sourceJournals(page, billId)).toHaveLength(1);
});
