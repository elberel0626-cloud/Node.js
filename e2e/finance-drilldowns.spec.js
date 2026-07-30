import { test, expect, openView } from './fixtures/authenticated.js';

const targetAccount = '1000';
const offsetAccount = '1100';

function captureBrowserErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
  return errors;
}

async function ensureControlledPostedActivity(page) {
  await page.evaluate(async ({ targetAccount, offsetAccount }) => {
    const marker = 'E2E annual GL drilldown';
    const existing = await (await fetch('/api/finance/journal-transactions')).json();
    if (existing.some(journal => journal.description === marker + ' 2025 debit')) return;
    const entries = [
      ['2025-03-15', '2025 debit', 40, 0], ['2025-08-15', '2025 credit', 0, 15],
      ['2026-03-15', '2026 debit', 75, 0], ['2026-08-15', '2026 credit', 0, 25]
    ];
    for (const [date, label, debit, credit] of entries) {
      const amount = debit || credit;
      const saved = await (await fetch('/api/finance/journal-transactions', { method: 'POST', body: JSON.stringify({
        transactionDate: date, financialPeriod: date.slice(0, 7), description: `${marker} ${label}`,
        lines: [
          { branch: '100', account: targetAccount, debit, credit, lineDescription: label },
          { branch: '100', account: offsetAccount, debit: credit ? amount : 0, credit: debit ? amount : 0, lineDescription: `${label} offset` }
        ]
      }) })).json();
      const response = await fetch('/api/finance/journal-transactions/post', { method: 'POST', body: JSON.stringify({ jeNumber: saved.jeNumber }) });
      if (!response.ok) throw new Error(await response.text());
    }
  }, { targetAccount, offsetAccount });
}

async function clickAndExpectDetails(page, link, account, expectedParams) {
  const before = page.url();
  await link.click();
  await expect(page, 'drilldown must change the URL').not.toHaveURL(before);
  await expect(page).toHaveURL(new RegExp(`/finance/account-details/${encodeURIComponent(account)}\\?`));
  const actual = new URL(page.url());
  for (const [key, value] of Object.entries(expectedParams)) expect(actual.searchParams.get(key), key).toBe(value);
  await expect(page.locator('#view')).not.toContainText('Coming Soon');
  await expect(page.getByRole('heading', { name: 'General Ledger Account Activity' })).toBeVisible();
  await expect(page.locator('#acctDtlGrid')).toBeVisible();
  await expect(page.locator('#view .panel').first()).toContainText(`Account Number: ${account}`);
  expect(await page.evaluate(() => window.__ERP_BUILD_ID__)).toBe('finance-drilldown-20260730-3');
  await expect(page.locator('#coaGrid, #tbGrid')).toHaveCount(0);
}

test('Trial Balance is a Finance report and Journal Transactions remains working', async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  await openView(page, '/finance', '#view');
  expect(await page.evaluate(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('/app.js?v=finance-gl-drilldown-20260730-3')))).toBe(true);
  const overviewReports = page.locator('#view section', { has: page.getByRole('heading', { name: 'Reports' }) });
  await expect(overviewReports.getByRole('link', { name: 'Trial Balance' })).toHaveCount(1);
  await expect(page.locator('#view section', { has: page.getByRole('heading', { name: 'Explore' }) }).getByRole('link', { name: 'Trial Balance' })).toHaveCount(0);
  const navReports = page.locator('#ar-nav .nav-group', { hasText: 'Reports' });
  await expect(navReports.getByRole('link', { name: 'Trial Balance', exact: true })).toHaveCount(1);
  await expect(page.locator('#ar-nav .nav-group', { hasText: 'Enter' }).getByRole('link', { name: 'Trial Balance' })).toHaveCount(0);
  await expect(page.locator('#ar-nav')).not.toContainText('Reports (Coming Soon)');
  await openView(page, '/finance/journal', '#jeGrid');
  await expect(page.locator('#view')).not.toContainText('Coming Soon');
  expect(browserErrors).toEqual([]);
});

