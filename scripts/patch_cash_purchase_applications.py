from pathlib import Path
import re

SERVER = Path('src/server.js')
text = SERVER.read_text(encoding='utf-8')

MARKER = '// CASH_PURCHASE_APPLICATION_SUPPORT_V1'
if MARKER in text:
    print('Cash Purchase application server support is already installed.')
    raise SystemExit(0)

def replace_once(old: str, new: str, label: str):
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    text = text.replace(old, new, 1)

replace_once(
    "if(module==='AP'){const doc=apDocuments.find(d=>String(d.id)===ref);return (type.includes('payment')||doc?.type==='Payment')?`/ap/payments/${encodeURIComponent(ref)}`:`/ap/bills/${encodeURIComponent(ref)}`;}",
    "if(module==='AP'){const doc=apDocuments.find(d=>String(d.id)===ref);if(doc?.type==='Cash Purchase')return`/ap/cash-purchases/${encodeURIComponent(ref)}`;return (type.includes('payment')||doc?.type==='Payment')?`/ap/payments/${encodeURIComponent(ref)}`:`/ap/bills/${encodeURIComponent(ref)}`;}",
    'finance source link'
)

replace_once(
    "if(module==='AP') return apDocuments.filter(d=>['Bill','Debit Adjustment','Credit Adjustment','Payment'].includes(d.type)&&inPeriod(d)&&(!d.posted||d.status==='Saved')).map(d=>({module:'AP',id:d.id,type:d.type,status:d.status,description:d.vendorName||'',href:linkFor('AP',d.id)}));",
    "if(module==='AP') return apDocuments.filter(d=>['Bill','Debit Adjustment','Credit Adjustment','Payment','Prepayment','Cash Purchase'].includes(d.type)&&inPeriod(d)&&(!d.posted||d.status==='Saved')).map(d=>({module:'AP',id:d.id,type:d.type,status:d.status,description:d.vendorName||'',href:d.type==='Cash Purchase'?`/ap/cash-purchases/${d.id}`:linkFor('AP',d.id)}));",
    'AP close blockers'
)

replace_once(
    "function apDocumentLabel(doc){\n  if(doc.type==='Payment') return 'AP Payment';",
    f"{MARKER}\nfunction apDocumentLabel(doc){{\n  if(doc.type==='Payment') return 'AP Payment';\n  if(doc.type==='Cash Purchase') return 'AP Cash Purchase';",
    'AP document label'
)

replace_once(
    "function apPostingLines(doc){\n  const amt=Number(doc.amount||0),branch=doc.branch||'100';\n  if(doc.type==='Payment') return [",
    """function apPostingLines(doc){
  const amt=Number(doc.amount||0),branch=doc.branch||'100';
  if(doc.type==='Cash Purchase'){
    let invoiceApplied=0,creditApplied=0;
    for(const application of doc.applications||[]){
      const amount=Number(application.amount||application.amountPaid||0); if(amount<=0) continue;
      const target=apDocuments.find(d=>d.id===(application.documentId||application.billId));
      const documentType=application.documentType||target?.type||'';
      if(documentType==='Credit Adjustment') creditApplied+=amount; else invoiceApplied+=amount;
    }
    const netApplied=Number((invoiceApplied-creditApplied).toFixed(2)),directPurchaseAmount=Number((amt-netApplied).toFixed(2));
    if(netApplied<0) throw new Error('Credit memo applications cannot exceed invoice applications.');
    if(directPurchaseAmount<0) throw new Error('Net amount applied to AP cannot exceed the Cash Purchase amount.');
    const lines=[];
    if(netApplied>0) lines.push({account:POSTING_ACCOUNTS.accountsPayable,debit:netApplied,credit:0,sourceReference:doc.id,lineDescription:apPostingLineDescription(doc,{},'Accounts Payable Applications'),branch});
    if(directPurchaseAmount>0){const expenseAccount=requireAccount(String(doc.expenseAccount||'').trim().split(/\\s+/)[0],'Cash Purchase expense / asset account');lines.push({account:expenseAccount,debit:directPurchaseAmount,credit:0,sourceReference:doc.id,lineDescription:apPostingLineDescription(doc,{},'Direct Purchase'),branch});}
    lines.push({account:requireAccount(String(doc.cashAccount||POSTING_ACCOUNTS.apCash).trim().split(/\\s+/)[0],'Cash Purchase cash account'),debit:0,credit:amt,sourceReference:doc.id,lineDescription:apPostingLineDescription(doc,{},'Cash'),branch});
    return lines;
  }
  if(doc.type==='Payment') return [""",
    'Cash Purchase posting lines'
)

