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
  await expect(page.locator('#jeNew')).toBeVisible();
  await expect(page.locator('#jeReclass')).toHaveCount(0);

  await openView(page, new URL(jeUrl).pathname, '#jeLines');
  await expect(page.locator('.je-line-description').nth(0)).toHaveValue('Monthly accrual, operations.');
  await page.locator('#jePost').click();
  await expect(page.locator('#jeLines')).toBeVisible();
  await expect(page.locator('#jeLines tr').nth(1)).toContainText('Monthly accrual, operations.');
  await expect(page.locator('#jeLines tr').nth(2)).toContainText('Offset to accrued liabilities.');
  await expect(page.locator('#jeNew')).toBeVisible();
  await expect(page.locator('#jeReclass')).toBeVisible();
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
