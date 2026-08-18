import { test, expect, openView } from './fixtures/authenticated.js';

test.describe.configure({ mode: 'serial' });

const accountRow = (page, code) => page.locator('#coaManageGrid tbody tr').filter({ has: page.locator(`.coa-code[value="${code}"]`) });
const accounts = page => page.evaluate(async () => (await fetch('/api/finance/chart-of-accounts')).json());

test('pending Chart of Accounts edits reset or navigate away without persisting, while Save persists toggles', async ({ page }) => {
  await openView(page, '/finance/chart-of-accounts', '#coaManageGrid');
  const original = (await accounts(page)).find(row => row.accountNumber === '1039');
  await accountRow(page, '1039').locator('.coa-name').fill('Unsaved account title');
  await accountRow(page, '1039').locator('.coa-active').uncheck();
  await page.getByRole('button', { name: 'Cancel Changes' }).click();
  await expect(accountRow(page, '1039').locator('.coa-name')).toHaveValue(original.accountTitle);
  await accountRow(page, '1039').locator('.coa-name').fill('Also not saved');
  await openView(page, '/finance?from=coa', '#view');
  expect((await accounts(page)).find(row => row.accountNumber === '1039').accountTitle).toBe(original.accountTitle);

  await openView(page, '/finance/chart-of-accounts', '#coaManageGrid');
  await accountRow(page, '1039').locator('.coa-active').uncheck();
  await accountRow(page, '1039').locator('.coa-manual').uncheck();
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.locator('#coaMessage')).toContainText('saved successfully');
  const saved = (await accounts(page)).find(row => row.accountNumber === '1039');
  expect(saved.active).toBe(false);
  expect(saved.allowManualJournalEntry).toBe(false);
  await openView(page, '/finance/journal/new', '#jlines');
  await expect(page.locator('.acctSel option[value="1039"]')).toHaveCount(0);

  await openView(page, '/finance/chart-of-accounts', '#coaManageGrid');
  await accountRow(page, '1039').locator('.coa-active').check();
  await accountRow(page, '1039').locator('.coa-manual').check();
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await openView(page, '/finance/journal/new', '#jlines');
  await expect(page.locator('.acctSel option[value="1039"]').first()).toBeAttached();
});

test('adds and safely deletes an unused account', async ({ page }) => {
  await openView(page, '/finance/chart-of-accounts', '#coaManageGrid');
  await page.getByRole('button', { name: 'Add Account' }).click();
  const row = page.locator('#coaManageGrid tbody tr').last();
  await row.locator('.coa-code').fill('999901');
  await row.locator('.coa-name').fill('E2E Clearing Account');
  await row.locator('.coa-type').selectOption({ label: 'Asset' });
  await page.getByRole('button', { name: 'Remove Account' }).last().click();
  expect((await accounts(page)).some(item => item.accountNumber === '999901')).toBe(false);
  await page.getByRole('button', { name: 'Add Account' }).click();
  const savedRow = page.locator('#coaManageGrid tbody tr').last();
  await savedRow.locator('.coa-code').fill('999901');
  await savedRow.locator('.coa-name').fill('E2E Clearing Account');
  await savedRow.locator('.coa-type').selectOption({ label: 'Asset' });
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.locator('#coaMessage')).toContainText('saved successfully');
  expect((await accounts(page)).some(item => item.accountNumber === '999901')).toBe(true);
  await accountRow(page, '999901').getByRole('button', { name: 'Remove Account' }).click();
  await page.locator('#coaRemoveCode').fill('999901');
  await page.getByRole('button', { name: 'Mark Pending Removal' }).click();
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await page.locator('dialog').getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.locator('#coaMessage')).toContainText('saved successfully');
  expect((await accounts(page)).some(item => item.accountNumber === '999901')).toBe(false);
});

test('validates duplicate codes and blocks deletion of referenced accounts', async ({ page }) => {
  await openView(page, '/finance/chart-of-accounts', '#coaManageGrid');
  await page.getByRole('button', { name: 'Add Account' }).click();
  let row = page.locator('#coaManageGrid tbody tr').last();
  await row.locator('.coa-code').fill('1039');
  await row.locator('.coa-name').fill('Duplicate');
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.locator('#coaMessage')).toContainText('unique');
  await page.getByRole('button', { name: 'Cancel Changes' }).click();

  await accountRow(page, '1507').getByRole('button', { name: 'Remove Account' }).click();
  await expect(page.locator('dialog')).toContainText(/cannot be deleted|journal history|referenced/i);
  await page.getByRole('button', { name: 'Deactivate Instead' }).click();
  await page.getByRole('button', { name: 'Cancel Changes' }).click();
  expect((await accounts(page)).some(item => item.accountNumber === '1507')).toBe(true);
});

test('server rejects manual journals that bypass an account lookup restriction', async ({ page }) => {
  await openView(page, '/finance/chart-of-accounts', '#coaManageGrid');
  await accountRow(page, '1039').locator('.coa-manual').uncheck();
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.locator('#coaMessage')).toContainText('saved successfully');
  const response = await page.evaluate(async () => {
    const result = await fetch('/api/finance/journal-transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionDate: '2026-08-18', description: 'restricted account bypass', lines: [{ branch: '100', account: '1039', debit: 1, credit: 0 }, { branch: '100', account: '1041', debit: 0, credit: 1 }] }) });
    return { status: result.status, text: await result.text() };
  });
  expect(response.status).toBe(400);
  expect(response.text).toContain('does not allow manual journal entries');
  await openView(page, '/finance/chart-of-accounts', '#coaManageGrid');
  await accountRow(page, '1039').locator('.coa-manual').check();
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.locator('#coaMessage')).toContainText('saved successfully');
});

