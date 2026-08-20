import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FINANCIAL_STATEMENT_SOURCE_ROW_COUNT,
  FINANCIAL_STATEMENT_MAPPING,
  BALANCE_SHEET_ACCOUNT_CODES,
  PROFIT_LOSS_ACCOUNT_CODES,
  applyStatementClassification,
  broadAccountTypeForAccount,
  financialReportMappingForAccount,
  financialStatementForAccount
} from '../src/accountStatementClassification.js';

test('supplied financial statement mapping is authoritative and non-overlapping', () => {
  assert.equal(FINANCIAL_STATEMENT_SOURCE_ROW_COUNT, 252);
  assert.equal(FINANCIAL_STATEMENT_MAPPING.length, 250);
  assert.equal(BALANCE_SHEET_ACCOUNT_CODES.length, 101);
  assert.equal(PROFIT_LOSS_ACCOUNT_CODES.length, 149);
  assert.equal(new Set(BALANCE_SHEET_ACCOUNT_CODES).size, 101);
  assert.equal(new Set(PROFIT_LOSS_ACCOUNT_CODES).size, 149);
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

test('FS, FS5, and Type map exact report placement', () => {
  assert.deepEqual(financialReportMappingForAccount('1039'), {
    accountCode:'1039', fs:'BS', statement:'BalanceSheet', accountType:'Asset', fs5:'Asset', reportGroup:'Cash', type:'Cash'
  });
  assert.equal(financialReportMappingForAccount('2010').fs5, 'Liability');
  assert.equal(financialReportMappingForAccount('2010').reportGroup, 'Payables - Net');
  assert.equal(financialReportMappingForAccount('3082').fs5, 'Equity');
  assert.equal(financialReportMappingForAccount('4008').fs5, 'Revenue');
  assert.equal(financialReportMappingForAccount('4008').reportGroup, 'SALES');
  assert.equal(financialReportMappingForAccount('5111').reportGroup, 'SG&A');
  assert.equal(financialReportMappingForAccount('6031').reportGroup, 'NON EBITDA');
});

test('duplicate source account codes resolve to their one consistent mapping', () => {
  assert.equal(financialReportMappingForAccount('1516').reportGroup, 'Inventory - Net');
  assert.equal(financialReportMappingForAccount('2615').reportGroup, 'General Liability - ST');
});

test('unlisted accounts can preserve an explicit statement fallback', () => {
  assert.equal(financialStatementForAccount('9000'), 'ProfitLoss');
  assert.equal(financialStatementForAccount('9000', 'BalanceSheet'), 'BalanceSheet');
  assert.equal(broadAccountTypeForAccount('9000', 'BalanceSheet'), 'Asset/Liability');
});

test('startup classification applies mapped statement, FS5 type, and report group', () => {
  const accounts = [
    { code:'1039', accountType:'Income/Expense', reportGroup:'Wrong' },
    { code:'2010', accountType:'Asset/Liability' },
    { code:'4008', accountType:'Asset/Liability' },
    { code:'5111', accountType:'Expense' },
    { code:'9000', accountType:'Asset' }
  ];
  applyStatementClassification(accounts);
  assert.deepEqual(accounts, [
    { code:'1039', accountType:'Asset', reportGroup:'Cash', financialStatement:'BalanceSheet' },
    { code:'2010', accountType:'Liability', reportGroup:'Payables - Net', financialStatement:'BalanceSheet' },
    { code:'4008', accountType:'Revenue', reportGroup:'SALES', financialStatement:'ProfitLoss' },
    { code:'5111', accountType:'Expense', reportGroup:'SG&A', financialStatement:'ProfitLoss' },
    { code:'9000', accountType:'Asset', financialStatement:'BalanceSheet' }
  ]);
});
