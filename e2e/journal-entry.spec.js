import { test, expect, openView } from './fixtures/authenticated.js';

async function setLineCount(page, count) {
  while (await page.locator('#jlines tr').count() - 1 < count) await page.locator('#addJl').click();
  while (await page.locator('#jlines tr').count() - 1 > count) await page.locator('.new-je-remove').last().click();
  await expect(page.locator('#jlines tr')).toHaveCount(count + 1);
}

async function expectWorkspaceContainsJournal(page) {
  const geometry = await page.evaluate(() => {
    const workspace = document.querySelector('.new-journal-entry-screen').getBoundingClientRect();
    const grid = document.querySelector('.new-je-lines-scroll').getBoundingClientRect();
    const finalLine = document.querySelector('#jlines tr:last-child').getBoundingClientRect();
    const actions = document.querySelector('.new-je-actions').getBoundingClientRect();
    return {
      workspaceBottom: workspace.bottom,
      gridLeft: grid.left,
      gridRight: grid.right,
      gridTop: grid.top,
      workspaceTop: workspace.top,
      finalLineBottom: finalLine.bottom,
      actionsTop: actions.top,
      actionsBottom: actions.bottom,
      pageCanScroll: document.documentElement.scrollHeight >= window.innerHeight,
    };
  });
  expect(geometry.actionsBottom).toBeLessThanOrEqual(geometry.workspaceBottom + 1);
  expect(geometry.actionsTop).toBeGreaterThanOrEqual(geometry.workspaceTop);
  expect(geometry.actionsBottom).toBeLessThan(geometry.gridTop);
  expect(geometry.finalLineBottom).toBeLessThan(geometry.workspaceBottom);
  expect(geometry.gridLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.gridRight).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  expect(geometry.pageCanScroll).toBe(true);
}

test('manual JE workspace grows and line descriptions survive save and post', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openView(page, '/finance/journal/new', '#newJe');
  await expect(page.locator('#newJeBack')).toBeVisible();
  await expect(page.locator('.new-je-actions')).toContainText('Save & Close');

  for (const count of [1, 10, 25, 50]) {
    await setLineCount(page, count);
    await expectWorkspaceContainsJournal(page);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expectWorkspaceContainsJournal(page);
  await setLineCount(page, 25);

  const rows = page.locator('#jlines tr').filter({ has: page.locator('td') });
  await rows.nth(0).locator('.dr').fill('125.50');
  await rows.nth(1).locator('.cr').fill('125.50');
  await rows.nth(0).locator('.line-desc').fill('Monthly accrual, operations.');
  await rows.nth(1).locator('.line-desc').fill('Offset to accrued liabilities.');

  await page.locator('#saveDoc').click();
  await expect(page).toHaveURL(/\/finance\/journal\/JE\d+$/);
  const jeUrl = page.url();
  await expect(page.locator('.je-line-description').nth(0)).toHaveValue('Monthly accrual, operations.');
  await expect(page.locator('.je-line-description').nth(1)).toHaveValue('Offset to accrued liabilities.');
  await expect(page.locator('#jeDelete')).toBeVisible();
  await expect(page.locator('#jeNew')).toHaveText('+');
  await expect(page.locator('#jeReclass')).toHaveCount(0);
  for (const [id, symbol] of [['firstRec', '|<'], ['prevRec', '<'], ['nextRec', '>'], ['lastRec', '>|']]) {
    await expect(page.locator(`#${id}`)).toHaveText(symbol);
  }
  await expect(page.locator('#firstRec')).toBeEnabled();
  await expect(page.locator('#prevRec')).toBeEnabled();
  await page.locator('#prevRec').click();
  await expect(page).not.toHaveURL(jeUrl);
  await expect(page.locator('#lastRec')).toBeEnabled();
  await page.locator('#lastRec').click();
  await expect(page).toHaveURL(jeUrl);

  await openView(page, new URL(jeUrl).pathname, '#jeLines');
  await expect(page.locator('.je-line-description').nth(0)).toHaveValue('Monthly accrual, operations.');
  await page.locator('#jePost').click();
  await expect(page.locator('#jeLines')).toBeVisible();
  await expect(page.locator('#jeLines tr').nth(1)).toContainText('Monthly accrual, operations.');
  await expect(page.locator('#jeLines tr').nth(2)).toContainText('Offset to accrued liabilities.');
  await expect(page.locator('#jeNew')).toHaveText('+');
  await expect(page.locator('#jeReclass')).toBeVisible();
  await expect(page.locator('#jeLines thead th')).toHaveText([
    'Account', 'Branch', 'Account Description', 'Debit', 'Credit', 'Line Description',
  ]);
  await expect(page.locator('#jeLines thead')).not.toContainText('Department / Cost Center');
  await expect(page.locator('#jeLines thead')).not.toContainText('Source Reference');
  await expect(page.locator('#jeDelete')).toHaveCount(0);
});

test('module-generated journals retain their system source references', async ({ page }) => {
  await openView(page, '/finance/journal', '#jeGrid');
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/finance/journal-transactions');
    const journals = await response.json();
    const generated = journals.find(j => ['AP', 'AR', 'Inventory'].includes(j.module) && j.sourceRef);
    return generated && {
      module: generated.module,
      sourceRef: generated.sourceRef,
      lineReferences: generated.lines.map(line => line.sourceReference),
    };
  });
  expect(result).toBeTruthy();
  expect(['AP', 'AR', 'Inventory']).toContain(result.module);
  expect(result.sourceRef).not.toBe('');
  expect(result.lineReferences.some(reference => reference === result.sourceRef)).toBe(true);
});

test('journal and linked finance screens use JE numbers without batch-number fields', async ({ page }) => {
  await openView(page, '/finance/journal', '#jeGrid');
  await expect(page.getByRole('columnheader', { name: /JE Reference Number/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Batch Number/ })).toHaveCount(0);

  const result = await page.evaluate(async () => {
    const [journalsResponse, receiptResponse] = await Promise.all([
      fetch('/api/finance/journal-transactions'),
      fetch('/api/purchase-orders/receipts/PR000001'),
    ]);
    return {
      journals: await journalsResponse.json(),
      receipt: await receiptResponse.json(),
    };
  });

  expect(result.journals.length).toBeGreaterThan(0);
  expect(result.journals.every(journal => journal.jeNumber && !Object.hasOwn(journal, 'batchNumber'))).toBe(true);
  expect(result.receipt.jeReference).toMatch(/^JE/);
  expect(Object.hasOwn(result.receipt, 'batchNbr')).toBe(false);
  expect(result.receipt.financialDetails.every(row => row.jeNumber && !Object.hasOwn(row, 'batchNumber'))).toBe(true);

  await openView(page, '/purchase-orders/receipts/PR000001', '.erp-workspace');
  await expect(page.locator('label', { hasText: 'JE Number' })).toBeVisible();
  await expect(page.getByText('Batch Number', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Financial Details' }).click();
  await expect(page.locator('#receiptFinGrid')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /JE Number/ })).toBeVisible();
});
