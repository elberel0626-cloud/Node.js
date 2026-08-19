export const BALANCE_SHEET_ACCOUNT_CODES = Object.freeze([
  '1039','1041','1044','1045','1071','1079','1081','1083','1084','1090','1091',
  '1210','1211','1212','1214','1215','1216','1217','1220','1411','1412','1505',
  '1507','1508','1509','1510','1511','1512','1513','1514','1515','1516','1601',
  '1603','1606','1607','1608','1610','1611','1612','1650','1651','1653','1654',
  '1710','1715','1718','1720','1728','1730','1738','1740','1748','1750','1751',
  '1752','1753','1754','1755','1756','1757','1758','1759','1760','1768','1770',
  '1780','1786','1790','1798','1810','1820','1825','1830','1832','1840','1845',
  '1860','1951','1960','1961','1962','1963','1970','1971','1972','1973','1974',
  '1975','1976','1977','1979','1980','1981','1982','1983','1984','1994','1995',
  '1996','1997','1998','1999','2010','2011','2012','2020','2050','2051','2101',
  '2105','2118','2183','2188','2190','2191','2193','2194','2195','2196','2197',
  '2198','2199','2250','2275','2283','2287','2288','2289','2290','2291','2292',
  '2293','2294','2295','2296','2297','2298','2299','2404','2405','2406','2407',
  '2408','2409','2410','2411','2412','2413','2414','2415','2420','2440','2450',
  '2460','2470','2475','2480','2510','2602','2603','2604','2605','2606','2615',
  '2619','2620','2621','2622','3010','3030','3080','3082','3083','3084','3090'
]);

export const PROFIT_LOSS_ACCOUNT_CODES = Object.freeze([
  '4001','4005','4008','4009','4010','4012','4016','4020','4021','4025','4030',
  '4031','4032','4036','4040','4042','4043','4045','4046','4050','4070','4071',
  '4075','4080','5101','5109','5110','5111','5113','5114','5115','5119','5120',
  '5130','5135','5145','5150','5160','5161','5162','5164','5175','5201','6010',
  '6011','6012','6030','6031','6032','6033','6040','6041','6042','6043','6044',
  '6045','6046','6050','6060','6061','6062','6066','6070','6080','6082','6085',
  '6086','6087','6090','6110','6111','6200','6203','6210','6212','6213','6215',
  '6220','6230','6231','6232','6239','6240','6241','6242','6243','6244','6245',
  '6250','6251','6252','6253','6254','6256','6257','6258','6262','6270','6295',
  '6300','6305','6307','6310','6311','6312','6315','6325','6326','6340','6341',
  '6342','6343','6345','6346','6350','6355','6358','6359','6360','6361','6370',
  '6371','6375','6391','6400','6432','6433','6435','6440','6443','6445','6448',
  '6449','6450','6451','6452','6453','6454','6455','6460','6490','6570','6571',
  '6580','6581','6582','6583','6585','6610','6631','6632','6633','6634','6635',
  '6636','6637','6638','6639','6640','6641','6642','6643','6644','6645','6646',
  '6661','6667','6669','6680','6687','6688','6689','6690','6691','6692','6693',
  '6694','6695','6696','6697','6698'
]);

const balanceSheetSet = new Set(BALANCE_SHEET_ACCOUNT_CODES);
const profitLossSet = new Set(PROFIT_LOSS_ACCOUNT_CODES);

const normalizeFallback = fallback =>
  fallback === 'BalanceSheet' || fallback === 'ProfitLoss' ? fallback : 'ProfitLoss';

export function financialStatementForAccount(accountCode, fallback = 'ProfitLoss') {
  const code = String(accountCode ?? '').trim();
  if (balanceSheetSet.has(code)) return 'BalanceSheet';
  if (profitLossSet.has(code)) return 'ProfitLoss';
  return normalizeFallback(fallback);
}

export function broadAccountTypeForAccount(accountCode, fallback = 'ProfitLoss') {
  return financialStatementForAccount(accountCode, fallback) === 'BalanceSheet' ? 'Asset/Liability' : 'Income/Expense';
}

function fallbackStatementForAccount(account) {
  if (account?.financialStatement === 'BalanceSheet' || account?.financialStatement === 'ProfitLoss') {
    return account.financialStatement;
  }
  return ['Asset', 'Liability', 'Equity', 'Asset/Liability'].includes(account?.accountType)
    ? 'BalanceSheet'
    : 'ProfitLoss';
}

export function applyStatementClassification(accounts = []) {
  for (const account of accounts) {
    const code = String(account?.code ?? account?.accountNumber ?? '').trim();
    if (!code) continue;
    const statement = financialStatementForAccount(code, fallbackStatementForAccount(account));
    account.financialStatement = statement;
    if (!account.accountType || ['Asset/Liability', 'Income/Expense'].includes(account.accountType)) {
      account.accountType = statement === 'BalanceSheet' ? 'Asset/Liability' : 'Income/Expense';
    }
  }
  return accounts;
}
