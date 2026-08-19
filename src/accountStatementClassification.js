export const BALANCE_SHEET_ACCOUNT_CODES = Object.freeze([
  '1039','1041','1044','1045','1071','1079','1081','1083','1084','1090','1091',
  '1210','1211','1214','1215','1216','1217','1220','1411','1505','1507','1508','1509','1510','1511','1512','1513','1514','1515','1516',
  '1601','1603','1608','1611','1612','1653','1654','1710','1718','1720','1728','1730','1740','1748','1760','1768','1770','1780','1786',
  '1810','1820','1825','1830','1832','1840','1845','1860','1951','1960','1961','1962','1970','1971','1972','1973','1977','1979','1980','1982','1994','1995','1996',
  '2010','2011','2012','2020','2050','2101','2105','2183','2188','2190','2198','2199','2275','2283','2287','2289','2290','2291','2295','2296','2298',
  '2404','2405','2406','2407','2408','2410','2411','2412','2413','2414','2415','2420','2440','2450','2460','2470','2475','2510',
  '2602','2605','2606','2615','2619','2620','2621','2622','3082','3083','3084','3090'
]);

const balanceSheetSet = new Set(BALANCE_SHEET_ACCOUNT_CODES);

export function financialStatementForAccount(accountCode) {
  return balanceSheetSet.has(String(accountCode ?? '').trim()) ? 'BalanceSheet' : 'ProfitLoss';
}

export function broadAccountTypeForAccount(accountCode) {
  return financialStatementForAccount(accountCode) === 'BalanceSheet' ? 'Asset/Liability' : 'Income/Expense';
}

export function applyStatementClassification(accounts = []) {
  for (const account of accounts) {
    const code = String(account?.code ?? account?.accountNumber ?? '').trim();
    if (!code) continue;
    const statement = financialStatementForAccount(code);
    account.financialStatement = statement;
    if (!account.accountType || ['Asset/Liability', 'Income/Expense'].includes(account.accountType)) {
      account.accountType = broadAccountTypeForAccount(code);
    }
  }
  return accounts;
}
