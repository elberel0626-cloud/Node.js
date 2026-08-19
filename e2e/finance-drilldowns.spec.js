import { test, expect, openView } from './fixtures/authenticated.js';

const PLACEHOLDER_ACCOUNTS=new Set(['Cash','AR','AP','Revenue','Expense','1000','1100','4000','4050','5000']);

function captureBrowserErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
  return errors;
}

async function controlledAccounts(page){
  return page.evaluate(blocked=>fetch('/api/finance/chart-of-accounts').then(response=>response.json()).then(accounts=>{
    const excluded=new Set(blocked),usable=accounts.filter(account=>account.active!==false&&account.allowManualJournalEntry!==false&&!excluded.has(String(account.accountNumber||'')));
    if(usable.length<2)throw new Error('The imported Chart of Accounts does not contain two active manual-posting accounts for the controlled drilldown test.');
    return{targetAccount:String(usable[0].accountNumber),offsetAccount:String(usable[1].accountNumber)};
  }),[...PLACEHOLDER_ACCOUNTS]);
}

async function ensureControlledPostedActivity(page) {
  const accounts=await controlledAccounts(page);
  await page.evaluate(async ({ targetAccount, offsetAccount }) => {
    const marker = `E2E annual GL drilldown ${targetAccount}`;
    const existing = await (await fetch('/api/finance/journal-transactions')).json();
    if (existing.some(journal => journal.description === marker + ' 2025 debit')) return;
    const entries = [
      ['2025-03-15', '2025 debit', 40, 0], ['2025-08-15', '2025 credit', 0, 15],
      ['2026-03-15', '2026 debit', 75, 0], ['2026-08-15', '2026 credit', 0, 25]
    ];
    for (const [date, label, debit, credit] of entries) {
      const amount = debit || credit;
      const savedResponse = await fetch('/api/finance/journal-transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionDate: date, financialPeriod: date.slice(0, 7), description: `${marker} ${label}`,
          lines: [
            { branch: '100', account: targetAccount, debit, credit, lineDescription: label },
            { branch: '100', account: offsetAccount, debit: credit ? amount : 0, credit: debit ? amount : 0, lineDescription: `${label} offset` }
          ]
        })
      });
      if (!savedResponse.ok) throw new Error(await savedResponse.text());
      const saved = await savedResponse.json();
      const response = await fetch('/api/finance/journal-transactions/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jeNumber: saved.jeNumber })
      });
      if (!response.ok) throw new Error(await response.text());
    }
  }, accounts);
  return accounts;
}

async function clickAndExpectDetails(page, link, account, expectedParams) {
  const before = page.url();
  await link.click();
  await expect(page, 'drilldown must change the URL').not.toHaveURL(before);
  await expect(page).toHaveURL(new RegExp(`/finance/account-details/${encodeURIComponent(account)}\\?`));
  const actual = new URL(page.url());
  for (const [key, value] of Object.entries(expectedParams)) expect(actual.searchParams.get(key), key).toBe(value);
  await expect(page.locator('#view')).not.toContainText('Coming Soon');
  await expect(page.locator('#acctDtlGrid')).toBeVisible();
  await expect(page.locator('#coaGrid, #tbGrid')).toHaveCount(0);
}

test('Trial Balance is a Finance report and Journal Transactions remains working', async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  await openView(page, '/finance', '#view');
  expect(await page.evaluate(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('/app.js?v=finance-gl-drilldown-20260730-2')))).toBe(true);
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