replace_once(
    "function syncApPaymentReview(doc){\n  if(!doc||!['Payment','Prepayment'].includes(doc.type)) return doc;\n  const applied=(doc.applications||[]).reduce((t,a)=>t+Number(a.amount||a.amountPaid||0),0);",
    """function syncApPaymentReview(doc){
  if(!doc) return doc;
  if(doc.type==='Cash Purchase'){
    let invoiceApplied=0,creditApplied=0;
    for(const application of doc.applications||[]){
      const amount=Number(application.amount||application.amountPaid||0); if(amount<=0) continue;
      const target=apDocuments.find(d=>d.id===(application.documentId||application.billId));
      const documentType=application.documentType||target?.type||'';
      if(documentType==='Credit Adjustment') creditApplied+=amount; else invoiceApplied+=amount;
    }
    const netApplied=Number((invoiceApplied-creditApplied).toFixed(2));
    doc.invoiceAppliedAmount=Number(invoiceApplied.toFixed(2));
    doc.creditAppliedAmount=Number(creditApplied.toFixed(2));
    doc.appliedAmount=netApplied;
    doc.directPurchaseAmount=Number((Number(doc.amount||0)-netApplied).toFixed(2));
    doc.unappliedBalance=Math.max(0,doc.directPurchaseAmount);
    doc.balance=doc.unappliedBalance;
    doc.paymentApprovalStatus='Not Required';
    return doc;
  }
  if(!['Payment','Prepayment'].includes(doc.type)) return doc;
  const applied=(doc.applications||[]).reduce((t,a)=>t+Number(a.amount||a.amountPaid||0),0);""",
    'Cash Purchase review totals'
)

release_pattern = re.compile(r"function releaseApPaymentApplications\(doc,appliedOn=new Date\(\)\.toISOString\(\)\.slice\(0,10\)\)\{.*?\n\}\nfunction processApBillPoMatches", re.S)
release_replacement = """function releaseApPaymentApplications(doc,appliedOn=new Date().toISOString().slice(0,10)){
  if(!doc||!['Payment','Cash Purchase'].includes(doc.type)) return;
  const apps=(doc.applications||[]).map(a=>({documentId:a.documentId||a.billId,amount:Number(a.amount||a.amountPaid||0),documentType:a.documentType||''})).filter(a=>a.documentId&&a.amount>0);
  let invoiceApplied=0,creditApplied=0,total=0;
  for(const app of apps){
    const allowed=doc.type==='Cash Purchase'?['Bill','Credit Adjustment']:['Bill','Credit Adjustment','Debit Adjustment'];
    const target=apDocuments.find(d=>d.id===app.documentId&&allowed.includes(d.type)&&d.vendorId===doc.vendorId&&d.posted&&d.status==='Open');
    if(!target) throw new Error('This document has not been posted and cannot be applied.');
    if(app.amount>Number(target.balance||0)) throw new Error(`Applied amount exceeds open balance for ${app.documentId}`);
    app.documentType=target.type;
    if(doc.type==='Cash Purchase'){
      if(target.type==='Credit Adjustment') creditApplied+=app.amount; else invoiceApplied+=app.amount;
    } else total+=app.amount;
  }
  if(doc.type==='Payment'&&total>Number(doc.amount||0)) throw new Error('Applied amount cannot exceed payment amount');
  if(doc.type==='Cash Purchase'){
    const netApplied=Number((invoiceApplied-creditApplied).toFixed(2));
    if(netApplied<0) throw new Error('Credit memo applications cannot exceed invoice applications.');
    if(netApplied>Number(doc.amount||0)) throw new Error('Net amount applied to AP cannot exceed the Cash Purchase amount.');
  }
  doc.history=doc.history||[];
  doc.applications=apps.map(app=>{
    const target=apDocuments.find(d=>d.id===app.documentId);
    target.balance=Number((Number(target.balance||0)-app.amount).toFixed(2));
    target.status=Math.abs(target.balance)<0.005?'Closed':'Open';
    const hist={reference:`APP-${String(applicationSeq++).padStart(6,'0')}`,appliedDocument:target.id,documentType:target.type,paymentReference:doc.id,date:appliedOn,amount:app.amount,reversalEntry:'',user:'system'};
    doc.history.push(hist);
    return {billId:target.id,documentId:target.id,documentType:target.type,amount:app.amount,date:appliedOn,status:'Applied'};
  });
  syncApPaymentReview(doc);
}
function processApBillPoMatches"""
text, count = release_pattern.subn(release_replacement, text, count=1)
if count != 1:
    raise RuntimeError(f'Cash Purchase application release: expected one match, found {count}')

