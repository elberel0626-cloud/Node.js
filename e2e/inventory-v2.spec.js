import { test, expect, openView } from './fixtures/authenticated.js';

test.describe('inventory v2 real ERP workflows', () => {
  test('item class defaults and full receipt/issue/transfer/adjust/count lifecycle work', async ({ page }) => {
    const code = `INV-V2-${Date.now()}`;

    await openView(page, '/inventory/items');
    await expect(page.locator('#inventoryV2Root')).toBeVisible();
    await expect(page.locator('#ar-nav')).toContainText('Manage');
    await expect(page.locator('#ar-nav .nav-group').filter({ hasText: 'Manage' })).toContainText('Inventory Items');
    await page.locator('#iv2NewItem').click();
    await expect(page).toHaveURL(/\/inventory\/items\/new$/);
    await expect(page.locator('.iv2-toolbar button')).toHaveCount(3);
    await page.locator('#iv2ItemClass').selectOption('SERVICE-PARTS');
    await expect(page.locator('#iv2Warehouse')).toHaveValue('SERVICE');
    await expect(page.locator('#iv2BaseUom')).toHaveValue('EA');
    await page.locator('#iv2ItemClass').selectOption('INDUSTRIAL-EQUIPMENT');
    await expect(page.locator('#iv2Warehouse')).toHaveValue('MAIN');
    await expect(page.locator('#iv2Location')).toHaveValue('MAIN-A1');
    await expect(page.locator('#iv2Tracking')).toHaveValue('Serial');
    await page.locator('#iv2ItemCode').fill(code);
    await page.locator('#iv2ItemDesc').fill('Industrial equipment test item');
    await page.locator('#iv2StdCost').fill('25');
    await page.locator('#iv2ItemSave').click();
    await expect(page).toHaveURL(new RegExp(`/inventory/items/${code}$`));
    await expect(page.locator('.iv2-toolbar button')).toHaveCount(3);
    await expect(page.locator('#inventoryV2Root')).not.toContainText('Actions');
    await expect(page.locator('#inventoryV2Root')).not.toContainText('Inquiries');
    await expect(page.locator('#inventoryV2Root')).not.toContainText('Reports');

    await openView(page, '/inventory/receipts');
    await expect(page.locator('#inventoryV2Root')).toBeVisible();
    await expect(page.locator('#iv2NewDoc')).toHaveText('New Receipt');
    await expect(page.locator('#inventoryV2Root')).not.toContainText('Select a document in the release process');
    await page.locator('#iv2NewDoc').click();
    await expect(page).toHaveURL(/\/inventory\/receipts\/new$/);
    await expect(page.locator('h3')).toContainText('New Receipt');
    await page.locator('.iv2-line-item').fill(code);
    await page.locator('.iv2-line-item').dispatchEvent('input');
    await page.locator('.iv2-line-qty').fill('10');
    await page.locator('.iv2-line-cost').fill('25');
    await page.locator('#iv2DocPost').click();
    await expect(page.locator('#inventoryV2Root')).toContainText('Status: Posted');

    await openView(page, '/inventory/issues');
    await page.locator('#iv2NewDoc').click();
    await page.locator('.iv2-line-item').fill(code);
    await page.locator('.iv2-line-item').dispatchEvent('input');
    await page.locator('.iv2-line-qty').fill('2');
    await page.locator('#iv2DocPost').click();
    await expect(page.locator('#inventoryV2Root')).toContainText('Status: Posted');

    await openView(page, '/inventory/transfers');
    await page.locator('#iv2NewDoc').click();
    await page.locator('.iv2-line-item').fill(code);
    await page.locator('.iv2-line-item').dispatchEvent('input');
    await page.locator('.iv2-line-qty').fill('3');
    await page.locator('#iv2ToWh').selectOption('PROD');
    await expect(page.locator('#iv2ToLoc')).toHaveValue('PROD-WIP');
    await page.locator('#iv2DocPost').click();
    await expect(page.locator('#inventoryV2Root')).toContainText('Status: Posted');

    await openView(page, '/inventory/adjustments');
    await page.locator('#iv2NewDoc').click();
    await page.locator('.iv2-line-item').fill(code);
    await page.locator('.iv2-line-item').dispatchEvent('input');
    await page.locator('.iv2-line-qty').fill('1');
    await expect(page.locator('.iv2-line-newqty')).not.toHaveText('—');
    await page.locator('#iv2DocPost').click();
    await expect(page.locator('#inventoryV2Root')).toContainText('Status: Posted');

    await openView(page, '/inventory/physical-counts');
    await page.locator('#iv2NewDoc').click();
    await expect(page).toHaveURL(/\/inventory\/physical-counts\/new$/);
    const row = page.locator(`#iv2CountTable tbody tr[data-item='${code}']`);
    await expect(row).toBeVisible();
    const systemQty = Number(await row.getAttribute('data-system-qty'));
    await row.locator('.iv2-counted').fill(String(systemQty + 1));
    await expect(row.locator('.iv2-variance')).toHaveText('1');
    await page.locator('#iv2CountPost').click();
    await expect(page.locator('#inventoryV2Root')).toContainText('Status: Posted');

    await openView(page, '/inventory/summary');
    await expect(page.locator('#inventoryV2Root')).toContainText(code);
    await openView(page, '/inventory/transactions');
    await expect(page.locator('#inventoryV2Root')).toContainText(code);
  });
});
