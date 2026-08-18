import { test, expect, openView } from './fixtures/authenticated.js';

async function createJournal(page, description, amount = 40) {
  return page.evaluate(async ({ description, amount }) => {
    const response = await fetch('/api/finance/journal-transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionDate: '2026-05-20', description, lines: [{ account: '1079', branch: '100', debit: amount, credit: 0 }, { account: '2010', branch: '100', debit: 0, credit: amount }] }) });
    return response.json();
  }, { description, amount });
}

test('saved journals can be selected, bulk posted, linked, and posted exactly once', async ({ page }) => {
  await openView(page, '/finance/journal', '#jeGrid');
  const first = await createJournal(page, 'Bulk posting test A', 41);
  const second = await createJournal(page, 'Bulk posting test B', 42);
  await openView(page, '/finance/processes/post-journals', '#journalPostGrid');
  const firstRow = page.locator('#journalPostGrid tbody tr').filter({ hasText: first.jeNumber });
  const secondRow = page.locator('#journalPostGrid tbody tr').filter({ hasText: second.jeNumber });
  await expect(firstRow).toContainText('Ready to post');await expect(secondRow).toContainText('Ready to post');
  await expect(firstRow.locator(`a[href='/finance/journal/${first.jeNumber}']`)).toHaveCount(1);
  await firstRow.locator('.grid-row').check();await expect(page.locator('#journalPostSelected')).toBeEnabled();
  page.once('dialog', dialog => dialog.accept());await page.locator('#journalPostSelected').click();
  await expect(page.locator('#journalPostResults')).toContainText('1 posted; 0 failed');
  await expect(page.locator('#journalPostGrid tbody tr').filter({ hasText: first.jeNumber })).toHaveCount(0);
  await expect(page.locator('#journalPostGrid tbody tr').filter({ hasText: second.jeNumber })).toHaveCount(1);
  const duplicate = await page.evaluate(async jeNumber => (await fetch('/api/finance/journal-transactions/post-selected', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jeNumbers: [jeNumber] }) })).json(), first.jeNumber);
  expect(duplicate.posted).toBe(0);expect(duplicate.alreadyPosted).toBe(1);
  await secondRow.locator('a').click();await expect(page).toHaveURL(`/finance/journal/${second.jeNumber}`);

  const third = await createJournal(page, 'Bulk posting test C', 44);
  await openView(page, '/finance/processes/post-journals', '#journalPostGrid');
  await page.locator('#journalPostGrid tbody tr').filter({ hasText: second.jeNumber }).locator('.grid-row').check();
  await page.locator('#journalPostGrid tbody tr').filter({ hasText: third.jeNumber }).locator('.grid-row').check();
  page.once('dialog', dialog => dialog.accept());await page.locator('#journalPostSelected').click();
  await expect(page.locator('#journalPostResults')).toContainText('2 posted; 0 failed');
  await expect(page.locator('#journalPostGrid tbody tr').filter({ hasText: second.jeNumber })).toHaveCount(0);
  await expect(page.locator('#journalPostGrid tbody tr').filter({ hasText: third.jeNumber })).toHaveCount(0);
});

test('valid and invalid journals are isolated in one bulk request', async ({ page }) => {
  await openView(page, '/finance/journal', '#jeGrid');
  const valid = await createJournal(page, 'Bulk posting valid isolation', 43);
  const result = await page.evaluate(async jeNumber => (await fetch('/api/finance/journal-transactions/post-selected', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jeNumbers: [jeNumber, 'JE-NOT-FOUND'] }) })).json(), valid.jeNumber);
  expect(result.posted).toBe(1);expect(result.failed).toBe(1);expect(result.results.find(row => row.jeNumber === 'JE-NOT-FOUND').message).toContain('not found');
});
