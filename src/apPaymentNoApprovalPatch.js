import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedName = '.server-ap-payment-no-approval-runtime.js';
const generatedPath = path.join(here, generatedName);

function replaceOnce(source, oldText, newText, label) {
  if (source.includes(newText)) return source;
  const first = source.indexOf(oldText);
  if (first < 0) throw new Error(`AP payment integration failed: ${label} was not found.`);
  if (source.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`AP payment integration failed: ${label} matched more than once.`);
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}

function replaceIfPresent(source, oldText, newText) {
  if (source.includes(newText) || !source.includes(oldText)) return source;
  return source.replace(oldText, newText);
}

function insertBeforeOnce(source, marker, insertion, label) {
  if (source.includes(insertion)) return source;
  const first = source.indexOf(marker);
  if (first < 0) throw new Error(`AP payment integration failed: ${label} marker was not found.`);
  if (source.indexOf(marker, first + marker.length) >= 0) throw new Error(`AP payment integration failed: ${label} marker matched more than once.`);
  return source.slice(0, first) + insertion + source.slice(first);
}

export function applyApPaymentNoApprovalPatch(source) {
  source = replaceOnce(
    source,
    "if(!doc.paymentApprovalStatus) doc.paymentApprovalStatus=doc.type==='Prepayment'?'Pending Payment Approval':(Number(doc.amount||0)>=Number(apApprovalThresholds.paymentControllerThreshold||25000)?'Pending Payment Approval':'Not Required');",
    "if(doc.type==='Payment') doc.paymentApprovalStatus='Not Required'; else if(!doc.paymentApprovalStatus) doc.paymentApprovalStatus='Pending Payment Approval';",
    'normal AP payments do not require payment approval'
  );

  source = replaceIfPresent(
    source,
    "if(action==='approve')approveBill(d,b);else if(action==='reject')rejectBill(d,b);",
    "if(action==='approve'){if(d.type==='Prepayment')approvePayment(d,b);else approveBill(d,b);}else if(action==='reject')rejectBill(d,b);"
  );

  source = replaceIfPresent(
    source,
    "doc.paymentApprovalStatus='Approved For Payment'; if(doc.type==='Prepayment') doc.status='Approved';",
    "doc.paymentApprovalStatus='Approved For Payment'; if(doc.type==='Prepayment'){doc.status='Approved';doc.approvalStatus='Approved For Payment';}"
  );

  source = replaceIfPresent(
    source,
    "if(doc.type==='Payment') return 'AP Payment';\n  if(doc.type==='Prepayment') return 'AP Prepayment';",
    "if(doc.type==='Payment') return 'AP Payment';\n  if(doc.type==='Prepayment') return 'AP Prepayment';\n  if(doc.type==='Cash Payment') return 'AP Cash Payment';"
  );

  source = insertBeforeOnce(
    source,
    "  if(doc.type==='Payment') return [",
    `  if(doc.type==='Cash Payment'){
    const distribution=(doc.lines||[]).filter(line=>Number(line.amount??line.lineTotal??line.extendedCost??0)>0);
    const debitLines=distribution.map((line,index)=>{const lineAmount=Number(line.amount??line.lineTotal??line.extendedCost??0);return{account:requireAccount(String(line.glAccount||line.expenseAccount||line.account||'').trim().split(/\\s+/)[0],\`Cash payment GL account line \${index+1}\`),debit:lineAmount,credit:0,sourceReference:doc.id,lineDescription:apPostingLineDescription(doc,line,'Cash Payment'),branch:line.branch||branch};});
    return [...debitLines,{account:requireAccount(String(doc.cashAccount||POSTING_ACCOUNTS.apCash).trim().split(/\\s+/)[0],'AP cash account'),debit:0,credit:amt,sourceReference:doc.id,lineDescription:apPostingLineDescription(doc,{},'Cash'),branch}];
  }
`,
    'cash payment posting lines'
  );

  source = replaceIfPresent(
    source,
    "const prefix=b.type==='Payment'?'PAY-AP':b.type==='Prepayment'?'PREPAY':b.type==='Debit Adjustment'?'DADJ':'BILL';",
    "const prefix=b.type==='Payment'?'PAY-AP':b.type==='Prepayment'?'PREPAY':b.type==='Cash Payment'?'CASH-AP':b.type==='Debit Adjustment'?'DADJ':b.type==='Credit Adjustment'?'CM-AP':'BILL';"
  );

  source = replaceIfPresent(
    source,
    "cashAccount:String(b.cashAccount||POSTING_ACCOUNTS.apCash).trim().split(/\\s+/)[0],currency:b.currency||'USD',description:b.description||'',unappliedBalance:Number(b.amount||0),",
    "cashAccount:String(b.cashAccount||POSTING_ACCOUNTS.apCash).trim().split(/\\s+/)[0],currency:b.currency||'USD',description:b.description||'',glAccount:String(b.glAccount||b.offsetAccount||'').trim().split(/\\s+/)[0],poId:b.poId||'',poNumber:b.poNumber||b.poId||'',poApplications:Array.isArray(b.poApplications)?b.poApplications.map(application=>({...application,amount:Number(application.amount||0)})):[],lines:Array.isArray(b.lines)?b.lines.map(line=>({...line,amount:Number(line.amount??line.lineTotal??line.extendedCost??0)})):[],unappliedBalance:Number(b.amount||0),"
  );

  source = replaceIfPresent(
    source,
    "syncApPaymentReview(d); if(d.type==='Prepayment'){ d.status='Pending Approval'; d.approvalStatus='Pending Payment Approval'; } applyApSaveWorkflow(d,b.createdBy||'ap.clerk');",
    "syncApPaymentReview(d); if(d.type==='Prepayment'){ d.status='Pending Approval'; d.approvalStatus='Pending Payment Approval'; } if(d.type==='Cash Payment'){d.balance=0;d.unappliedBalance=0;d.appliedAmount=0;d.paymentApprovalStatus='Not Required';} applyApSaveWorkflow(d,b.createdBy||'ap.clerk');"
  );

  source = replaceIfPresent(
    source,
    "    } else if(doc.type==='Prepayment'){\n      if(doc.status!=='Approved'||doc.paymentApprovalStatus!=='Approved For Payment') throw apPostingBusinessError('Vendor prepayment must be approved before posting.');\n    } else if(doc.status!=='Saved') throw apPostingBusinessError('Only Saved transactions can be posted');",
    `    } else if(doc.type==='Prepayment'){
      const requested=Array.isArray(doc.poApplications)&&doc.poApplications.length?doc.poApplications:(doc.poId||doc.poNumber?[{poId:doc.poId||doc.poNumber,poNumber:doc.poNumber||doc.poId,amount:Number(doc.amount||0)}]:[]);
      if(!requested.length) throw apPostingBusinessError('Apply the vendor prepayment to at least one open Purchase Order before posting.');
      const normalized=[];const seen=new Set();let allocationTotal=0;
      for(const application of requested){
        const linkedPo=purchaseOrders.find(po=>po.id===(application.poId||application.poNumber)||po.poNumber===(application.poNumber||application.poId));
        if(!linkedPo) throw apPostingBusinessError('A selected Purchase Order for this vendor prepayment was not found.');
        if(linkedPo.vendorId!==doc.vendorId) throw apPostingBusinessError('A selected Purchase Order does not belong to this vendor.');
        if(!['Open','Partially Received','Received'].includes(linkedPo.status)) throw apPostingBusinessError('Vendor prepayments can only be applied to open Purchase Orders.');
        if(seen.has(linkedPo.id)) throw apPostingBusinessError('A Purchase Order can only be selected once on a prepayment.');seen.add(linkedPo.id);
        const amount=Number(application.amount||0);if(amount<=0) throw apPostingBusinessError('Each selected Purchase Order must have an applied prepayment amount greater than $0.00.');
        recalcPo(linkedPo);const otherPrepayments=poPrepayments.filter(prepayment=>prepayment.poId===linkedPo.id&&prepayment.status!=='Voided'&&prepayment.sourceApDocumentId!==doc.id).reduce((sum,prepayment)=>sum+Number(prepayment.amount||0),0);const available=Math.max(0,Number(linkedPo.openPoBalance||0)-otherPrepayments);
        if(amount>available+0.01) throw apPostingBusinessError(\`Applied prepayment for \${linkedPo.poNumber||linkedPo.id} cannot exceed its available PO balance \${available.toFixed(2)}.\`);
        normalized.push({poId:linkedPo.id,poNumber:linkedPo.poNumber,amount});allocationTotal=Number((allocationTotal+amount).toFixed(2));
      }
      if(Math.abs(allocationTotal-Number(doc.amount||0))>0.01) throw apPostingBusinessError('Prepayment Amount must equal the total amount applied to Purchase Orders.');
      doc.poApplications=normalized;if(normalized.length===1){doc.poId=normalized[0].poId;doc.poNumber=normalized[0].poNumber;}else{doc.poId='';doc.poNumber='';}
      if(doc.status!=='Approved'||doc.paymentApprovalStatus!=='Approved For Payment') throw apPostingBusinessError('Vendor prepayment must be approved before posting.');
    } else if(doc.type==='Cash Payment'){
      if(doc.status!=='Saved') throw apPostingBusinessError('Only Saved cash payments can be posted');
      const distribution=(doc.lines||[]).filter(line=>Number(line.amount??line.lineTotal??line.extendedCost??0)>0);if(!distribution.length) throw apPostingBusinessError('Enter at least one GL distribution line for the cash payment.');
      const cashAccount=String(doc.cashAccount||POSTING_ACCOUNTS.apCash).trim().split(/\\s+/)[0];let distributionTotal=0;
      distribution.forEach((line,index)=>{const account=String(line.glAccount||line.expenseAccount||line.account||'').trim().split(/\\s+/)[0],amount=Number(line.amount??line.lineTotal??line.extendedCost??0);if(!account)throw apPostingBusinessError(\`GL Account is required on cash payment line \${index+1}.\`);requireAccount(account,\`Cash payment GL account line \${index+1}\`);if(account===cashAccount)throw apPostingBusinessError(\`Cash payment line \${index+1} cannot debit the same cash account being credited.\`);if(amount<=0)throw apPostingBusinessError(\`Amount on cash payment line \${index+1} must be greater than $0.00.\`);distributionTotal=Number((distributionTotal+amount).toFixed(2));});
      if(Math.abs(distributionTotal-Number(doc.amount||0))>0.01) throw apPostingBusinessError('Cash Payment Amount must equal the total GL distribution lines.');
    } else if(doc.status!=='Saved') throw apPostingBusinessError('Only Saved transactions can be posted');`
  );

  source = replaceIfPresent(
    source,
    "poBillLinks:structuredClone(poBillLinks),poStatusHistory:structuredClone(poStatusHistory),",
    "poBillLinks:structuredClone(poBillLinks),poPrepayments:structuredClone(poPrepayments),poPrepaymentApplications:structuredClone(poPrepaymentApplications),poStatusHistory:structuredClone(poStatusHistory),"
  );

  source = replaceIfPresent(
    source,
    "restore(poBillLinks,snapshot.poBillLinks);restore(poStatusHistory,snapshot.poStatusHistory);",
    "restore(poBillLinks,snapshot.poBillLinks);restore(poPrepayments,snapshot.poPrepayments);restore(poPrepaymentApplications,snapshot.poPrepaymentApplications);restore(poStatusHistory,snapshot.poStatusHistory);"
  );

  source = insertBeforeOnce(
    source,
    "function postApDocumentSafely(doc,{duplicateOverrideReason='',userId='admin'}={}){",
    `function syncPostedPrepaymentToPo(doc){
  if(!doc||doc.type!=='Prepayment'||!doc.posted) return [];
  const allocations=Array.isArray(doc.poApplications)&&doc.poApplications.length?doc.poApplications:(doc.poId||doc.poNumber?[{poId:doc.poId||doc.poNumber,poNumber:doc.poNumber||doc.poId,amount:Number(doc.amount||0)}]:[]),records=[],touched=new Set();
  for(const [index,allocation] of allocations.entries()){
    const po=purchaseOrders.find(row=>row.id===(allocation.poId||allocation.poNumber)||row.poNumber===(allocation.poNumber||allocation.poId));if(!po)continue;
    const amount=Number(allocation.amount||0);let record=poPrepayments.find(row=>row.sourceApDocumentId===doc.id&&row.poId===po.id);
    if(!record){record={id:\`PODEP-\${doc.id}-\${index+1}\`,prepaymentNumber:doc.id,sourceApDocumentId:doc.id,vendorId:doc.vendorId,vendorName:doc.vendorName,poId:po.id,poNumber:po.poNumber,paymentDate:doc.date,postDate:doc.postDate||doc.date,postPeriod:doc.postPeriod,paymentMethod:doc.method,cashAccount:doc.cashAccount,amount,appliedAmount:0,remainingBalance:amount,status:'Open',description:doc.description||'',jeReference:doc.jeNumber||doc.journalEntryNumber||''};poPrepayments.push(record);}else{Object.assign(record,{vendorId:doc.vendorId,vendorName:doc.vendorName,poId:po.id,poNumber:po.poNumber,paymentDate:doc.date,postDate:doc.postDate||doc.date,postPeriod:doc.postPeriod,paymentMethod:doc.method,cashAccount:doc.cashAccount,amount,remainingBalance:Math.max(0,amount-Number(record.appliedAmount||0)),status:Math.max(0,amount-Number(record.appliedAmount||0))===0?'Closed':'Open',description:doc.description||record.description||'',jeReference:doc.jeNumber||doc.journalEntryNumber||record.jeReference||''});}
    records.push(record);touched.add(po.id);
  }
  for(const poId of touched){const po=purchaseOrders.find(row=>row.id===poId);if(po)recalcPo(po);}
  doc.appliedAmount=Number(records.reduce((sum,record)=>sum+Number(record.appliedAmount||0),0).toFixed(2));doc.unappliedBalance=Number(records.reduce((sum,record)=>sum+Number(record.remainingBalance||0),0).toFixed(2));doc.balance=doc.unappliedBalance;return records;
}

`,
    'posted PO prepayment synchronization'
  );

  source = replaceIfPresent(
    source,
    "    const jeNumber=postApJE(doc,false);\n    doc.posted=true; doc.status=(Number(doc.balance||doc.unappliedBalance||0)===0)?'Closed':'Open';",
    "    const jeNumber=postApJE(doc,false);\n    doc.posted=true;\n    if(doc.type==='Prepayment'){syncPostedPrepaymentToPo(doc);doc.status=Number(doc.unappliedBalance||0)===0?'Closed':'Open';}\n    else if(doc.type==='Cash Payment'){doc.balance=0;doc.unappliedBalance=0;doc.status='Closed';}\n    else doc.status=(Number(doc.balance||doc.unappliedBalance||0)===0)?'Closed':'Open';"
  );

  source = replaceIfPresent(
    source,
    "  purchaseReceipts.push(receipt);\n  for(const {l,qty,item} of toReceive){",
    "  purchaseReceipts.push(receipt);\n  const linkedPrepayments=poPrepayments.filter(prepayment=>prepayment.poId===po.id&&prepayment.status!=='Voided'&&Number(prepayment.remainingBalance??Math.max(0,Number(prepayment.amount||0)-Number(prepayment.appliedAmount||0)))>0);\n  let remainingVendorDeposit=linkedPrepayments.reduce((sum,prepayment)=>sum+Number(prepayment.remainingBalance??Math.max(0,Number(prepayment.amount||0)-Number(prepayment.appliedAmount||0))),0);\n  let receiptDepositApplied=0;\n  for(const {l,qty,item} of toReceive){"
  );

  source = replaceIfPresent(
    source,
    "    const debitAcct=isStockItem(item)?l.inventoryAccount:l.expenseAccount; jeLines.push({account:debitAcct,debit:ext,sourceReference:receipt.id},{account:l.apAccrualAccount,credit:ext,sourceReference:receipt.id});",
    "    const debitAcct=isStockItem(item)?l.inventoryAccount:l.expenseAccount; const depositApplied=Math.min(ext,remainingVendorDeposit); const rniAmount=Number((ext-depositApplied).toFixed(2)); jeLines.push({account:debitAcct,debit:ext,sourceReference:receipt.id}); if(depositApplied>0)jeLines.push({account:POSTING_ACCOUNTS.vendorDeposit,credit:depositApplied,sourceReference:receipt.id}); if(rniAmount>0)jeLines.push({account:l.apAccrualAccount,credit:rniAmount,sourceReference:receipt.id}); remainingVendorDeposit=Number((remainingVendorDeposit-depositApplied).toFixed(2));receiptDepositApplied=Number((receiptDepositApplied+depositApplied).toFixed(2));"
  );

  source = replaceIfPresent(
    source,
    "  receipt.jeReference=createPostedJournal({module:'Inventory',description:`Purchase Receipt ${receipt.id}`,postPeriod:pp,transactionDate:postDate,sourceRef:receipt.id,lines:jeLines});\n  refreshPoStatus(po,'Create Receipt',receipt.id); return {...receipt,lines:purchaseReceiptLines.filter(l=>l.receiptId===receipt.id)};",
    "  receipt.jeReference=createPostedJournal({module:'Inventory',description:`Purchase Receipt ${receipt.id}`,postPeriod:pp,transactionDate:postDate,sourceRef:receipt.id,lines:jeLines});\n  receipt.prepaymentApplied=receiptDepositApplied;\n  let depositToApply=receiptDepositApplied;\n  for(const prepayment of linkedPrepayments){if(depositToApply<=0)break;const available=Number(prepayment.remainingBalance??Math.max(0,Number(prepayment.amount||0)-Number(prepayment.appliedAmount||0)));const applied=Number(Math.min(available,depositToApply).toFixed(2));if(applied<=0)continue;prepayment.appliedAmount=Number((Number(prepayment.appliedAmount||0)+applied).toFixed(2));prepayment.remainingBalance=Number(Math.max(0,Number(prepayment.amount||0)-prepayment.appliedAmount).toFixed(2));prepayment.status=prepayment.remainingBalance===0?'Closed':'Open';const apPrepayment=apDocuments.find(document=>document.id===prepayment.sourceApDocumentId&&document.type==='Prepayment');if(apPrepayment){const sourceRecords=poPrepayments.filter(record=>record.sourceApDocumentId===apPrepayment.id&&record.status!=='Voided');apPrepayment.appliedAmount=Number(sourceRecords.reduce((sum,record)=>sum+Number(record.appliedAmount||0),0).toFixed(2));apPrepayment.unappliedBalance=Number(sourceRecords.reduce((sum,record)=>sum+Number(record.remainingBalance||0),0).toFixed(2));apPrepayment.balance=apPrepayment.unappliedBalance;apPrepayment.status=apPrepayment.unappliedBalance===0?'Closed':'Open';}poPrepaymentApplications.push({id:`PPA-${poPrepaymentApplications.length+1001}`,prepaymentId:prepayment.id,sourceApDocumentId:prepayment.sourceApDocumentId||'',poId:po.id,receiptId:receipt.id,applicationDate:postDate,appliedAmount:applied,jeReference:receipt.jeReference});depositToApply=Number((depositToApply-applied).toFixed(2));}\n  recalcPo(po);refreshPoStatus(po,'Create Receipt',receipt.id); return {...receipt,lines:purchaseReceiptLines.filter(l=>l.receiptId===receipt.id)};"
  );

  source = replaceIfPresent(
    source,
    "if(module==='AP') return apDocuments.filter(d=>['Bill','Debit Adjustment','Credit Adjustment','Payment'].includes(d.type)&&inPeriod(d)&&(!d.posted||d.status==='Saved'))",
    "if(module==='AP') return apDocuments.filter(d=>['Bill','Debit Adjustment','Credit Adjustment','Payment','Prepayment','Cash Payment'].includes(d.type)&&inPeriod(d)&&(!d.posted||d.status==='Saved'||d.status==='Pending Approval'))"
  );

  return source;
}

export async function prepareApPaymentNoApprovalServer(inputModule = './server.js') {
  const inputPath = path.isAbsolute(inputModule) ? inputModule : path.join(here, String(inputModule).replace(/^\.\//, ''));
  const source = await readFile(inputPath, 'utf8');
  const patched = applyApPaymentNoApprovalPatch(source);
  await writeFile(generatedPath, patched, 'utf8');
  return `./${generatedName}`;
}
