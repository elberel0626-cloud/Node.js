import assert from 'node:assert/strict';
import test from 'node:test';
import { BALANCE_SHEET_ACCOUNT_CODES, applyStatementClassification, broadAccountTypeForAccount, financialStatementForAccount } from '../src/accountStatementClassification.js';

test('configured balance sheet account list is authoritative', () => {
  assert.equal(BALANCE_SHEET_ACCOUNT_CODES.length, 123);
  for (const code of ['1039','1210','1507','2010','2622','3082','3090']) {
    assert.equal(financialStatementForAccount(code), 'BalanceSheet', code);
    assert.equal(broadAccountTypeForAccount(code), 'Asset/Liability', code);
  }
});

test('accounts not in the supplied balance sheet list are P&L', () => {
  for (const code of ['1212','1412','1606','1715','2051','3010','3030','3080','4001','5110','6999']) {
    assert.equal(financialStatementForAccount(code), 'ProfitLoss', code);
    assert.equal(broadAccountTypeForAccount(code), 'Income/Expense', code);
  }
});

test('startup classification updates legacy broad types while preserving specific account types', () => {
  const accounts = [
    { code:'1039', accountType:'Income/Expense' },
    { code:'4001', accountType:'Asset/Liability' },
    { code:'5110', accountType:'Expense' }
  ];
  applyStatementClassification(accounts);
  assert.deepEqual(accounts, [
    { code:'1039', accountType:'Asset/Liability', financialStatement:'BalanceSheet' },
    { code:'4001', accountType:'Income/Expense', financialStatement:'ProfitLoss' },
    { code:'5110', accountType:'Expense', financialStatement:'ProfitLoss' }
  ]);
});
