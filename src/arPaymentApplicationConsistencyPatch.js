import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const generatedName='.server-ar-payment-application-consistency.js';
const generatedPath=path.join(here,generatedName);

function replaceOnce(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`AR payment consistency integration failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`AR payment consistency integration failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyArPaymentApplicationConsistencyServerPatch(source){
  if(source.includes('function validateArSavedPaymentApplications('))return source;

  source=replaceOnce(
    source,
    `const arPaymentGlTotal=doc=>(doc.glApplications||[]).reduce((sum,row)=>sum+Number(row.amount||0),0);`,
    `const arPaymentGlTotal=doc=>(doc.glApplications||[]).reduce((sum,row)=>sum+Number(row.amount||0),0);
function validateArSavedPaymentApplications(payment,applications=[]){
  for(const application of (Array.isArray(applications)?applications:[])){
    const amount=Number(application?.amount||0);
    if(!Number.isFinite(amount)||amount<=0)throw new Error('Applied payment amount must be greater than $0.00.');
    if(application.salesOrderId){
      const order=salesOrders.find(row=>(row.id===application.salesOrderId||row.orderNumber===application.salesOrderId)&&row.customerId===payment.customerId);
      if(!order||!isEligibleSalesOrderForPayment(order,payment.customerId))throw new Error('Only eligible open sales orders can be applied to this payment.');
      if(amount>Number(order.openBalance||0)+0.005)throw new Error('Applied payment cannot exceed the sales order open balance.');
      continue;
    }
    const invoice=arDocuments.find(row=>row.id===application.invoiceId&&['Invoice','Credit Memo','Debit Memo'].includes(row.type)&&row.customerId===payment.customerId);
    if(!invoice)throw new Error('Select a valid AR document for this customer.');
    normalizeArStatus(invoice);
    if(!invoice.posted||invoice.status!=='Open')throw new Error('Only posted open AR documents can be applied to a payment.');
    if(amount>Number(invoice.balance||0)+0.005)throw new Error('Applied payment cannot exceed the document open balance.');
  }
  return applications;
}`,
    'saved payment application validator'
  );

  source=replaceOnce(
    source,
    `const nextApplications=Array.isArray(b.applications)?b.applications:(d.applications||[]); const nextAvailable=Number(b.amount??d.amount??0)+Number(b.financeChargeAmount??d.financeChargeAmount??0)+Number(b.writeOffAmount??d.writeOffAmount??0);`,
    `const nextApplications=Array.isArray(b.applications)?b.applications:(d.applications||[]); validateArSavedPaymentApplications({...d,...b},nextApplications); const nextAvailable=Number(b.amount??d.amount??0)+Number(b.financeChargeAmount??d.financeChargeAmount??0)+Number(b.writeOffAmount??d.writeOffAmount??0);`,
    'payment update application validation'
  );

  return source;
}

export async function prepareArPaymentApplicationConsistencyServer(inputModule='./server.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyArPaymentApplicationConsistencyServerPatch(source);
  await writeFile(generatedPath,patched,'utf8');
  return `./${generatedName}`;
}
