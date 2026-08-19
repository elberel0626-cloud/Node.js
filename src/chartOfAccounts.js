import { financialStatementForAccount } from './accountStatementClassification.js';

export const ACCOUNT_TYPES=['Asset','Liability','Equity','Revenue','Expense','Asset/Liability','Income/Expense'];

const CODE_PATTERN=/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/;
const containsAccount=(value,code,seen=new Set(),relevant=false)=>{
  if(value===null||value===undefined)return false;
  if(typeof value==='string'||typeof value==='number')return relevant&&String(value)===code;
  if(typeof value!=='object'||seen.has(value))return false;
  seen.add(value);
  if(Array.isArray(value))return value.some(item=>containsAccount(item,code,seen,relevant));
  return Object.entries(value).some(([key,item])=>containsAccount(item,code,seen,relevant||/(account|gl|ledger|control|posting|cash|bank|tax)/i.test(key)));
};

export function accountUsage(code,{journals=[],balances=[],periodHistory=[],transactions=[],configuration=[]}={}){
  const journal=journals.find(entry=>(entry.lines||[]).some(line=>String(line.account)===code));
  if(journal)return{deletable:false,hasHistory:true,protected:false,category:journal.status==='Posted'?'posted journal entry history':'saved or draft journal entry references',message:'Account has journal history'};
  if(balances.some(value=>containsAccount(value,code))||periodHistory.some(value=>containsAccount(value,code)))return{deletable:false,hasHistory:true,protected:false,category:'balance or financial-period history',message:'Account has balance or financial-period history'};
  if(configuration.some(value=>containsAccount(value,code)))return{deletable:false,hasHistory:false,protected:true,category:'ERP posting configuration',message:'This account is used by ERP posting configuration and cannot be deleted. Update the related configuration before attempting to remove the account.'};
  if(transactions.some(value=>containsAccount(value,code)))return{deletable:false,hasHistory:true,protected:false,category:'transaction or setup reference',message:'Account is referenced by an existing transaction or setup record'};
  return{deletable:true,hasHistory:false,protected:false,category:'unused',message:'No persisted history or references were found.'};
}

export function normalizeAccount(input,existing){
  const code=String(input.accountNumber??input.code??'').trim(),name=String(input.accountTitle??input.name??'').trim(),accountType=String(input.accountType||'').trim();
  if(!code)throw new Error('Account code is required.');
  if(!CODE_PATTERN.test(code))throw new Error(`Account code ${code} is invalid.`);
  if(!name)throw new Error(`Account name is required for account ${code}.`);
  if(!ACCOUNT_TYPES.includes(accountType))throw new Error(`Select a valid account type for account ${code}.`);
  const normal=['Liability','Equity','Revenue'].includes(accountType)?'Credit':['Asset','Expense'].includes(accountType)?'Debit':existing?.normal||'Debit';
  return{code,name,accountType,normal,active:input.active!==false,allowManualJournalEntry:input.allowManualJournalEntry!==false,balance:Number(existing?.balance||0),debits:Number(existing?.debits||0),credits:Number(existing?.credits||0),financialStatement:financialStatementForAccount(code),reportGroup:input.reportGroup??existing?.reportGroup??'',reportSubgroup:input.reportSubgroup??existing?.reportSubgroup??'',cashFlowClass:input.cashFlowClass??existing?.cashFlowClass??'None',cashEquivalent:input.cashEquivalent??existing?.cashEquivalent??false,retainedEarnings:input.retainedEarnings??existing?.retainedEarnings??false,distribution:input.distribution??existing?.distribution??false};
}

export function buildChartChangeSet(current,payload,usageFor){
  if(!Array.isArray(payload.accounts))throw new Error('A complete accounts list is required.');
  const currentByCode=new Map(current.map(account=>[account.code,account])),claimed=new Set(),updates=[],creates=[],removals=[];
  for(const row of payload.accounts){
    const originalCode=String(row.originalAccountNumber??row.accountNumber??row.code??'').trim(),existing=currentByCode.get(originalCode),next=normalizeAccount(row,existing);
    if(claimed.has(next.code))throw new Error(`Account code ${next.code} already exists.`);claimed.add(next.code);
    if(existing){
      const usage=usageFor(existing.code);
      if(next.code!==existing.code&&!usage.deletable)throw new Error(`Account code ${existing.code} cannot be changed because it has history or references. Create a new account and deactivate the old account.`);
      if(next.accountType!==existing.accountType&&usage.hasHistory&&!row.confirmAccountTypeChange)throw new Error(`Changing account type for historical account ${existing.code} requires explicit confirmation because it can affect financial reporting classification.`);
      updates.push({existing,next,usage});
    }else creates.push(next);
  }
  for(const code of payload.removeAccountCodes||[]){
    const existing=currentByCode.get(String(code));if(!existing)throw new Error(`Account ${code} no longer exists.`);
    const usage=usageFor(existing.code);if(!usage.deletable)throw new Error(`${usage.message} Account ${existing.code} cannot be deleted. Deactivate it instead.`);
    removals.push({existing,usage});
  }
  const removed=new Set(removals.map(item=>item.existing.code));
  for(const existing of current)if(!updates.some(item=>item.existing===existing)&&!removed.has(existing.code))throw new Error(`Account ${existing.code} is missing from the change set. Use the controlled removal workflow.`);
  const final=[...updates.map(item=>item.next),...creates];
  if(new Set(final.map(account=>account.code)).size!==final.length)throw new Error('Account codes must be unique.');
  return{updates,creates,removals,final};
}

export function chartAudit(changeSet,{user='system',timestamp=new Date().toISOString()}={}){
  const records=[],add=(action,code,previousValue,newValue)=>records.push({timestamp,user,action,accountCode:code,previousValue,newValue});
  for(const account of changeSet.creates)add('Account Created',account.code,null,account);
  for(const {existing,next} of changeSet.updates){
    if(existing.name!==next.name)add('Account Name Changed',next.code,existing.name,next.name);
    if(existing.accountType!==next.accountType)add('Account Type Changed',next.code,existing.accountType,next.accountType);
    if(existing.active!==next.active)add(next.active?'Account Activated':'Account Deactivated',next.code,existing.active,next.active);
    if(existing.allowManualJournalEntry!==next.allowManualJournalEntry)add(next.allowManualJournalEntry?'Manual JE Permission Enabled':'Manual JE Permission Disabled',next.code,existing.allowManualJournalEntry,next.allowManualJournalEntry);
  }
  for(const {existing} of changeSet.removals)add('Account Removed',existing.code,existing,null);
  return records;
}
