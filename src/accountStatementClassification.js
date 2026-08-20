const SOURCE_ROW_COUNT=252;
const GROUPS=Object.freeze([
  ['BS','Asset',"Cash",['1039','1041','1044','1045','1079','1081','1084','1091']],
  ['BS','Asset',"Receivables - Net",['1210','1211','1215']],
  ['BS','Asset',"Current Assets - Other",['1214','1216','1220','1411','1601','1603','1608','1611','1612','1960']],
  ['BS','Asset',"Receivables - LT",['1217']],
  ['BS','Asset',"Inventory - Net",['1505','1507','1508','1509','1510','1511','1512','1513','1514','1515','1516']],
  ['BS','Asset',"Tax Asset",['1653','1654','1951']],
  ['BS','Asset',"Fixed Assets - Net",['1720','1728','1730','1740','1748','1760','1768','1770','1780','1786']],
  ['BS','Asset',"Intangible - Net",['1810','1820','1825','1832','1840','1845']],
  ['BS','Asset',"Lease Asset",['1860']],
  ['BS','Asset',"Long Term Assets - Other",['1961','1962']],
  ['BS','Asset',"Intercompany",['1970','1971','1973','1977','1980','1994','1996']],
  ['BS','Liability',"Payables - Net",['2010','2011','2020']],
  ['BS','Liability',"Loan - ST",['2012']],
  ['BS','Liability',"General Liability - ST",['2050','2275','2404','2406','2408','2411','2412','2413','2414','2420','2450','2475','2510','2615','2621']],
  ['BS','Liability',"Lease Liability",['2183','2283']],
  ['BS','Liability',"Loan - LT",['2190','2296']],
  ['BS','Liability',"General Liability - LT",['2287']],
  ['BS','Liability',"Accrued Compensation",['2405','2410','2415','2440','2460','2470','2602','2605','2606']],
  ['BS','Liability',"Accrued Interest",['2407']],
  ['BS','Liability',"Tax Liability",['2619','2620','2622']],
  ['BS','Equity',"Equity",['3082','3090']],
  ['IS','Revenue',"SALES",['4005','4008','4009','4010','4012','4020','4021','4025','4030','4032','4040','4045','4050','4070','4071','4075','4080']],
  ['IS','Expense',"COGS",['5101','5109','5110','5113','5114','5115','5120','5130','5135','5145','5150','5160','5161','5164','6012','6040','6213','6230','6231','6232','6244','6245','6345','6355','6370','6371','6391','6443','6454','6570','6581','6640','6661']],
  ['IS','Expense',"SG&A",['5111','5162','5175','6010','6011','6041','6042','6043','6044','6045','6050','6060','6061','6080','6082','6085','6087','6090','6200','6210','6212','6215','6239','6240','6241','6242','6243','6270','6300','6305','6307','6310','6312','6340','6341','6342','6346','6350','6358','6359','6361','6400','6432','6433','6435','6440','6445','6448','6449','6450','6451','6452','6453','6455','6460','6571','6631','6632','6633','6634','6635','6636','6637','6638','6639','6641','6642','6643','6644','6680','6687','6688','6689','6690','6691','6692','6693','6694','6695','6696','6697','6698']],
  ['IS','Expense',"NON EBITDA",['6031','6032','6070','6110','6111','6203','6250','6252','6256','6315','6343','6375','6582','6583','6585','6610','6667']],
]);