test('Chart of Accounts shows cumulative balance and normal full-cell drilldowns', async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  await openView(page, '/finance', '#view'); await ensureControlledPostedActivity(page);
  await openView(page, '/finance/chart-of-accounts?year=2025', '#coaGrid');
  await expect(page.locator('#coaYear')).toHaveValue('2025');
  await expect(page.locator("#coaGrid th[data-k='balance']")).toContainText('Balance as of 12/31/2025');
  for (const obsolete of ['beginningBalance','debitActivity','creditActivity','endingBalance','currentBalance']) await expect(page.locator(`#coaGrid th[data-k='${obsolete}']`)).toHaveCount(0);
  await expect(page.locator("#coaGrid th[data-k='balance']")).toHaveCount(1);
  const search=page.locator(".grid-search[data-grid='coaGrid']"); await search.fill(targetAccount);
  const row=page.locator('#coaGrid tr',{hasText:targetAccount}).filter({has:page.locator('td')}).first();
  const accountLink=row.locator("td[data-k='accountNumber'] a"),balanceLink=row.locator("td[data-k='balance'] a");
  for(const link of [accountLink,balanceLink]){const diagnostic=await link.evaluate(element=>{const rect=element.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2,top=document.elementFromPoint(x,y);return{href:element.getAttribute('href'),display:getComputedStyle(element).display,pointerEvents:getComputedStyle(element).pointerEvents,rect:{width:rect.width,height:rect.height},topTag:top?.tagName,topIsLink:top===element||element.contains(top)};});expect(diagnostic.display).toBe('block');expect(diagnostic.pointerEvents).toBe('auto');expect(diagnostic.rect.width).toBeGreaterThan(0);expect(diagnostic.rect.height).toBeGreaterThan(0);expect(diagnostic.topIsLink).toBe(true);}
  await clickAndExpectDetails(page,accountLink,targetAccount,{activity:'all',origin:'chart-of-accounts',year:'2025',scope:'through',toPeriod:'2025-12'});
  const periods=await page.locator("#acctDtlGrid td[data-k='postPeriod']").allTextContents(); expect(periods.every(period=>period<='2025-12')).toBe(true);
  await page.locator('#accountDetailsBack').click(); await expect(search).toHaveValue(targetAccount);
  await clickAndExpectDetails(page,balanceLink,targetAccount,{activity:'all',origin:'chart-of-accounts',year:'2025',scope:'through',toPeriod:'2025-12'});
  await page.locator('#accountDetailsBack').click();
  const report=await page.evaluate(async()=>await(await fetch('/api/finance/chart-of-accounts/annual?year=2025')).json()),empty=report.rows.find(item=>!item.hasActivity&&item.balance===0);expect(empty).toBeTruthy();await search.fill(empty.accountNumber);const emptyRow=page.locator('#coaGrid tr',{hasText:empty.accountNumber}).filter({has:page.locator('td')}).first();await expect(emptyRow.locator("td[data-k='balance'] a")).toHaveText('$0.00');await clickAndExpectDetails(page,emptyRow.locator("td[data-k='balance'] a"),empty.accountNumber,{scope:'through',toPeriod:'2025-12'});await expect(page.locator('.empty-state')).toContainText('selected year');
  await page.locator('#accountDetailsBack').click();await page.locator('#coaYear').selectOption('2026');await expect(page).toHaveURL(/year=2026/);const balances=await page.evaluate(async()=>Promise.all(['2025','2026'].map(async year=>(await(await fetch('/api/finance/chart-of-accounts/annual?year='+year)).json()).rows.find(row=>row.accountNumber==='1000').balance)));expect(balances[0]).not.toBe(balances[1]);
  const response=await page.request.get('/app.js?v=finance-gl-drilldown-20260730-3');expect(response.headers()['cache-control']).toBe('no-cache, must-revalidate');expect(await response.text()).toContain("window.__ERP_BUILD_ID__='finance-drilldown-20260730-3'");expect(browserErrors).toEqual([]);
});

