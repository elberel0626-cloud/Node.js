import test from 'node:test';
import assert from 'node:assert/strict';
import {createFinancialReportingService} from '../src/financialReporting.js';
import {financialWorkbook} from '../src/xlsxWorkbook.js';
const accounts=[
 {code:'1000',name:'Cash',accountType:'Asset',balance:100000,financialStatement:'BalanceSheet',reportGroup:'Current Assets',cashEquivalent:true},
 {code:'1200',name:'Accounts Receivable',accountType:'Asset',balance:50000,financialStatement:'BalanceSheet',reportGroup:'Current Assets'},
 {code:'1500',name:'Inventory',accountType:'Asset',balance:75000,financialStatement:'BalanceSheet',reportGroup:'Current Assets'},
 {code:'1700',name:'Fixed Assets',accountType:'Asset',balance:200000,financialStatement:'BalanceSheet',reportGroup:'Property, Plant & Equipment',cashFlowClass:'Investing'},
 {code:'2000',name:'Accounts Payable',accountType:'Liability',balance:-80000,financialStatement:'BalanceSheet',reportGroup:'Current Liabilities',cashFlowClass:'Operating'},
 {code:'2500',name:'Debt',accountType:'Liability',balance:-120000,financialStatement:'BalanceSheet',reportGroup:'Long-Term Liabilities',cashFlowClass:'Financing'},
 {code:'3000',name:'Equity',accountType:'Equity',balance:-225000,financialStatement:'BalanceSheet',reportGroup:'Equity',retainedEarnings:true},
 {code:'4000',name:'Revenue',accountType:'Revenue',balance:-500000,financialStatement:'ProfitLoss',reportGroup:'Revenue'},
 {code:'5000',name:'Cost of Goods Sold',accountType:'Expense',balance:300000,financialStatement:'ProfitLoss',reportGroup:'Cost of Goods Sold'},
 {code:'6000',name:'Operating Expense',accountType:'Expense',balance:100000,financialStatement:'ProfitLoss',reportGroup:'Operating Expenses'}];
const lines={4000:[{postPeriod:'2026-07',debit:0,credit:500000}],5000:[{postPeriod:'2026-07',debit:300000,credit:0}],6000:[{postPeriod:'2026-07',debit:100000,credit:0}]};
const service=createFinancialReportingService({accounts,postedLines:code=>lines[code]||[],companyName:'Test Company'});
test('shared posted-GL reports prove controlled balances',()=>{const pl=service.getProfitAndLoss({fromPeriod:'2026-07',toPeriod:'2026-07'});assert.equal(pl.totalRevenue,500000);assert.equal(pl.totalExpenses,400000);assert.equal(pl.netIncome,100000);const bs=service.getBalanceSheet({asOf:'2026-07'});assert.equal(bs.totalAssets,425000);assert.equal(bs.totalLiabilitiesEquity,425000);assert.equal(bs.difference,0);assert.equal(bs.balanced,true);const cf=service.getCashFlow({fromPeriod:'2026-07',toPeriod:'2026-07'});assert.equal(cf.beginningCash+cf.netChange,cf.endingCash);const re=service.getRetainedEarningsStatement({fromPeriod:'2026-07',toPeriod:'2026-07'});assert.equal(re.endingRetainedEarnings,re.beginningRetainedEarnings+100000);});
test('monthly trend and genuine XLSX package contain required metadata',()=>{const pl=service.getProfitAndLoss({fromPeriod:'2025-08',toPeriod:'2026-07',view:'monthly'});assert.equal(pl.months.length,12);assert.deepEqual(pl.months.slice(0,2),['2025-08','2025-09']);assert.equal(pl.months.at(-1),'2026-07');const workbook=financialWorkbook({sheetName:'Profit & Loss',title:'Test Company — Profit & Loss',period:'2025-08 through 2026-07',headers:['Account','Amount'],rows:[['Revenue',500000],['Net Income',100000]]});assert.equal(workbook.subarray(0,2).toString(),'PK');assert.ok(workbook.length>1500);assert.ok(workbook.includes(Buffer.from('workbook.xml')));});

test('mapped financial reports never change sections just because an account is contra or negative',()=>{
 const mappedAccounts=[
  {code:'1039',name:'Cash',accountType:'Asset/Liability',balance:100},
  {code:'1215',name:'Allowance For Doubtful Accounts',accountType:'Asset/Liability',balance:-10},
  {code:'2010',name:'Account Payable - Trade',accountType:'Asset/Liability',balance:-30},
  {code:'3082',name:'Equity',accountType:'Asset/Liability',balance:-60},
  {code:'4008',name:'Equipment Sales - M & R',accountType:'Income/Expense',balance:0},
  {code:'4025',name:'Sales Discount',accountType:'Income/Expense',balance:0},
  {code:'5110',name:'Raw Materials',accountType:'Income/Expense',balance:0},
  {code:'6010',name:'Advertising',accountType:'Income/Expense',balance:0},
  {code:'6031',name:'Amortization - Trade Name',accountType:'Income/Expense',balance:0}
 ];
 const mappedLines={
  4008:[{postPeriod:'2026-07',debit:0,credit:1000}],
  4025:[{postPeriod:'2026-07',debit:100,credit:0}],
  5110:[{postPeriod:'2026-07',debit:500,credit:0}],
  6010:[{postPeriod:'2026-07',debit:200,credit:0}],
  6031:[{postPeriod:'2026-07',debit:50,credit:0}]
 };
 const mappedService=createFinancialReportingService({accounts:mappedAccounts,postedLines:code=>mappedLines[code]||[]});
 const bs=mappedService.getBalanceSheet({asOf:'2026-07'});
 assert.deepEqual(bs.sections.map(section=>section.name),['ASSETS','LIABILITIES','EQUITY']);
 assert.equal(bs.sections[0].groups.find(group=>group.name==='Receivables - Net').details[0].amount,-10);
 assert.equal(bs.sections[1].groups.find(group=>group.name==='Payables - Net').details[0].amount,30);
 assert.equal(bs.totalAssets,90);
 assert.equal(bs.totalLiabilities,30);
 assert.equal(bs.totalEquity,60);
 assert.equal(bs.balanced,true);

 const pl=mappedService.getProfitAndLoss({fromPeriod:'2026-07',toPeriod:'2026-07'});
 const sales=pl.sections[0].groups.find(group=>group.name==='SALES');
 assert.equal(sales.details.find(row=>row.accountCode==='4025').amount,-100);
 assert.equal(pl.sections[1].groups.find(group=>group.name==='COGS').total,500);
 assert.equal(pl.sections[1].groups.find(group=>group.name==='SG&A').total,200);
 assert.equal(pl.sections[1].groups.find(group=>group.name==='NON EBITDA').total,50);
 assert.equal(pl.totalRevenue,900);
 assert.equal(pl.totalExpenses,750);
 assert.equal(pl.netIncome,150);
});
