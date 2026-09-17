import { randomUUID } from 'node:crypto';
import { test, expect, openView } from './fixtures/authenticated.js';

test.describe.configure({ mode: 'serial' });

async function api(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin'
    });
    const parsed = await response.json();
    return { status: response.status, body: parsed };
  }, { path, method, body });
}

async function createPostedBill(page, amount) {
  const invoiceNumber = `PAYFLOW-${randomUUID()}`;
  const bill = await api(page, '/api/ap/documents', 'POST', {
    type: 'Bill', vendorId: 'VEND-1001', date: '2026-08-17', dueDate: '2026-09-16',
    vendorRef: invoiceNumber, invoiceNumber, terms: 'NET30',
    lines: [{ description: 'AP payment flow', qty: 1, uom: 'EA', unitCost: amount, expenseAccount: '5110' }]
  });
  expect(bill.status, JSON.stringify(bill.body)).toBe(201);
  expect((await api(page, '/api/ap/documents/post', 'POST', { id: bill.body.id })).status).toBe(200);
  return bill.body;
}

test('Pay Bill opens a preselected payment and checked bills drive applied and payment totals', async ({ page }) => {
  await openView(page, '/ap/bills', '#apBillGrid');
  const firstBill = await createPostedBill(page, 48.75);
  const secondBill = await createPostedBill(page, 21.25);

  await openView(page, `/ap/bills/${firstBill.id}`, '#bActions');
  await expect(page.locator("#bActions option[value='pay-bill']")).toHaveCount(1);
  await page.locator('#bActions').selectOption('pay-bill');

  await expect(page).toHaveURL(new RegExp(`/ap/payments/new\\?billId=${firstBill.id}`));
  await expect(page.locator('#pVendorNumber')).toHaveValue('VEND-1001');
  await expect(page.locator(`.pickDoc[data-id='${firstBill.id}']`)).toBeChecked();
  await expect(page.locator(`.amtPaid[data-id='${firstBill.id}']`)).toHaveValue('48.75');
  await expect(page.locator('#pAmount')).toHaveValue('48.75');
  await expect(page.locator('#pApplied')).toHaveValue('48.75');
  await expect(page.locator('#pUnap')).toHaveValue('0.00');

  await expect(page.locator(`.amtPaid[data-id='${secondBill.id}']`)).toBeVisible();
  await page.locator(`.pickDoc[data-id='${secondBill.id}']`).check();

  await expect(page.locator(`.amtPaid[data-id='${secondBill.id}']`)).toHaveValue('21.25');
  await expect(page.locator('#pAmount')).toHaveValue('70.00');
  await expect(page.locator('#pApplied')).toHaveValue('70.00');
  await expect(page.locator('#pUnap')).toHaveValue('0.00');

  await page.locator('#pSave').click();
  await expect(page).toHaveURL(/\/ap\/payments\/PAY-AP-/);
  await page.locator('#pPost').click();
  await expect(page.locator('#pStatus')).toHaveValue('Closed');

  for (const bill of [firstBill, secondBill]) {
    const postedBill = await api(page, `/api/ap/documents/${bill.id}`);
    expect(postedBill.body.balance).toBe(0);
    expect(postedBill.body.status).toBe('Closed');
  }
});
