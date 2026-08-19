import { test, expect, openView } from './fixtures/authenticated.js';

test('incoming document verification GL account lookup searches code and name', async ({ page }) => {
  await openView(page, '/ap/incoming-documents');
  const documentId = await page.evaluate(async () => {
    const response = await fetch('/api/ap/incoming-documents');
    const rows = await response.json();
    return rows.find(row => row.extracted?.lines?.length && !row.billId && row.status !== 'Split')?.id || '';
  });
  test.skip(!documentId, 'No incoming document with recognized lines is available in the current test data.');

  await openView(page, `/ap/incoming-documents/${encodeURIComponent(documentId)}/review`, '#invoiceReviewForm');
  const accountInput = page.locator("input[data-line-field='glAccountSuggestion']").first();
  await expect(accountInput).toBeVisible();
  await accountInput.fill('office');
  const suggestion = page.locator('.incoming-gl-account-suggestions .erp-lookup-row').filter({ hasText: /office/i }).first();
  await expect(suggestion).toBeVisible();
  await expect(suggestion.locator('.erp-lookup-id')).not.toBeEmpty();
  await expect(suggestion.locator('.erp-lookup-name')).not.toBeEmpty();
  const selectedCode = (await suggestion.locator('.erp-lookup-id').textContent())?.trim();
  const selectedName = (await suggestion.locator('.erp-lookup-name').textContent())?.trim();
  await suggestion.click();
  await expect(accountInput).toHaveValue(selectedCode || '');
  await expect(accountInput.locator('xpath=..').locator('.incoming-gl-account-name')).toContainText(selectedName || '');
});