replace_once(
    "const prefix=b.type==='Payment'?'PAY-AP':b.type==='Prepayment'?'PREPAY':b.type==='Debit Adjustment'?'DADJ':'BILL';",
    "const prefix=b.type==='Payment'?'PAY-AP':b.type==='Prepayment'?'PREPAY':b.type==='Cash Purchase'?'CASH-AP':b.type==='Debit Adjustment'?'DADJ':'BILL';",
    'Cash Purchase number prefix'
)

replace_once(
    "cashAccount:String(b.cashAccount||POSTING_ACCOUNTS.apCash).trim().split(/\\s+/)[0],currency:b.currency||'USD',description:b.description||'',unappliedBalance:Number(b.amount||0),appliedAmount:0,applications:b.applications||[],history:b.history||[],approvals:b.approvals||[],lines:b.lines||[],source:'Manual'};",
    "cashAccount:String(b.cashAccount||POSTING_ACCOUNTS.apCash).trim().split(/\\s+/)[0],expenseAccount:String(b.expenseAccount||'').trim().split(/\\s+/)[0],currency:b.currency||'USD',description:b.description||'',unappliedBalance:Number(b.amount||0),appliedAmount:0,applications:b.applications||[],history:b.history||[],approvals:b.approvals||[],lines:b.lines||[],source:b.type==='Cash Purchase'?'Cash Purchase':'Manual'};",
    'Cash Purchase stored fields'
)

replace_once(
    "if(['Payment','Prepayment'].includes(doc.type)){syncApPaymentReview(doc);const payStatus=doc.paymentApprovalStatus||'Not Required';if(payStatus==='Pending Payment Approval')throw apPostingBusinessError('Payment batch requires payment approval before posting.');}",
    "if(['Payment','Prepayment','Cash Purchase'].includes(doc.type)){syncApPaymentReview(doc);const payStatus=doc.paymentApprovalStatus||'Not Required';if(payStatus==='Pending Payment Approval')throw apPostingBusinessError('Payment batch requires payment approval before posting.');}",
    'Cash Purchase posting validation review'
)

replace_once(
    "if(['Payment','Prepayment'].includes(doc.type)) releaseApPaymentApplications(doc,doc.postDate||doc.date);",
    "if(['Payment','Cash Purchase'].includes(doc.type)) releaseApPaymentApplications(doc,doc.postDate||doc.date);",
    'Cash Purchase application commit'
)

replace_once(
    "doc.posted=true; doc.status=(Number(doc.balance||doc.unappliedBalance||0)===0)?'Closed':'Open';",
    "doc.posted=true; if(doc.type==='Cash Purchase'){doc.balance=0;doc.unappliedBalance=0;doc.status='Closed';}else doc.status=(Number(doc.balance||doc.unappliedBalance||0)===0)?'Closed':'Open';",
    'Cash Purchase posted status'
)

replace_once(
    "if(d.type==='Payment'){ for(const app of d.applications||[]){ const b=apDocuments.find(x=>x.id===(app.billId||app.documentId));",
    "if(['Payment','Cash Purchase'].includes(d.type)){ for(const app of d.applications||[]){ const b=apDocuments.find(x=>x.id===(app.billId||app.documentId));",
    'Cash Purchase void application reversal'
)

SERVER.write_text(text, encoding='utf-8')
print('Cash Purchase application support patched into src/server.js')
