import { test, expect, openView } from './fixtures/authenticated.js';

const api = async (page, url, method='GET', payload) => page.evaluate(async ({url,method,payload}) => {
  const response=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload)});
  return {status:response.status,body:await response.json()};
},{url,method,payload});

test('year-end close locks posting, posts calculated JE once, closes, and handles P&L audit adjustment', async ({ page }) => {
  const pageErrors=[],consoleErrors=[],requestFailures=[];
  page.on('dialog',dialog=>dialog.accept());
  const password=process.env.E2E_ADMIN_PASSWORD;
  const activity=await api(page,'/api/finance/journal-transactions','POST',{transactionDate:'2026-12-15',description:'Year-end E2E revenue',lines:[{branch:'100',account:'1039',debit:125},{branch:'100',account:'4008',credit:125}]});
  expect(activity.status).toBe(201);
  expect((await api(page,'/api/finance/journal-transactions/post','POST',{jeNumber:activity.body.jeNumber})).status).toBe(200);
  const held=await api(page,'/api/finance/journal-transactions','POST',{transactionDate:'2026-12-20',description:'Must be locked after start',lines:[{branch:'100',account:'1039',debit:10},{branch:'100',account:'4008',credit:10}]});
  expect(held.status).toBe(201);
  await openView(page,'/finance/processes/close-period','.year-end-screen');
  await expect(page).toHaveURL(/\/finance\/year-end-close/);
  await expect(page.getByText('Financial Periods (Year-End)')).toBeVisible();
  const wrong=await api(page,'/api/finance/year-end/2026/start','POST',{acknowledged:true,password:'definitely-wrong'});
  expect(wrong.status).toBe(401);
  await page.locator('#yearEndAck').check();
  await page.locator('#yearEndPassword').fill(password);
  const startResponse=page.waitForResponse(r=>r.url().endsWith('/api/finance/year-end/2026/start')&&r.request().method()==='POST');
  await page.locator('#yearEndStart').click();
  expect((await startResponse).status()).toBe(201);
  await expect(page.locator('#yearEndStatus')).toHaveText('Closing In Progress');
  const locked=await api(page,'/api/finance/journal-transactions/post','POST',{jeNumber:held.body.jeNumber});
  expect(locked.status).toBe(409);expect(locked.body.error).toContain('Normal posting is locked');
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  page.on('requestfailed',request=>requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`));
  const started=(await api(page,'/api/finance/year-end/2026')).body;
  expect(started.closingJournal.status).toBe('Saved');
  expect(started.closingJournal.lines.some(line=>line.account===started.retainedEarningsAccount)).toBe(true);
  const postResponse=page.waitForResponse(r=>r.url().endsWith('/post-closing-journal')&&r.request().method()==='POST');
  await page.locator('#yearEndPost').click();
  expect((await postResponse).status()).toBe(200);
  await expect(page.locator('#yearEndStatus')).toHaveText('Closing JE Posted');
  const posted=(await api(page,'/api/finance/year-end/2026')).body;
  expect(posted.profitAndLossBalances).toEqual([]);
  expect((await api(page,'/api/finance/year-end/2026/post-closing-journal','POST',{})).body.closingJournal.postingId).toBe(posted.closingJournal.postingId);
  await page.locator('#yearEndAck').check();await page.locator('#yearEndPassword').fill(password);
  const finalResponse=page.waitForResponse(r=>r.url().endsWith('/finalize')&&r.request().method()==='POST');
  await page.locator('#yearEndFinalize').click();expect((await finalResponse).status()).toBe(200);
  await expect(page.locator('#yearEndStatus')).toHaveText('Closed');
  await page.locator('#auditReason').fill('Auditor proposed revenue correction');await page.locator('#auditReference').fill('AUD-2026-01');await page.locator('#auditPassword').fill(password);
  const auditRows=page.locator('#auditAdjustmentPanel tr');await auditRows.nth(1).locator('.audit-account').fill('4008');await auditRows.nth(1).locator('.audit-debit').fill('25');await auditRows.nth(2).locator('.audit-account').fill('1039');await auditRows.nth(2).locator('.audit-credit').fill('25');
  await page.locator('#auditCreate').click();await expect(page.locator('#auditJeNumber')).not.toHaveValue('');const auditJe=await page.locator('#auditJeNumber').inputValue();await page.locator('#auditPost').click();
  await expect(page.locator('#yearEndStatus')).toHaveText('Audit Adjustment Closing In Progress');await expect(page.locator('#yearEndPostAdjustmentClose')).toBeVisible();await page.locator('#yearEndPostAdjustmentClose').click();await expect(page.locator('#yearEndStatus')).toHaveText('Closed');
  const finished=(await api(page,'/api/finance/year-end/2026')).body;expect(finished.profitAndLossBalances).toEqual([]);expect(finished.history.some(h=>h.details?.jeNumber===auditJe)).toBe(true);
  console.log(JSON.stringify({year:finished.year,closingJe:finished.closingJournal.jeNumber,closingLines:finished.closingJournal.lines,beforePl:started.profitAndLossBalances,afterPl:finished.profitAndLossBalances,auditJe}));
  expect(pageErrors).toEqual([]);expect(requestFailures).toEqual([]);expect(consoleErrors).toEqual([]);
});

test('year-end close is a separate function and does not replace Financial Periods', async ({page})=>{
  await openView(page,'/finance/financial-periods','.period-screen');
  await expect(page.locator('#periodClose')).toBeVisible();
  await expect(page.locator('.year-end-screen')).toHaveCount(0);
  await openView(page,'/finance/year-end-close','.year-end-screen');
  await expect(page.locator('#yearEndStart')).toBeVisible();
  await expect(page.locator('#periodClose')).toHaveCount(0);
  await openView(page,'/finance');
  await expect(page.locator('#view').getByRole('link',{name:'Financial Periods',exact:true})).toBeVisible();
  await expect(page.locator('#view').getByRole('link',{name:'Financial Periods (Year-End)',exact:true})).toBeVisible();
});

