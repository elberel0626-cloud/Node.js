import { test, expect, openView } from './fixtures/authenticated.js';

test.describe('professional inventory workflows', () => {
  test('New Item opens a working item master form and creates an item', async ({ page }) => {
    await openView(page, '/inventory/items');
    await expect(page.locator('#piInventoryRoot')).toBeVisible();
    await page.locator('#piNewItem').click();
    await expect(page).toHaveURL(/\/inventory\/items\/new$/);
    await expect(page.locator('#piItemCode')).toBeVisible();

    const code = `E2E-${Date.now()}`;
    await page.locator('#piItemCode').fill(code);
    await page.locator('#piItemDesc').fill('Professional inventory E2E item');
    await page.locator('#piSave').click();
    await expect(page).toHaveURL(new RegExp(`/inventory/items/${code}$`));
    await expect(page.locator('#piInventoryRoot')).toContainText(code);
    await expect(page.locator('#piInventoryRoot')).toContainText('Professional inventory E2E item');
  });

  test('inventory transaction entry uses working Save and Save & Post actions', async ({ page }) => {
    await openView(page, '/inventory/receipts');
    await expect(page.locator('#piInventoryRoot')).toBeVisible();
    await page.locator('#piNewDocument').click();
    await expect(page).toHaveURL(/\/inventory\/receipts\/new$/);
    await expect(page.locator('#piDocLines tbody tr')).toHaveCount(1);
    await expect(page.locator('#piDocSave')).toBeVisible();
    await expect(page.locator('#piDocSavePost')).toBeVisible();
  });

  test('physical count loads stock and calculates variance instead of adding a dead line', async ({ page }) => {
    await openView(page, '/inventory/physical-counts');
    await expect(page.locator('#piNewDocument')).toBeVisible();
    await page.locator('#piNewDocument').click();
    await expect(page).toHaveURL(/\/inventory\/physical-counts\/new$/);
    await expect(page.locator('#piLoadCount')).toBeVisible();
    await page.locator('#piLoadCount').click();
    await expect(page.locator('#piCountStats')).toContainText('counted');
    await expect(page.locator('#piPostCount')).toHaveText('Save & Post Variance');
  });
});
