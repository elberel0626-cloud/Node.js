import { test, expect, openView } from './fixtures/authenticated.js';

test('Banking shows only its coming-soon screen with no module navigation', async ({ page }) => {
  await openView(page, '/banking');

  await expect(page.locator('#title')).toHaveText('Banking');
  await expect(page.locator('#ar-nav')).toBeEmpty();
  await expect(page.locator('#customizeNavBtn')).toHaveCount(0);
  await expect(page.locator('#view')).toContainText('Coming Soon');
});
