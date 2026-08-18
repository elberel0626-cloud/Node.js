import { test, expect, openView } from './fixtures/authenticated.js';

async function api(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin'
    });
    return { status: response.status, body: await response.json() };
  }, { path, method, body });
}

test('AP audit tab and posted journal relationship drill down with a normal click', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));

  await openView(page, '/ap/bills', '#apBillGrid');
  const invoiceNumber = `AUDIT-JE-${crypto.randomUUID()}`;
  const created = await api(page, '/api/ap/documents', 'POST', {
    type: 'Bill', vendorId: 'VEND-1001', date: '2026-08-18', dueDate: '2026-09-17',
    vendorRef: invoiceNumber, invoiceNumber, branch: '100', terms: 'NET30',
    lines: [{ description: 'AP audit and JE drilldown', qty: 1, uom: 'EA', unitCost: 64.25, discountAmount: 0, expenseAccount: '5110', branch: '100' }]
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const billNumber = created.body.id;

  await openView(page, `/ap/bills/${billNumber}`, '#billLines');
  await expect(page.getByRole('button', { name: 'Approvals & Audit Trail' })).toBeVisible();
  await expect(page.locator('#billDetails .approval-workflow-section')).toHaveCount(0);
  await page.getByRole('button', { name: 'Approvals & Audit Trail' }).click();
  await expect(page.locator('#billApprovals')).toBeVisible();
  await expect(page.locator('#billApprovals')).toContainText('Bill Created');

  const posted = await api(page, '/api/ap/documents/post', 'POST', { id: billNumber });
  expect(posted.status, JSON.stringify(posted.body)).toBe(200);
  const jeNumber = posted.body.journalEntryNumber;
  expect(jeNumber).toMatch(/^JE/);
  expect(posted.body.journalEntryId).toBeTruthy();

  const inquiryUrl = '/ap/bills';
  await openView(page, inquiryUrl, '#apBillGrid');
  const row = page.locator('#apBillGrid tbody tr').filter({ hasText: billNumber });
  const link = row.getByRole('link', { name: 'View Journal Entry' });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/finance/journal/${encodeURIComponent(jeNumber)}$`));
  await expect(page.locator('.journal-entry-screen')).toBeVisible();
  await expect(page.locator("input[value='AP']")).toBeVisible();
  await expect(page.locator(`a[href='/ap/bills/${billNumber}']`)).toBeVisible();
  await expect(page.locator('#jeDifference')).toContainText('$0.00');
  expect(errors, errors.join('\n')).toEqual([]);

  console.log(JSON.stringify({ billNumber, jeNumber, inquiryUrl, resultingUrl: new URL(page.url()).pathname, browserErrors: errors }));
});
