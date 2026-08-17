import { test, expect, openView } from './fixtures/authenticated.js';

test('vendor approver defaults to the authenticated ERP user and persists', async ({ page }) => {
  await openView(page, '/ap/vendors/VEND-1001', '#vapprover');
  const currentUser = await page.evaluate(async () => (await (await fetch('/api/auth/session')).json()).user);
  await expect(page.locator('#vapprover')).toHaveValue(new RegExp(`^${currentUser.id} — `));

  await page.locator('#vphone').fill('555-1001 ext 1');
  await page.locator('#vSave').click();
  await expect(page.locator('#vapprover')).toHaveValue(new RegExp(`^${currentUser.id} — `));
  await page.reload();
  await expect(page.locator('#vapprover')).toHaveValue(new RegExp(`^${currentUser.id} — `));

  await page.goto('/ap/vendors/new');
  await expect(page.locator('#vapprover')).toHaveValue(new RegExp(`^${currentUser.id} — `));
});
