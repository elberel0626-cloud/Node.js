import { test, expect, openView } from './fixtures/authenticated.js';

async function firstActivityAccount(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/finance/trial-balance');
    const report = await response.json();
    return report.rows.find(row => row.hasActivity) || report.rows[0];
  });
}

async function expectAccountDetailsAfterClick(page, link, accountNumber, query = '') {
  const before = page.url();
  await link.click();
  await expect(page, 'account drilldown URL must change').not.toHaveURL(before);
  await expect(page).toHaveURL(new URL(`/finance/account-details/${encodeURIComponent(accountNumber)}${query}`, page.url()).href);
  await expect(page.locator('#view')).not.toContainText('Coming Soon');
  await expect(page.locator('#acctDtlGrid')).toBeVisible();
}

test('Journal Transactions renders and opens new and existing journals', async ({ page }) => {
  await openView(page, '/finance/journal', '#jeGrid');
  await expect(page.locator('#view')).not.toContainText('Coming Soon');
  const firstJournal = page.locator("#jeGrid td[data-k='jeNumber'] a").first();
  const journalHref = await firstJournal.getAttribute('href');
  await firstJournal.click();
  await expect(page).toHaveURL(new URL(journalHref, page.url()).href);
  await page.goto('/finance/journal');
  await expect(page.locator('#jeGrid')).toBeVisible();
  await page.getByRole('button', { name: 'New JE', exact: true }).click();
  await expect(page).toHaveURL(new URL('/finance/journal/new', page.url()).href);
  await expect(page.locator('#newJe')).toBeVisible();
});

test('Chart of Accounts account and balance drilldowns preserve list state', async ({ page }) => {
  await openView(page, '/finance/chart-of-accounts', '#coaGrid');
  const account = await firstActivityAccount(page);
  await page.locator("#coaGrid .grid-dir[data-k='accountNumber'][data-dir='desc']").click();
  await expect(page.locator('#coaGrid')).toHaveAttribute('data-sort-dir', 'desc');
  const next = page.locator('#coaGrid_next');
  if (await next.isVisible() && await next.isEnabled()) {
    await next.click();
    await expect(page.locator('#coaGrid_page')).toContainText('Page 2');
    const pagedRow = page.locator('#coaGrid tr[data-row]:visible').first();
    const pagedAccount = (await pagedRow.locator("td[data-k='accountNumber']").innerText()).trim();
    await expectAccountDetailsAfterClick(page, pagedRow.locator("td[data-k='accountNumber'] a"), pagedAccount);
    await page.locator('#accountDetailsBack').click();
    await expect(page.locator('#coaGrid_page')).toContainText('Page 2');
    await expect(page.locator('#coaGrid')).toHaveAttribute('data-sort-dir', 'desc');
  }
  await page.goto('/finance/chart-of-accounts');
  await expect(page.locator('#coaGrid')).toBeVisible();
  const search = page.locator(".grid-search[data-grid='coaGrid']");
  await search.fill(account.accountNumber);
  await page.evaluate(() => scrollTo(0, 120));
  const accountRow = page.locator('#coaGrid tr', { hasText: account.accountNumber }).filter({ has: page.locator('td') }).first();
  await expectAccountDetailsAfterClick(page, accountRow.locator("td[data-k='accountNumber'] a"), account.accountNumber);
  const shownAccounts = await page.evaluate(async accountNumber => {
    const details = await (await fetch(`/api/finance/account-details/${encodeURIComponent(accountNumber)}`)).json();
    return details.activity.every(line => line.accountNumber === undefined || line.accountNumber === accountNumber);
  }, account.accountNumber);
  expect(shownAccounts).toBe(true);
  await page.locator('#accountDetailsBack').click();
  await expect(page).toHaveURL(/\/finance\/chart-of-accounts$/);
  await expect(search).toHaveValue(account.accountNumber);

  await expectAccountDetailsAfterClick(page, accountRow.locator("td[data-k='currentBalance'] a"), account.accountNumber);
});

