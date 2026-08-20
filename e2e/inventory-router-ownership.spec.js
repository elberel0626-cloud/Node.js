import { test, expect, openView } from './fixtures/authenticated.js';

test('Inventory V2 owns inventory routes after the ERP router settles', async ({ page }) => {
  await openView(page, '/inventory/items');

  const diagnostics = await page.evaluate(async () => {
    const runtime = [...document.scripts].filter(script => script.src.includes('/inventoryV2.js'));
    const bootstrap = [...document.scripts].filter(script => script.src.includes('/inventoryV2Bootstrap.js'));
    const runtimeResponse = await fetch('/inventoryV2.js', { credentials: 'same-origin', cache: 'no-store' });
    return {
      path: location.pathname,
      bootstrapScripts: bootstrap.length,
      runtimeScripts: runtime.length,
      runtimeStatus: runtimeResponse.status,
      bootstrapState: window.__inventoryV2Bootstrap || null,
      rootPresent: Boolean(document.querySelector('#inventoryV2Root')),
      legacyToolbarPresent: Boolean(document.querySelector('#view .erp-toolbar')),
      legacyNewDocumentPresent: Boolean(document.querySelector('#newInvDoc')),
      viewText: document.querySelector('#view')?.innerText?.slice(0, 500) || ''
    };
  });
  console.log('Inventory runtime diagnostics:', JSON.stringify(diagnostics));

  expect(diagnostics.bootstrapScripts).toBe(1);
  expect(diagnostics.runtimeStatus).toBe(200);
  await expect.poll(async () => page.evaluate(() => window.__inventoryV2Bootstrap?.loaded === true), { timeout: 10000 }).toBe(true);
  await expect(page.locator('#inventoryV2Root')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#view .erp-toolbar')).toHaveCount(0);
  await expect(page.locator('#newInvDoc')).toHaveCount(0);

  await openView(page, '/inventory/receipts');
  await expect(page.locator('#inventoryV2Root')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#iv2NewDoc')).toHaveText('New Receipt');
  await expect(page.locator('#view')).not.toContainText('Select a document in the release process');
  await expect(page.locator('#view .erp-toolbar')).toHaveCount(0);

  await page.locator('#iv2NewDoc').click();
  await expect(page).toHaveURL(/\/inventory\/receipts\/new$/);
  await expect(page.locator('#inventoryV2Root')).toBeVisible();
  await expect(page.locator('#iv2DocPost')).toBeVisible();
  await expect(page.locator('#view .erp-toolbar')).toHaveCount(0);

  await page.waitForTimeout(750);
  await expect(page.locator('#inventoryV2Root')).toBeVisible();
  await expect(page.locator('#view .erp-toolbar')).toHaveCount(0);
});
