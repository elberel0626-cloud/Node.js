import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BALANCE_SHEET_ACCOUNT_CODES,
  PROFIT_LOSS_ACCOUNT_CODES,
  applyStatementClassification,
  broadAccountTypeForAccount,
  financialStatementForAccount
} from '../src/accountStatementClassification.js';

test('supplied balance sheet and P&L account lists are authoritative and non-overlapping', () => {
  assert.equal(BALANCE_SHEET_ACCOUNT_CODES.length, 176);
  assert.equal(PROFIT_LOSS_ACCOUNT_CODES.length, 181);
  assert.equal(new Set(BALANCE_SHEET_ACCOUNT_CODES).size, 176);
  assert.equal(new Set(PROFIT_LOSS_ACCOUNT_CODES).size, 181);
  assert.equal(BALANCE_SHEET_ACCOUNT_CODES.some(code => PROFIT_LOSS_ACCOUNT_CODES.includes(code)), false);

  for (const code of BALANCE_SHEET_ACCOUNT_CODES) {
    assert.equal(financialStatementForAccount(code), 'BalanceSheet', code);
    assert.equal(broadAccountTypeForAccount(code), 'Asset/Liability', code);
  }
  for (const code of PROFIT_LOSS_ACCOUNT_CODES) {
    assert.equal(financialStatementForAccount(code), 'ProfitLoss', code);
    assert.equal(broadAccountTypeForAccount(code), 'Income/Expense', code);
  }
});

test('previously omitted balance sheet accounts stay on the balance sheet', () => {
  for (const code of ['1212','1412','1606','1607','1715','1738','1963','2051','2118','2191','2250','2288','2409','2480','2603','2604','3010','3030','3080']) {
    assert.equal(financialStatementForAccount(code), 'BalanceSheet', code);
  }
});

test('unlisted accounts can preserve an explicit statement fallback', () => {
  assert.equal(financialStatementForAccount('9000'), 'ProfitLoss');
  assert.equal(financialStatementForAccount('9000', 'BalanceSheet'), 'BalanceSheet');
  assert.equal(broadAccountTypeForAccount('9000', 'BalanceSheet'), 'Asset/Liability');
});

test('startup classification corrects broad legacy types and preserves specific account types', () => {
  const accounts = [
    { code:'3010', accountType:'Income/Expense' },
    { code:'4001', accountType:'Asset/Liability' },
    { code:'5110', accountType:'Expense' },
    { code:'9000', accountType:'Asset' }
  ];
  applyStatementClassification(accounts);
  assert.deepEqual(accounts, [
    { code:'3010', accountType:'Asset/Liability', financialStatement:'BalanceSheet' },
    { code:'4001', accountType:'Income/Expense', financialStatement:'ProfitLoss' },
    { code:'5110', accountType:'Expense', financialStatement:'ProfitLoss' },
    { code:'9000', accountType:'Asset', financialStatement:'BalanceSheet' }
  ]);
});
