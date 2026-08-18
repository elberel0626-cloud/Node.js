import { test, expect, openView } from './fixtures/authenticated.js';

test('Chart of Accounts setup has no Account Report action',async({page})=>{
  await openView(page,'/finance/chart-of-accounts','#coaManageGrid');
  await expect(page.getByRole('button',{name:'Account Report'})).toHaveCount(0);
});

test('Account Summary filters accounts and drills into details',async({page})=>{
  await openView(page,'/finance/account-summary','#acctSummaryGrid');
  await expect(page.getByRole('heading',{name:'General Ledger Account Summary'})).toBeVisible();
  await page.locator('#acctSummarySearch').fill('1039');
  await page.locator('#acctSummaryApply').click();
  await expect(page).toHaveURL(/search=1039/);
  const row=page.locator('#acctSummaryGrid tr[data-row]').filter({hasText:'1039'}).first();
  await expect(row).toBeVisible();
  await row.locator("td[data-k='accountNumber'] a").click();
  await expect(page).toHaveURL(/\/finance\/account-details\/1039\?/);
  await expect(page.locator('#acctDtlGrid')).toBeVisible();
});

test('Account by Period shows every selected month and period drilldowns',async({page})=>{
  await openView(page,'/finance/account-by-period?accountNumber=1039&fromPeriod=2026-01&toPeriod=2026-03','#acctPeriodGrid');
  await expect(page.locator('#acctPeriodGrid tr[data-row]')).toHaveCount(3);
  await expect(page.locator('#acctPeriodGrid')).toContainText('2026-01');
  await expect(page.locator('#acctPeriodGrid')).toContainText('2026-03');
  await page.locator('#acctPeriodGrid tr[data-row]').first().locator("td[data-k='endingBalance'] a").click();
  await expect(page).toHaveURL(/\/finance\/account-details\/1039\?/);
});

test('Account Details is usable directly and supports account selection',async({page})=>{
  await openView(page,'/finance/account-details','#acctDetailsAccount');
  await page.locator('#acctDetailsAccount').selectOption('1039');
  await expect(page).toHaveURL(/\/finance\/account-details\/1039\?/);
  await expect(page.locator('#accountDetailsAccount')).toHaveValue('1039');
  await expect(page.locator('#accountEndingBalance')).toBeVisible();
  await expect(page.getByRole('button',{name:'Print'})).toBeVisible();
});

