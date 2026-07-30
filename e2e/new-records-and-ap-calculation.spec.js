import { test, expect, openView } from './fixtures/authenticated.js';

const newCases = [
  ['/ar/payments', '/ar/payments/new', /\/ar\/payments\/new$/],
  ['/ar/customers', '/ar/customers/new', /\/ar\/customers\/new$/],
  ['/ap/bills', '/ap/bills/new', /\/ap\/bills\/new$/],
  ['/ap/payments', '/ap/payments/new', /\/ap\/payments\/new$/],
  ['/ap/vendors', '/ap/vendors/new', /\/ap\/vendors\/new$/],
  ['/purchase-orders/orders', '/purchase-orders/orders/new', /\/purchase-orders\/orders\/new$/],
  ['/sales-orders/orders', '/sales-orders/orders/new', /\/sales-orders\/orders\/new$/]
];

for (const [list, href, url] of newCases) {
  test(`${list}: new-record link opens its entry screen`, async ({ page }) => {
    await openView(page, list);
    const link = page.locator(`a[href='${href}']`).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(url);
    await expect(page.locator('#view')).not.toBeEmpty();
  });
}

test('AR New menu opens invoice, credit memo, and debit memo', async ({ page }) => {
  for (const [label, path] of [
    ['Invoice', '/ar/invoices/new'],
    ['Credit Memo', '/ar/credit-memos/new'],
    ['Debit Memo', '/ar/debit-memos/new']
  ]) {
    await openView(page, '/ar/invoices', '#invGrid');
    await page.locator('.new-record-menu summary').click();
    await page.locator(`.new-record-menu a[data-record-type='${label}']`).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator('#dtype')).toHaveValue(label);
  }
});

async function setNumberInput(locator, value) {
  await locator.evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('AP Bill line edits calculate and save the server total', async ({ page }) => {
  await openView(page, '/ap/bills', '#apBillGrid');
  await page.locator("a[href='/ap/bills/new']").first().click();
  await expect(page).toHaveURL(/\/ap\/bills\/new$/);
  await page.locator(".erp-tabs .tab[data-tab='billLines']").click();
  await expect(page.locator('#billLines')).toBeVisible();

  await page.locator('#bVendorNumber').fill('VEND-1001');
  await expect(page.locator('.party-suggestions .erp-lookup-row').first()).toBeVisible();
  await page.locator('.party-suggestions .erp-lookup-row').first().click();
  await page.locator('#bvendref').fill(`E2E-${crypto.randomUUID()}`);

  await setNumberInput(page.locator('.ln-qty').first(), 2);
  await setNumberInput(page.locator('.ln-cost').first(), 125.50);
  await setNumberInput(page.locator('.ln-disc').first(), 1);
  await page.locator('#bAddManual').click();
  await setNumberInput(page.locator('.ln-qty').nth(1), 3);
  await setNumberInput(page.locator('.ln-cost').nth(1), 10);

  await expect(page.locator('#bamt')).toHaveValue('280.00');
  await expect(page.locator('#bbal')).toHaveValue('280.00');
  await page.locator('#bSave').click();
  await expect(page).toHaveURL(/\/ap\/bills\/BILL-/);
});