test('annual Chart of Accounts reports posted activity and restores year and grid state', async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  await openView(page, '/finance', '#view');
  const {targetAccount}=await ensureControlledPostedActivity(page);
  await openView(page, '/finance/chart-of-accounts?year=2026', '#coaGrid');
  await expect(page.locator('#coaYear')).toHaveValue('2026');
  for (const key of ['beginningBalance', 'debitActivity', 'creditActivity', 'endingBalance']) await expect(page.locator(`#coaGrid th[data-k='${key}']`)).toBeVisible();
  const search = page.locator(".grid-search[data-grid='coaGrid']"); await search.fill(targetAccount);
  await page.locator("#coaGrid .grid-dir[data-k='accountNumber'][data-dir='desc']").click();
  const row = page.locator('#coaGrid tr', { hasText: targetAccount }).filter({ has: page.locator('td') }).first();
  expect(await row.locator("td[data-k='debitActivity']").innerText()).not.toBe('$0.00');
  await clickAndExpectDetails(page, row.locator("td[data-k='accountNumber'] a"), targetAccount, { activity: 'all', origin: 'chart-of-accounts', year: '2026' });
  await page.locator('#accountDetailsBack').click();
  await expect(page).toHaveURL(/\/finance\/chart-of-accounts\?year=2026$/); await expect(search).toHaveValue(targetAccount);
  const popupPromise = page.context().waitForEvent('page');
  await row.locator("td[data-k='accountNumber'] a").click({ modifiers: ['Control'] });
  const popup = await popupPromise; await popup.waitForLoadState('domcontentloaded');
  await expect(popup).toHaveURL(new RegExp(`/finance/account-details/${encodeURIComponent(targetAccount)}\\?`)); await popup.close();
  await clickAndExpectDetails(page, row.locator("td[data-k='debitActivity'] a"), targetAccount, { activity: 'debit', origin: 'chart-of-accounts', year: '2026' });
  await page.locator('#accountDetailsBack').click();
  await clickAndExpectDetails(page, row.locator("td[data-k='creditActivity'] a"), targetAccount, { activity: 'credit', origin: 'chart-of-accounts', year: '2026' });
  await page.locator('#accountDetailsBack').click();
  await clickAndExpectDetails(page, row.locator("td[data-k='endingBalance'] a"), targetAccount, { activity: 'all', origin: 'chart-of-accounts', year: '2026' });
  await page.locator('#accountDetailsBack').click();
  await page.locator('#coaYear').selectOption('2025'); await expect(page).toHaveURL(/year=2025/);
  const annual = await page.evaluate(async account => Promise.all(['2025','2026'].map(async year => (await (await fetch('/api/finance/chart-of-accounts/annual?year='+year)).json()).rows.find(row => row.accountNumber === account).debitActivity)),targetAccount);
  expect(annual[0]).not.toBe(annual[1]);
  const emptyAccount = await page.evaluate(async () => (await (await fetch('/api/finance/chart-of-accounts/annual?year=2025')).json()).rows.find(row => !row.hasActivity && row.endingBalance === 0)?.accountNumber||'');
  expect(emptyAccount).toBeTruthy();
  await page.locator(".grid-search[data-grid='coaGrid']").fill(emptyAccount);
  const emptyRow = page.locator('#coaGrid tr', { hasText: emptyAccount }).filter({ has: page.locator('td') }).first();
  await clickAndExpectDetails(page, emptyRow.locator("td[data-k='endingBalance'] a"), emptyAccount, { activity: 'all', origin: 'chart-of-accounts', year: '2025' });
  await expect(page.locator('.empty-state')).toContainText('No posted activity was found for this account and selected year.');
  expect(browserErrors).toEqual([]);
});

test('Trial Balance activity modes filter rows after calculating full running balances', async ({ page }) => {
  const browserErrors = captureBrowserErrors(page);
  await openView(page, '/finance', '#view'); const {targetAccount}=await ensureControlledPostedActivity(page);
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
  const controlledAr=await page.evaluate(async () => {
    const tag=Date.now().toString().slice(-8);
    const response=await fetch('/api/ar/documents', {
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({type:'Invoice',customerId:'CUST-1002',date:'2026-08-19',postDate:'2026-08-19',invoiceNumber:`AR-ROUTE-${tag}`,description:'Finance source routing fixture',amount:25,lines:[{itemCode:'ITEM-1001',description:'AR source route',qty:1,unitPrice:25,revenueAccount:'4008'}]})
    });
    if(!response.ok)throw new Error(await response.text());
    const invoice=await response.json();
    const posted=await fetch('/api/ar/documents/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:invoice.id})});
    if(!posted.ok)throw new Error(await posted.text());
    const journals=await(await fetch('/api/finance/journal-transactions')).json();
    const journal=journals.find(entry=>entry.sourceRef===invoice.id&&String(entry.module).toUpperCase()==='AR'&&!entry.reversalOf);
    if(!journal)throw new Error('Controlled AR invoice did not create an AR journal.');
    const account=journal.lines.find(line=>Number(line.debit||0)>0)?.account||journal.lines[0]?.account;
    const details=await(await fetch(`/api/finance/account-details/${encodeURIComponent(account)}`)).json();
    const source=details.activityRows.find(row=>row.jeReference===journal.jeNumber&&row.sourceReference===invoice.id);
    if(!source)throw new Error('Controlled AR journal was not found in Account Details.');
    return{accountNumber:account,source};
  });
  expect(String(controlledAr.source.sourceModule).toUpperCase()).toBe('AR');
  expect(controlledAr.source.sourceHref).toMatch(/^\/ar\/doc\//);
  const targets = await page.evaluate(async () => { const report=await(await fetch('/api/finance/trial-balance')).json(),found={}; for(const row of report.rows){const details=await(await fetch(`/api/finance/account-details/${encodeURIComponent(row.accountNumber)}`)).json();for(const source of details.activityRows){const module=String(source.sourceModule).toUpperCase();if(source.sourceHref&&['AP','INVENTORY'].includes(module)&&!found[module])found[module]={accountNumber:row.accountNumber,source};}}return found; });
  targets.AR=controlledAr;
  expect(Object.keys(targets).sort()).toEqual(['AP','AR','INVENTORY']);
  for (const target of Object.values(targets)) { await openView(page, `/finance/account-details/${encodeURIComponent(target.accountNumber)}`, '#acctDtlGrid'); const row=page.locator('#acctDtlGrid tr',{hasText:target.source.jeReference}).filter({has:page.locator(`a[href='${target.source.sourceHref}']`)}).first(); await row.locator("td[data-k='jeLink'] a").click(); await expect(page).toHaveURL(new RegExp(`/finance/journal/${encodeURIComponent(target.source.jeReference)}$`)); }
});
