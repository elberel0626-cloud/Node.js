import { test, expect, openView } from './fixtures/authenticated.js';

const api = (page, path, options = {}) => page.evaluate(async ({ path, options }) => {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  return { status: response.status, body: await response.json() };
}, { path, options });

test('manual reversing journal is created once after posting and remains editable Saved', async ({ page }) => {
  const date='2026-06-01';
  await openView(page,'/finance/journal/new','#newJe');await expect(page.locator('#jReversalDateWrap')).toHaveClass(/hidden/);await page.locator('#jReversing').check();await expect(page.locator('#jReversalDate')).toHaveValue(/\d{4}-\d{2}-01/);
  const created=await api(page,'/api/finance/journal-transactions',{method:'POST',body:JSON.stringify({transactionDate:'2026-05-20',description:'Accrual to reverse',isReversingJournalRequested:true,reversalDate:date,lines:[{account:'1079',branch:'100',department:'OPS',debit:75,credit:0,lineDescription:'Accrued cash'},{account:'2010',branch:'100',department:'OPS',debit:0,credit:75,lineDescription:'Accrued liability'}]})});
  expect(created.status).toBe(201);
  let journals=(await api(page,'/api/finance/journal-transactions')).body;
  expect(journals.filter(j=>j.reversesJournalEntryNumber===created.body.jeNumber)).toHaveLength(0);

  const firstPost=await api(page,'/api/finance/journal-transactions/post',{method:'POST',body:JSON.stringify({jeNumber:created.body.jeNumber})});
  expect(firstPost.status).toBe(200);
  const duplicatePost=await api(page,'/api/finance/journal-transactions/post',{method:'POST',body:JSON.stringify({jeNumber:created.body.jeNumber})});
  expect(duplicatePost.body.alreadyPosted).toBe(true);
  journals=(await api(page,'/api/finance/journal-transactions')).body;
  const original=journals.find(j=>j.jeNumber===created.body.jeNumber),reversals=journals.filter(j=>j.reversesJournalEntryNumber===created.body.jeNumber);
  expect(reversals).toHaveLength(1);
  const reversal=reversals[0];
  expect(reversal.status).toBe('Saved');expect(reversal.transactionDate).toBe(date);expect(reversal.lines[0]).toMatchObject({account:'1079',department:'OPS',debit:0,credit:75});expect(reversal.lines[1]).toMatchObject({account:'2010',department:'OPS',debit:75,credit:0});
  expect(original.reversingJournalEntryNumber).toBe(reversal.jeNumber);

  await openView(page,`/finance/journal/${original.jeNumber}`,'#jeLines');
  await expect(page.locator(`a[href='/finance/journal/${reversal.jeNumber}']`)).toContainText(reversal.jeNumber);
  await openView(page,`/finance/journal/${reversal.jeNumber}`,'#jeLines');
  await expect(page.locator(`a[href='/finance/journal/${original.jeNumber}']`)).toContainText(original.jeNumber);
  await page.locator('#jeDescription').fill('Edited reversal for review');
  await page.locator('.je-line-description').first().fill('Edited reversing line');
  await page.locator('#jeSave').click();
  await expect(page.locator('.erp-dialog')).toContainText('Journal saved');
  const saved=(await api(page,`/api/finance/journal-transactions/${reversal.jeNumber}`)).body;
  expect(saved.description).toBe('Edited reversal for review');expect(saved.lines[0].lineDescription).toBe('Edited reversing line');
  const unchanged=(await api(page,`/api/finance/journal-transactions/${original.jeNumber}`)).body;
  expect(unchanged.description).toBe('Accrual to reverse');
  const bulk=await api(page,'/api/finance/journal-transactions/post-selected',{method:'POST',body:JSON.stringify({jeNumbers:[reversal.jeNumber]})});
  expect(bulk.body).toMatchObject({posted:1,failed:0});
  expect((await api(page,`/api/finance/journal-transactions/${reversal.jeNumber}`)).body.status).toBe('Posted');
});

test('closed reversal period still allows Saved generation but blocks posting clearly', async ({ page }) => {
  const close=await api(page,'/api/finance/financial-periods/action',{method:'POST',body:JSON.stringify({periodId:'2031-11',module:'GL',action:'Close',notes:'Reversal test'})});
  expect(close.status).toBe(200);
  const created=await api(page,'/api/finance/journal-transactions',{method:'POST',body:JSON.stringify({transactionDate:'2026-05-20',description:'Closed period reversal',isReversingJournalRequested:true,reversalDate:'2031-11-01',lines:[{account:'1079',branch:'100',debit:30,credit:0},{account:'2010',branch:'100',debit:0,credit:30}]})});
  await api(page,'/api/finance/journal-transactions/post',{method:'POST',body:JSON.stringify({jeNumber:created.body.jeNumber})});
  const journals=(await api(page,'/api/finance/journal-transactions')).body,reversal=journals.find(j=>j.reversesJournalEntryNumber===created.body.jeNumber);
  expect(reversal.status).toBe('Saved');
  const posting=await api(page,'/api/finance/journal-transactions/post',{method:'POST',body:JSON.stringify({jeNumber:reversal.jeNumber})});
  expect(posting.status).toBe(400);expect(posting.body.error).toContain('GL period 2031-11 is closed');
  expect((await api(page,`/api/finance/journal-transactions/${reversal.jeNumber}`)).body.status).toBe('Saved');
});

test('unchecked manual journal creates no reversal and old process redirects safely', async ({ page }) => {
  const created=await api(page,'/api/finance/journal-transactions',{method:'POST',body:JSON.stringify({transactionDate:'2026-05-20',description:'Normal manual journal',lines:[{account:'1079',branch:'100',debit:25,credit:0},{account:'2010',branch:'100',debit:0,credit:25}]})});
  await api(page,'/api/finance/journal-transactions/post',{method:'POST',body:JSON.stringify({jeNumber:created.body.jeNumber})});
  const journals=(await api(page,'/api/finance/journal-transactions')).body;
  expect(journals.filter(j=>j.reversesJournalEntryNumber===created.body.jeNumber)).toHaveLength(0);
  await openView(page,'/finance/processes/reverse-journals','#jeGrid');
  await expect(page).toHaveURL('/finance/journal');
  await expect(page.locator("#ar-nav a[href='/finance/processes/reverse-journals']")).toHaveCount(0);
});
