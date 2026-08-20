import { test, expect, openView } from './fixtures/authenticated.js';

async function openCustomizeNavigation(page) {
  await page.locator('#customizeNavBtn').click();
  await expect(page.locator('.cn-modal')).toBeVisible();
}

test('saved AP navigation discovers new functions and preserves existing order', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('nav_pref_AP', JSON.stringify([
    { route: '/ap/bills', label: 'Old Bills Label', section: 'Old', visible: true, order: 0, pinned: false },
    { route: '/ap', label: 'Old Overview Label', section: 'Old', visible: true, order: 1, pinned: false }
  ])));
  await openView(page, '/ap');

  await expect(page.locator('#ar-nav a')).toHaveText(['AP Overview', 'Bills and Adjustments']);
  await openCustomizeNavigation(page);
  const newItem = page.locator('.cn-row', { hasText: 'Cash Purchases' });
  await expect(newItem).toBeVisible();
  await expect(newItem.locator('.cn-vis')).not.toBeChecked();
  await newItem.locator('.cn-switch').click();
  await page.locator('#cnSave').click();

  await expect(page.locator("#ar-nav a[href='/ap/cash-purchases']")).toBeVisible();
  await openCustomizeNavigation(page);
  await page.locator('.cn-row', { hasText: 'Cash Purchases' }).locator('.cn-switch').click();
  await page.locator('#cnSave').click();
  await expect(page.locator("#ar-nav a[href='/ap/cash-purchases']")).toHaveCount(0);
});

test('registered Finance routes are discoverable and can be enabled', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('nav_pref_Finance', JSON.stringify([
    { route: '/finance', label: 'Overview', section: 'Overview', visible: true, order: 0, pinned: false },
    { route: '/finance/journal', label: 'Journal Transactions', section: 'Enter', visible: true, order: 1, pinned: false }
  ])));
  await openView(page, '/finance');
  await openCustomizeNavigation(page);

  for (const label of ['Reclassify', 'Allocations', 'Recurring Transactions', 'Financial Periods (Year-End)']) {
    await expect(page.locator('.cn-row', { hasText: label })).toBeVisible();
  }
  await page.locator('.cn-row', { hasText: 'Allocations' }).locator('.cn-switch').click();
  await page.locator('#cnSave').click();

  const allocationLink = page.locator("#ar-nav a[href='/finance/allocations']");
  await expect(allocationLink).toBeVisible();
  await allocationLink.click();
  await expect(page).toHaveURL(/\/finance\/allocations$/);
  await expect(page.locator('#view')).not.toBeEmpty();
});