test('Trial Balance activity modes filter rows after calculating full running balances', async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  await openView(page, '/finance', '#view'); await ensureControlledPostedActivity(page);
  await openView(page, '/finance/trial-balance?fromPeriod=2026-01&toPeriod=2026-12', '#tbGrid');
  const search = page.locator(".grid-search[data-grid='tbGrid']"); await search.fill(targetAccount);
  const row = page.locator('#tbGrid tr', { hasText: targetAccount }).filter({ has: page.locator('td') }).first();
  const links = { accountNumber: 'all', debit: 'debit', credit: 'credit', balance: 'all' };
  const debitHref = await row.locator("td[data-k='debit'] a").getAttribute('href'), creditHref = await row.locator("td[data-k='credit'] a").getAttribute('href');
  expect(debitHref).not.toBe(creditHref);
  for (const [key, mode] of Object.entries(links)) {
    await clickAndExpectDetails(page, row.locator(`td[data-k='${key}'] a`), targetAccount, { activity: mode, origin: 'trial-balance', fromPeriod: '2026-01', toPeriod: '2026-12' });
    const values = await page.locator('#acctDtlGrid tr[data-row]:visible').evaluateAll(rows => rows.map(row => ({ debit: Number(row.querySelector("td[data-k='debit']").textContent.replace(/[^0-9.-]/g, '')), credit: Number(row.querySelector("td[data-k='credit']").textContent.replace(/[^0-9.-]/g, '')) })));
    if (mode === 'debit') expect(values.every(value => value.debit > 0)).toBe(true);
    if (mode === 'credit') expect(values.every(value => value.credit > 0)).toBe(true);
    await page.locator('#accountDetailsBack').click(); await expect(search).toHaveValue(targetAccount);
  }
  const zeroTarget = await page.evaluate(async () => { const report=await(await fetch('/api/finance/trial-balance?fromPeriod=2026-01&toPeriod=2026-12')).json(); const row=report.rows.find(item=>item.debit===0||item.credit===0||item.balance===0); return {accountNumber:row.accountNumber,key:row.debit===0?'debit':row.credit===0?'credit':'balance',mode:row.debit===0?'debit':row.credit===0?'credit':'all'}; });
  await search.fill(zeroTarget.accountNumber);
  const zeroRow = page.locator('#tbGrid tr', { hasText: zeroTarget.accountNumber }).filter({ has: page.locator('td') }).first();
  const zeroLink = zeroRow.locator(`td[data-k='${zeroTarget.key}'] a`);
  await expect(zeroLink).toHaveText('$0.00');
  await clickAndExpectDetails(page, zeroLink, zeroTarget.accountNumber, { activity: zeroTarget.mode, origin: 'trial-balance', fromPeriod: '2026-01', toPeriod: '2026-12' });
  expect(browserErrors).toEqual([]);
});

test('saved module source references retain JE and AP, AR, and Inventory routing', async ({ page }) => {
  const targets = await page.evaluate(async () => { const report=await(await fetch('/api/finance/trial-balance')).json(),found={}; for(const row of report.rows){const details=await(await fetch(`/api/finance/account-details/${encodeURIComponent(row.accountNumber)}`)).json();for(const source of details.activityRows){const module=String(source.sourceModule).toUpperCase();if(source.sourceHref&&['AP','AR','INVENTORY'].includes(module)&&!found[module])found[module]={accountNumber:row.accountNumber,source};}}return found; });
  expect(Object.keys(targets).sort()).toEqual(['AP','AR','INVENTORY']);
  for (const target of Object.values(targets)) { await openView(page, `/finance/account-details/${encodeURIComponent(target.accountNumber)}`, '#acctDtlGrid'); const row=page.locator('#acctDtlGrid tr',{hasText:target.source.jeReference}).filter({has:page.locator(`a[href='${target.source.sourceHref}']`)}).first(); await row.locator("td[data-k='jeLink'] a").click(); await expect(page).toHaveURL(new RegExp(`/finance/journal/${encodeURIComponent(target.source.jeReference)}$`)); }
});
