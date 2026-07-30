import { test, expect, openView } from './fixtures/authenticated.js';

async function firstActivityAccount(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/finance/trial-balance');
    const report = await response.json();
    return report.rows.find(row => row.hasActivity) || report.rows[0];
  });
}

test('Chart of Accounts account and balance drilldowns preserve list state', async ({ page }) => {
  await openView(page, '/finance/chart-of-accounts', '#coaGrid');
  const account = await firstActivityAccount(page);
  const search = page.locator(".grid-search[data-grid='coaGrid']");
  await search.fill(account.accountNumber);
  await page.evaluate(() => scrollTo(0, 120));
  const accountRow = page.locator('#coaGrid tr', { hasText: account.accountNumber }).filter({ has: page.locator('td') }).first();
  await accountRow.locator("td[data-k='accountNumber'] a").click();
  await expect(page).toHaveURL(new RegExp(`/finance/account-details/${encodeURIComponent(account.accountNumber)}$`));
  await expect(page.locator('#acctDtlGrid')).toBeVisible();
  const shownAccounts = await page.evaluate(async accountNumber => {
    const details = await (await fetch(`/api/finance/account-details/${encodeURIComponent(accountNumber)}`)).json();
    return details.activity.every(line => line.accountNumber === undefined || line.accountNumber === accountNumber);
  }, account.accountNumber);
  expect(shownAccounts).toBe(true);
  await page.locator('#accountDetailsBack').click();
  await expect(page).toHaveURL(/\/finance\/chart-of-accounts$/);
  await expect(search).toHaveValue(account.accountNumber);

  await accountRow.locator("td[data-k='currentBalance'] a").click();
  await expect(page.locator('#acctDtlGrid')).toBeVisible();
});

test('Trial Balance links reconcile to period-aware Account Details', async ({ page }) => {
  await openView(page, '/finance/trial-balance?fromPeriod=2026-05&toPeriod=2026-05', '#tbGrid');
  const row = page.locator('#tbGrid tr').filter({ has: page.locator('td') }).filter({ has: page.locator("td[data-k='accountNumber'] a") }).first();
  const accountNumber = (await row.locator("td[data-k='accountNumber']").innerText()).trim();
  const expectedBalance = (await row.locator("td[data-k='balance']").innerText()).trim();
  await row.locator("td[data-k='accountNumber'] a").click();
  await expect(page).toHaveURL(new RegExp(`/finance/account-details/${encodeURIComponent(accountNumber)}\\?fromPeriod=2026-05&toPeriod=2026-05$`));
  await expect(page.locator('#accountEndingBalance')).toHaveText(expectedBalance);
  await page.locator('#accountDetailsBack').click();
  await expect(page.locator('#tbFrom')).toHaveValue('2026-05');
  await expect(page.locator('#tbTo')).toHaveValue('2026-05');
  for (const key of ['debit', 'credit', 'balance']) {
    await row.locator(`td[data-k='${key}'] a`).click();
    await expect(page.locator('#acctDtlGrid')).toBeVisible();
    await page.locator('#accountDetailsBack').click();
  }
});

test('journal and saved-module source references drill into the correct documents', async ({ page }) => {
  const target = await page.evaluate(async () => {
    const report = await (await fetch('/api/finance/trial-balance')).json();
    for (const row of report.rows) {
      const details = await (await fetch(`/api/finance/account-details/${encodeURIComponent(row.accountNumber)}`)).json();
      const source = details.activity.find(line => line.sourceHref && ['AP', 'AR'].includes(line.sourceModule));
      if (source) return { accountNumber: row.accountNumber, source };
    }
    return null;
  });
  expect(target).toBeTruthy();
  await openView(page, `/finance/account-details/${encodeURIComponent(target.accountNumber)}`, '#acctDtlGrid');
  const activityRow = page.locator('#acctDtlGrid tr', { hasText: target.source.jeReference }).filter({ has: page.locator('td') }).first();
  await activityRow.locator("td[data-k='jeLink'] a").click();
  await expect(page).toHaveURL(new RegExp(`/finance/journal/${encodeURIComponent(target.source.jeReference)}$`));
  await page.goBack();
  await expect(page.locator('#acctDtlGrid')).toBeVisible();
  await activityRow.locator("td[data-k='sourceLink'] a").click();
  await expect(page).toHaveURL(new RegExp(target.source.sourceHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
});

test('obsolete Finance navigation is removed without affecting branch-backed journals', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nav_pref_Finance', JSON.stringify([
    { route: '/finance', visible: true, order: 0 },
    { route: '/finance/branches', label: 'Branches', visible: true, order: 1 },
    { route: '/finance/journal-inquiry', label: 'Journal Entry Inquiry', visible: true, order: 2 },
    { route: '/finance/journal', label: 'Journal Transactions', visible: true, order: 3 }
  ])));
  await openView(page, '/finance', '#view');
  await expect(page.locator('#view')).not.toContainText('Branches');
  await expect(page.locator('#view')).not.toContainText('Journal Entry Inquiry');
  await expect(page.locator('#ar-nav')).not.toContainText('Branches');
  await expect(page.locator('#ar-nav')).not.toContainText('Journal Entry Inquiry');
  await expect(page.locator('#ar-nav')).toContainText('Journal Transactions');
  const storedRoutes = await page.evaluate(() => JSON.parse(localStorage.getItem('nav_pref_Finance')).map(item => item.route));
  expect(storedRoutes).toEqual(['/finance', '/finance/journal']);
  await openView(page, '/finance/journal/new', '#newJe');
  await expect(page.locator('#jlines .bname').first()).toBeEnabled();
  await expect(page.locator('#jlines .bname').first().locator('option')).not.toHaveCount(0);
});
