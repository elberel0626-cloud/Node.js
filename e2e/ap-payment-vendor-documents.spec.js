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

test('vendor focus loads choices and selection loads, applies, saves, and posts open AP documents', async ({ page }) => {
  await openView(page, '/ap/bills', '#apBillGrid');
  const invoiceNumber = `PAYFLOW-${randomUUID()}`;
  const bill = await api(page, '/api/ap/documents', 'POST', {
    type: 'Bill', vendorId: 'VEND-1001', date: '2026-08-17', dueDate: '2026-09-16',
    vendorRef: invoiceNumber, invoiceNumber, terms: 'NET30',
    lines: [{ description: 'AP payment flow', qty: 1, uom: 'EA', unitCost: 48.75, expenseAccount: '5110' }]
  });
  expect(bill.status, JSON.stringify(bill.body)).toBe(201);
  expect((await api(page, '/api/ap/documents/post', 'POST', { id: bill.body.id })).status).toBe(200);

  await openView(page, '/ap/payments/new', '#pVendorNumber');
  await expect(page.locator("label:has(#pBranch)")).toBeHidden();
  await page.locator('#pVendorNumber').fill('');
  await page.locator('#pVendorNumber').click();
  await expect(page.locator('.party-suggestions .erp-lookup-row').first()).toBeVisible();
  await page.locator('#pVendorNumber').fill('VEND-1001');
  await page.locator('.party-suggestions .erp-lookup-row').first().click();
  await expect(page.locator(`.amtPaid[data-id='${bill.body.id}']`)).toBeVisible();

  await page.locator('#pAmount').fill('48.75');
  await page.locator(`.pickDoc[data-id='${bill.body.id}']`).check();
  await expect(page.locator(`.amtPaid[data-id='${bill.body.id}']`)).toHaveValue('48.75');
  await page.locator('#pSave').click();
  await expect(page).toHaveURL(/\/ap\/payments\/PAY-AP-/);
  await page.locator('#pPost').click();
  await expect(page.locator('#pStatus')).toHaveValue('Closed');

  const postedBill = await api(page, `/api/ap/documents/${bill.body.id}`);
  expect(postedBill.body.balance).toBe(0);
  expect(postedBill.body.status).toBe('Closed');
});