// Geography is the second reporting dimension supplied for the P&L.  Type
// (SALES / COGS / SG&A / NON EBITDA) remains the primary report group.  The
// source intentionally contains duplicate account rows for 6315 and 6610;
// later rows are authoritative, matching the supplied mapping order.
const PROFIT_LOSS_GEOGRAPHY_GROUPS=Object.freeze([
  ['Addback',['6203','6343','6375','6610','6667']],
  ['Allocated',['6687','6688','6689','6690','6691','6692','6693','6694','6695','6696','6697','6698']],
  ['Amortization',['6031','6032']],
  ['Bad Debt',['6050']],
  ['Bank Fees',['6060']],
  ['BLDG',['6391','6581']],
  ['Commissions',['6080']],
  ['Consulting',['6082','6340']],
  ['Credit Card Fees',['6061']],
  ['Depreciation',['6110','6111']],
  ['Employee Benefits',['6210','6242','6243','6346']],
  ['Freight - All',['5113','6230','6231']],
  ['HR Services',['6312','6358','6359']],
  ['Insurance',['6239','6240','6241']],
  ['Intercompany',['5175']],
  ['Interest',['6250','6252','6256']],
  ['Inv Adj',['5109','6012']],
  ['IT related (not salaries)',['6085','6087','6350']],
  ['Labor',['5120','5145','5150','5160','5161','5164','6244','6245','6345','6443','6570']],
  ['Marketing',['6010','6455']],
  ['Material',['5110','5114','6355']],
  ['Misc',['6090','6200','6270','6300','6305','6307','6315','6453']],
  ['Office Supplies',['6310','6460']],
  ['Other',['5101','5115','5130','5135','6040','6213','6232','6370','6371','6454','6640','6661']],
  ['Outside Services',['6215']],
  ['Payroll Taxes',['6571']],
  ['Phone & Internet',['6631','6632','6633']],
  ['R&D Material',['5111']],
  ['Royalty',['5162','6400']],
  ['Salaries',['6212','6432','6433','6435','6440','6445','6448','6449','6450','6451']],
  ['Selling Expenses',['6341']],
  ['Service Dept Exp',['6452']],
  ['T&E',['6041','6042','6043','6044','6045','6634','6635','6636','6637','6638','6639','6641','6642','6643','6644']],
  ['Taxes',['6070','6315','6582','6583','6585','6610']],
  ['Tech Dept Exp',['6011','6342']],
  ['Temporary Labor',['6361']],
  ['Warranty',['6680']],
  ['Consumables',['4012']],
  ['Equipment',['4008','4010']],
  ['Installations',['4021']],
  ['Misc',['4005','4009','4030','4032','4040','4045','4050','4070','4071','4075','4080']],
  ['Parts & Service',['4020']],
  ['Sales Discount',['4025']],
]);

const geographyByCode=new Map();
for(const [geography,codes] of PROFIT_LOSS_GEOGRAPHY_GROUPS){
  for(const accountCode of codes)geographyByCode.set(accountCode,geography);
}

const normalizeFallback=fallback=>fallback==='BalanceSheet'||fallback==='ProfitLoss'?fallback:'ProfitLoss';
const rows=[];
for(const [fs,fs5,reportGroup,codes] of GROUPS){
  for(const accountCode of codes){
    const base={accountCode,fs,statement:fs==='BS'?'BalanceSheet':'ProfitLoss',accountType:fs5,fs5,reportGroup,type:reportGroup};
    if(fs==='IS'){
      const geography=geographyByCode.get(accountCode)||'Unclassified';
      rows.push(Object.freeze({...base,reportSubgroup:geography,geography}));
    }else rows.push(Object.freeze(base));
  }
}
const mappingByCode=new Map(rows.map(row=>[row.accountCode,row]));
const balanceSheetCodes=rows.filter(row=>row.fs==='BS').map(row=>row.accountCode);
const profitLossCodes=rows.filter(row=>row.fs==='IS').map(row=>row.accountCode);

export const FINANCIAL_STATEMENT_SOURCE_ROW_COUNT=SOURCE_ROW_COUNT;
export const FINANCIAL_STATEMENT_MAPPING=Object.freeze(rows);
export const BALANCE_SHEET_ACCOUNT_CODES=Object.freeze(balanceSheetCodes);
export const PROFIT_LOSS_ACCOUNT_CODES=Object.freeze(profitLossCodes);

export function financialReportMappingForAccount(accountCode){
  return mappingByCode.get(String(accountCode??'').trim())||null;
}
export function financialStatementForAccount(accountCode,fallback='ProfitLoss'){
  return financialReportMappingForAccount(accountCode)?.statement||normalizeFallback(fallback);
}
export function mappedAccountTypeForAccount(accountCode,fallback=''){
  return financialReportMappingForAccount(accountCode)?.fs5||fallback;
}
export function broadAccountTypeForAccount(accountCode,fallback='ProfitLoss'){
  return financialStatementForAccount(accountCode,fallback)==='BalanceSheet'?'Asset/Liability':'Income/Expense';
}
function fallbackStatementForAccount(account){
  if(account?.financialStatement==='BalanceSheet'||account?.financialStatement==='ProfitLoss')return account.financialStatement;
  return ['Asset','Liability','Equity','Asset/Liability'].includes(account?.accountType)?'BalanceSheet':'ProfitLoss';
}
export function applyStatementClassification(accounts=[]){
  for(const account of accounts){
    const code=String(account?.code??account?.accountNumber??'').trim();
    if(!code)continue;
    const mapped=financialReportMappingForAccount(code);
    const statement=mapped?.statement||financialStatementForAccount(code,fallbackStatementForAccount(account));
    account.financialStatement=statement;
    if(mapped){
      account.accountType=mapped.fs5;
      account.reportGroup=mapped.reportGroup;
      if(mapped.reportSubgroup)account.reportSubgroup=mapped.reportSubgroup;
    }else if(!account.accountType||['Asset/Liability','Income/Expense'].includes(account.accountType)){
      account.accountType=statement==='BalanceSheet'?'Asset/Liability':'Income/Expense';
    }
  }
  return accounts;
}
