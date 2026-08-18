import test from 'node:test';
import assert from 'node:assert/strict';
import { accountUsage, buildChartChangeSet, chartAudit } from '../src/chartOfAccounts.js';

const account=(code='9000',overrides={})=>({code,name:`Account ${code}`,accountType:'Asset',normal:'Debit',active:true,allowManualJournalEntry:true,balance:0,debits:0,credits:0,...overrides});
const row=value=>({originalAccountNumber:value.code,accountNumber:value.code,accountTitle:value.name,accountType:value.accountType,active:value.active,allowManualJournalEntry:value.allowManualJournalEntry});

test('zero balance does not override historical journal usage',()=>{
  const usage=accountUsage('9000',{journals:[{status:'Posted',lines:[{account:'9000'}]}]});
  assert.equal(usage.deletable,false);assert.equal(usage.hasHistory,true);
});

test('draft journals and configuration protect accounts',()=>{
  assert.equal(accountUsage('9000',{journals:[{status:'Draft',lines:[{account:'9000'}]}]}).deletable,false);
  const configured=accountUsage('9000',{configuration:[{postingAccount:'9000'}]});
  assert.equal(configured.deletable,false);assert.equal(configured.protected,true);
});

test('transaction and setup account fields block removal',()=>{
  assert.equal(accountUsage('9000',{transactions:[{lines:[{expenseAccount:'9000'}]}]}).deletable,false);
});

test('unused account can be removed but revalidation blocks a later reference',()=>{
  const existing=account(),payload={accounts:[],removeAccountCodes:['9000']};
  assert.equal(buildChartChangeSet([existing],payload,()=>accountUsage('9000')).final.length,0);
  assert.throws(()=>buildChartChangeSet([existing],payload,()=>accountUsage('9000',{transactions:[{cashAccount:'9000'}]})),/cannot be deleted/i);
});

test('used account code change is blocked and unused change remains unique',()=>{
  const existing=account(),changed={...row(existing),accountNumber:'9001'};
  assert.throws(()=>buildChartChangeSet([existing],{accounts:[changed]},()=>({deletable:false,hasHistory:true})),/cannot be changed/i);
  assert.equal(buildChartChangeSet([existing],{accounts:[changed]},()=>({deletable:true,hasHistory:false})).final[0].code,'9001');
});

test('historical type change requires explicit confirmation',()=>{
  const existing=account(),changed={...row(existing),accountType:'Expense'};
  assert.throws(()=>buildChartChangeSet([existing],{accounts:[changed]},()=>({deletable:false,hasHistory:true})),/explicit confirmation/i);
  changed.confirmAccountTypeChange=true;assert.equal(buildChartChangeSet([existing],{accounts:[changed]},()=>({deletable:false,hasHistory:true})).final[0].accountType,'Expense');
});

test('duplicate code and invalid change leave the source array untouched',()=>{
  const source=[account('9000'),account('9001')],before=structuredClone(source);
  assert.throws(()=>buildChartChangeSet(source,{accounts:[row(source[0]),{...row(source[1]),accountNumber:'9000'}]},()=>({deletable:true,hasHistory:false})),/already exists/i);
  assert.deepEqual(source,before);
});

test('audit is produced only from a successfully validated change set',()=>{
  const existing=account(),changed={...row(existing),active:false,allowManualJournalEntry:false};
  const set=buildChartChangeSet([existing],{accounts:[changed]},()=>({deletable:true,hasHistory:false}));
  assert.deepEqual(chartAudit(set,{user:'tester',timestamp:'now'}).map(item=>item.action),['Account Deactivated','Manual JE Permission Disabled']);
  assert.throws(()=>buildChartChangeSet([existing],{accounts:[{...changed,accountType:'Unknown'}]},()=>({deletable:true,hasHistory:false})),/valid account type/i);
});