test('Trial Balance links reconcile to period-aware Account Details', async ({ page }) => {
  await openView(page, '/finance/trial-balance?fromPeriod=2026-05&toPeriod=2026-05', '#tbGrid');
  await page.locator("#tbGrid .grid-dir[data-k='accountNumber'][data-dir='desc']").click();
  const row = page.locator('#tbGrid tr').filter({ has: page.locator('td') }).filter({ has: page.locator("td[data-k='accountNumber'] a") }).first();
  const accountNumber = (await row.locator("td[data-k='accountNumber']").innerText()).trim();
  const expectedBalance = (await row.locator("td[data-k='balance']").innerText()).trim();
  await expectAccountDetailsAfterClick(page, row.locator("td[data-k='accountNumber'] a"), accountNumber, '?fromPeriod=2026-05&toPeriod=2026-05');
  await expect(page.locator('#accountEndingBalance')).toHaveText(expectedBalance);
  await page.locator('#accountDetailsBack').click();
  await expect(page.locator('#tbFrom')).toHaveValue('2026-05');
  await expect(page.locator('#tbTo')).toHaveValue('2026-05');
  await expect(page.locator('#tbGrid')).toHaveAttribute('data-sort-dir', 'desc');
  for (const key of ['debit', 'credit', 'balance']) {
    await expectAccountDetailsAfterClick(page, row.locator(`td[data-k='${key}'] a`), accountNumber, '?fromPeriod=2026-05&toPeriod=2026-05');
    await page.locator('#accountDetailsBack').click();
  }
});

test('journal and AP, AR, and Inventory source references open the correct records', async ({ page }) => {
  const targets = await page.evaluate(async () => {
    const report = await (await fetch('/api/finance/trial-balance')).json();
    const found = {};
    for (const row of report.rows) {
      const details = await (await fetch(`/api/finance/account-details/${encodeURIComponent(row.accountNumber)}`)).json();
      for (const source of details.activity) {
        const module = String(source.sourceModule).toUpperCase();
        if (source.sourceHref && ['AP', 'AR', 'INVENTORY'].includes(module) && !found[module]) {
          found[module] = { accountNumber: row.accountNumber, source };
        }
      }
    }
    return found;
  });
  expect(Object.keys(targets).sort()).toEqual(['AP', 'AR', 'INVENTORY']);
  for (const target of Object.values(targets)) {
    await openView(page, `/finance/account-details/${encodeURIComponent(target.accountNumber)}`, '#acctDtlGrid');
    const activityRow = page.locator('#acctDtlGrid tr', { hasText: target.source.jeReference })
      .filter({ has: page.locator(`td[data-k='sourceLink'] a[href='${target.source.sourceHref}']`) }).first();
    await activityRow.locator("td[data-k='jeLink'] a").click();
    await expect(page).toHaveURL(new RegExp(`/finance/journal/${encodeURIComponent(target.source.jeReference)}$`));
    await page.goBack();
    await expect(page.locator('#acctDtlGrid')).toBeVisible();
    await activityRow.locator("td[data-k='sourceLink'] a").click();
    await expect(page).toHaveURL(new RegExp(target.source.sourceHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
  }
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
  for (const obsoletePath of ['/finance/branches', '/finance/journal-inquiry']) {
    await page.goto(obsoletePath);
    await expect(page).toHaveURL(/\/finance$/);
    await expect(page.locator('#view')).not.toContainText('Coming Soon');
  }
  const storedRoutes = await page.evaluate(() => JSON.parse(localStorage.getItem('nav_pref_Finance')).map(item => item.route));
  expect(storedRoutes).toEqual(['/finance', '/finance/journal']);
  await page.getByRole('link', { name: 'Journal Transactions', exact: true }).first().click();
  await expect(page).toHaveURL(/\/finance\/journal$/);
  await expect(page.locator('#jeGrid')).toBeVisible();
  await openView(page, '/finance/journal/new', '#newJe');
  await expect(page.locator('#jlines .bname').first()).toBeEnabled();
  await expect(page.locator('#jlines .bname').first().locator('option')).not.toHaveCount(0);
});
