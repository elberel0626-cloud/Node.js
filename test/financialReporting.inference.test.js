import test from 'node:test';
import assert from 'node:assert/strict';
import {createFinancialReportingService} from '../src/financialReporting.js';

test('cash flow infers classifications for current posted activity when COA metadata is absent',()=>{
 const accounts=[
  {code:'1079',name:'Cash - 5/3 Operating Account',accountType:'Asset/Liability',balance:1100},
  {code:'1210',name:'Accounts Receivable',accountType:'Asset/Liability',balance:500},
  {code:'2020',name:'Received Not Invoiced / Vouchered',accountType:'Asset/Liability',balance:-250},
  {code:'1730',name:'Machinery and Equipment',accountType:'Asset/Liability',balance:525},
  {code:'2195',name:'Cole Taylor - Revolving Loan',accountType:'Asset/Liability',balance:-875},
  {code:'4008',name:'Sales',accountType:'Income/Expense',balance:-200}
 ];
 const lines={
  '1079':[{postPeriod:'2026-08',debit:100,credit:0}],
  '1210':[{postPeriod:'2026-08',debit:100,credit:0}],
  '2020':[{postPeriod:'2026-08',debit:0,credit:50}],
  '1730':[{postPeriod:'2026-08',debit:25,credit:0}],
  '2195':[{postPeriod:'2026-08',debit:0,credit:75}],
  '4008':[{postPeriod:'2026-08',debit:0,credit:200}]
 };
 const service=createFinancialReportingService({accounts,postedLines:code=>lines[code]||[]});
 const cf=service.getCashFlow({fromPeriod:'2026-08',toPeriod:'2026-08'});
 const details=Object.fromEntries(cf.sections.flatMap(section=>section.groups.flatMap(group=>group.details.map(row=>[row.accountCode,{section:section.name,amount:row.amount}]))));
 assert.match(details['1210'].section,/OPERATING/);assert.equal(details['1210'].amount,-100);
 assert.match(details['2020'].section,/OPERATING/);assert.equal(details['2020'].amount,50);
 assert.match(details['1730'].section,/INVESTING/);assert.equal(details['1730'].amount,-25);
 assert.match(details['2195'].section,/FINANCING/);assert.equal(details['2195'].amount,75);
 assert.equal(cf.beginningCash,1000);assert.equal(cf.endingCash,1100);assert.equal(cf.netChange,100);
 assert.equal(cf.netIncome,200);
});
