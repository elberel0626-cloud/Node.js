import { test, expect, openView } from './fixtures/authenticated.js';

const cases = [
  ['/ar/invoices', 'invGrid', '/ar/doc/'],
  ['/ar/payments', 'payGrid', '/ar/doc/'],
  ['/ar/processes/release', 'relGrid', '/ar/doc/'],
  ['/ap/bills', 'apBillGrid', '/ap/bills/'],
  ['/ap/payments', 'apPayGrid', '/ap/payments/'],
  ['/ap/vendors', 'apVend', '/ap/vendors/'],
  ['/finance/journal', 'jeGrid', '/finance/journal/'],
  ['/purchase-orders/orders', 'poGrid', '/purchase-orders/orders/'],
  ['/purchase-orders/receipts', 'poReceiptsGrid', '/purchase-orders/receipts/'],
  ['/inventory/items', 'invItemsGrid', '/inventory/items/'],
  ['/sales-orders/orders', 'soGrid', '/sales-orders/orders/'],
  ['/sales-orders/shipments', 'shipGrid', '/sales-orders/shipments/']
];

for (const [listUrl, gridId, detailPrefix] of cases) {
  test(`${listUrl} owns its record navigation context`, async ({ page }) => {
    await openView(page,listUrl,`#${gridId}`);
    const links = page.locator(`#${gridId} a[href^='${detailPrefix}']`);
    const count = await links.count();
    test.skip(count < 2, `Seed data has fewer than two records in ${listUrl}`);
    const first = await links.nth(0).getAttribute('href');
    const second = await links.nth(1).getAttribute('href');
    await links.nth(1).click();
    await expect(page).toHaveURL(new RegExp(`${second.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    await page.locator('#prevRec').click();
    await expect(page).toHaveURL(new RegExp(`${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    expect(page.url()).toContain(detailPrefix);
  });
}

test('direct detail URL disables stale navigation', async ({ page }) => {
  await openView(page,'/ar/invoices','#invGrid');
  const href = await page.locator('#invGrid a[href^="/ar/doc/"]').first().getAttribute('href');
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(href);
  for (const id of ['firstRec', 'prevRec', 'nextRec', 'lastRec']) await expect(page.locator(`#${id}`)).toBeDisabled();
});

test('cross-module context is replaced by AR Documents to Post', async ({ page }) => {
  await openView(page,'/ap/bills','#apBillGrid');
  await page.locator('#apBillGrid a[href^="/ap/bills/"]').first().click();
  await openView(page,'/ar/processes/release','#relGrid');
  const links = page.locator('#relGrid a[href^="/ar/doc/"]');
  test.skip(await links.count() < 2, 'Seed data has fewer than two releasable AR documents');
  await links.first().click();
  await page.locator('#nextRec').click();
  await expect(page).toHaveURL(/\/ar\/doc\//);
  await page.locator('#saveClose').click();
  await expect(page).toHaveURL(/\/ar\/processes\/release$/);
});
