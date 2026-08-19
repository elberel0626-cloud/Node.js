import { test, expect } from './fixtures/authenticated.js';

const DATE='2026-08-19';

async function api(page,method,path,payload){
  return page.evaluate(async ({method,path,payload})=>{
    const options={method,headers:{'Content-Type':'application/json'}};
    if(payload!==undefined) options.body=JSON.stringify(payload);
    const response=await fetch(path,options);
    const text=await response.text();
    let data={}; try{data=text?JSON.parse(text):{};}catch{data={raw:text};}
    if(!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${data.error||text}`);
    return data;
  },{method,path,payload});
}

function journalFor(journals,sourceRef,module){
  return journals.find(j=>j.sourceRef===sourceRef&&(!module||String(j.module).toUpperCase()===String(module).toUpperCase())&&!j.reversalOf);
}

function lineAmount(je,account,side){
  return Number((je?.lines||[]).filter(l=>String(l.account)===String(account)).reduce((s,l)=>s+Number(l[side]||0),0).toFixed(2));
}

function itemQty(item){ return Number(item.qtyOnHand||0); }

function assertBalanced(je,label){
  const dr=(je?.lines||[]).reduce((s,l)=>s+Number(l.debit||0),0);
  const cr=(je?.lines||[]).reduce((s,l)=>s+Number(l.credit||0),0);
  expect(Number(dr.toFixed(2)),`${label} debit`).toBe(Number(cr.toFixed(2)));
}

test('AUDIT purchase order -> receipt -> AP bill -> AP payment posts and reconciles',async({page})=>{
  const tag=Date.now().toString().slice(-8),poId=`PO-AUD-${tag}`;
  const beforeItem=await api(page,'GET','/api/inventory/items/ITEM-1001');
  const beforeJournals=await api(page,'GET','/api/finance/journal-transactions');

  const po=await api(page,'POST','/api/purchase-orders',{
    id:poId,vendorId:'VEND-1001',orderDate:DATE,postDate:DATE,warehouse:'MAIN',description:'Full accounting audit PO',
    lines:[{itemId:'ITEM-1001',qtyOrdered:2,unitCost:80,warehouse:'MAIN',location:'MAIN-A1',inventoryAccount:'1507',expenseAccount:'5110',apAccrualAccount:'2020'}]
  });
  expect(po.status).toBe('Saved');
  expect((await api(page,'GET','/api/finance/journal-transactions')).filter(j=>j.sourceRef===poId)).toHaveLength(0);

  await api(page,'POST','/api/purchase-orders/action',{id:poId,action:'Open PO'});
  const opened=await api(page,'GET',`/api/purchase-orders/${encodeURIComponent(poId)}`);
  expect(opened.status).toBe('Open');

  await api(page,'POST','/api/purchase-orders/create-receipt',{poId,postDate:DATE,receiptDate:DATE,lines:[{poLineId:opened.lines[0].id,receiveQty:2,selected:true}]});
  const receipts=await api(page,'GET','/api/purchase-orders/receipts');
  const receipt=receipts.filter(r=>r.poId===poId).at(-1);
  expect(receipt,'receipt created').toBeTruthy();
  const afterReceiptItem=await api(page,'GET','/api/inventory/items/ITEM-1001');
  expect(itemQty(afterReceiptItem)-itemQty(beforeItem)).toBe(2);

  let journals=await api(page,'GET','/api/finance/journal-transactions');
  const receiptJe=journalFor(journals,receipt.id,'Inventory');
  expect(receiptJe,'receipt JE').toBeTruthy(); assertBalanced(receiptJe,'Receipt JE');
  expect(lineAmount(receiptJe,'1507','debit')).toBe(160);
  expect(lineAmount(receiptJe,'2020','credit')).toBe(160);

  const bill=await api(page,'POST','/api/ap/documents',{
    type:'Bill',vendorId:'VEND-1001',date:DATE,postDate:DATE,dueDate:'2026-09-18',vendorRef:`AUD-INV-${tag}`,invoiceNumber:`AUD-INV-${tag}`,amount:160,description:'PO receipt audit bill',
    lines:[{poNumber:poId,receiptId:receipt.id,receiptNumber:receipt.id,inventoryId:'ITEM-1001',description:'Audit inventory purchase',qty:2,unitCost:80,expenseAccount:'1507',rniAccount:'2020'}]
  });
  expect(bill.status).toBe('Saved');
  const postedBill=await api(page,'POST','/api/ap/documents/post',{id:bill.id});
  expect(postedBill.document?.posted??postedBill.posted).toBeTruthy();
  const refreshedBill=await api(page,'GET',`/api/ap/documents/${encodeURIComponent(bill.id)}`);
  expect(refreshedBill.status).toBe('Open');
  expect(Number(refreshedBill.balance)).toBe(160);

  journals=await api(page,'GET','/api/finance/journal-transactions');
  const billJe=journalFor(journals,bill.id,'AP');
  expect(billJe,'AP bill JE').toBeTruthy(); assertBalanced(billJe,'AP Bill JE');
  expect(lineAmount(billJe,'2020','debit')).toBe(160);
  expect(lineAmount(billJe,'2010','credit')).toBe(160);

  const payment=await api(page,'POST','/api/ap/documents',{
    type:'Payment',vendorId:'VEND-1001',date:DATE,postDate:DATE,amount:160,method:'ACH/Wire',paymentRef:`AUD-PAY-${tag}`,cashAccount:'1084',applications:[{documentId:bill.id,billId:bill.id,amount:160}]
  });
  const postedPayment=await api(page,'POST','/api/ap/documents/post',{id:payment.id});
  expect(postedPayment.document?.posted??postedPayment.posted).toBeTruthy();
  const billAfterPayment=await api(page,'GET',`/api/ap/documents/${encodeURIComponent(bill.id)}`);
  const paymentAfter=await api(page,'GET',`/api/ap/documents/${encodeURIComponent(payment.id)}`);
  expect(Number(billAfterPayment.balance)).toBe(0);
  expect(billAfterPayment.status).toBe('Closed');
  expect(Number(paymentAfter.unappliedBalance||0)).toBe(0);

  journals=await api(page,'GET','/api/finance/journal-transactions');
  const paymentJe=journalFor(journals,payment.id,'AP');
  expect(paymentJe,'AP payment JE').toBeTruthy(); assertBalanced(paymentJe,'AP Payment JE');
  const apBillCreditAccount=(billJe.lines.find(l=>Number(l.credit)>0)||{}).account;
  const apPaymentDebitAccount=(paymentJe.lines.find(l=>Number(l.debit)>0)||{}).account;

  const poAfter=await api(page,'GET',`/api/purchase-orders/${encodeURIComponent(poId)}`);
  const summary={poId,receiptId:receipt.id,billId:bill.id,paymentId:payment.id,receiptJe:receiptJe.jeNumber,billJe:billJe.jeNumber,paymentJe:paymentJe.jeNumber,quantityBefore:itemQty(beforeItem),quantityAfterReceipt:itemQty(afterReceiptItem),billBalanceAfterPayment:Number(billAfterPayment.balance),apBillCreditAccount,apPaymentDebitAccount,journalCountDelta:journals.length-beforeJournals.length,poStatus:poAfter.status};
  console.log('AUDIT_PURCHASE_TO_PAY',JSON.stringify(summary));

  // Professional ERP control: the AP bill liability and the AP payment clearing debit must use the same AP control account.
  expect(apPaymentDebitAccount,'AP payment must clear the same AP control account credited by the bill').toBe(apBillCreditAccount);
});

test('AUDIT sales order -> shipment -> AR invoice -> AR payment posts inventory, COGS, revenue and application correctly',async({page})=>{
  const tag=Date.now().toString().slice(-8),soNumber=`SO-AUD-${tag}`,invoiceNumber=`INV-AUD-${tag}`;
  const beforeItem=await api(page,'GET','/api/inventory/items/ITEM-1001');

  const so=await api(page,'POST','/api/sales-orders',{
    orderNumber:soNumber,customerId:'CUST-1002',orderDate:DATE,postDate:DATE,warehouse:'MAIN',description:'Full accounting audit SO',
    lines:[{itemId:'ITEM-1001',qtyOrdered:2,unitPrice:120,warehouse:'MAIN',revenueAccount:'4008',cogsAccount:'5110',inventoryAccount:'1507'}]
  });
  expect(so.status).toBe('Saved');
  await api(page,'POST','/api/sales-orders/action',{id:soNumber,action:'Confirm'});
  const opened=await api(page,'GET',`/api/sales-orders/${encodeURIComponent(soNumber)}`);
  expect(opened.status).toBe('Open');

  await api(page,'POST','/api/sales-orders/create-shipment',{salesOrderId:soNumber,shipDate:DATE,confirm:true});
  const shipments=await api(page,'GET','/api/sales-orders/shipments');
  const shipment=shipments.filter(s=>s.salesOrderId===soNumber).at(-1);
  expect(shipment,'shipment created').toBeTruthy();
  const afterShipmentItem=await api(page,'GET','/api/inventory/items/ITEM-1001');
  expect(itemQty(beforeItem)-itemQty(afterShipmentItem)).toBe(2);

  let journals=await api(page,'GET','/api/finance/journal-transactions');
  const shipmentJe=journalFor(journals,shipment.id,'Inventory');
  expect(shipmentJe,'shipment JE').toBeTruthy(); assertBalanced(shipmentJe,'Shipment JE');
  expect(lineAmount(shipmentJe,'5110','debit')).toBe(160);
  expect(lineAmount(shipmentJe,'1507','credit')).toBe(160);

  const prepared=await api(page,'POST','/api/sales-orders/prepare-invoice',{salesOrderId:soNumber,shipmentId:shipment.id,invoiceNumber,date:DATE,postDate:DATE});
  const invoice=prepared.invoice;
  expect(invoice.status).toBe('Saved');
  const soAfterPrepare=await api(page,'GET',`/api/sales-orders/${encodeURIComponent(soNumber)}`);
  const qtyInvoicedAfterPrepare=Number(soAfterPrepare.lines[0].qtyInvoiced||0);

  await api(page,'POST','/api/ar/documents/post',{id:invoice.id});
  const invoiceAfter=await api(page,'GET',`/api/ar/documents/${encodeURIComponent(invoice.id)}`);
  expect(invoiceAfter.posted).toBeTruthy();
  expect(invoiceAfter.status).toBe('Open');
  const soAfterPost=await api(page,'GET',`/api/sales-orders/${encodeURIComponent(soNumber)}`);
  const qtyInvoicedAfterPost=Number(soAfterPost.lines[0].qtyInvoiced||0);

  journals=await api(page,'GET','/api/finance/journal-transactions');
  const invoiceJe=journalFor(journals,invoice.id,'AR');
  expect(invoiceJe,'AR invoice JE').toBeTruthy(); assertBalanced(invoiceJe,'AR Invoice JE');
  expect(lineAmount(invoiceJe,'1210','debit')).toBe(Number(invoiceAfter.amount));
  expect(lineAmount(invoiceJe,'4008','credit')).toBe(240);

  const payment=await api(page,'POST','/api/ar/documents',{
    type:'Payment',customerId:'CUST-1002',date:DATE,postDate:DATE,amount:Number(invoiceAfter.amount),method:'ACH',cashAccount:'1079',applications:[{invoiceId:invoice.id,amount:Number(invoiceAfter.amount),applicationDate:DATE}]
  });
  await api(page,'POST','/api/ar/documents/post',{id:payment.id});
  const invoiceAfterPayment=await api(page,'GET',`/api/ar/documents/${encodeURIComponent(invoice.id)}`);
  const paymentAfter=await api(page,'GET',`/api/ar/documents/${encodeURIComponent(payment.id)}`);

  journals=await api(page,'GET','/api/finance/journal-transactions');
  const paymentJe=journalFor(journals,payment.id,'AR');
  expect(paymentJe,'AR payment JE').toBeTruthy(); assertBalanced(paymentJe,'AR Payment JE');

  const applications=await api(page,'GET',`/api/ar/payment-applications?paymentId=${encodeURIComponent(payment.id)}`);
  const itemAfterEverything=await api(page,'GET','/api/inventory/items/ITEM-1001');
  const summary={soNumber,shipmentId:shipment.id,invoiceId:invoice.id,paymentId:payment.id,shipmentJe:shipmentJe.jeNumber,invoiceJe:invoiceJe.jeNumber,paymentJe:paymentJe.jeNumber,quantityBefore:itemQty(beforeItem),quantityAfterShipment:itemQty(afterShipmentItem),quantityFinal:itemQty(itemAfterEverything),invoiceAmount:Number(invoiceAfter.amount),invoiceBalanceAfterPayment:Number(invoiceAfterPayment.balance),invoiceStatusAfterPayment:invoiceAfterPayment.status,paymentStatus:paymentAfter.status,paymentUnapplied:Number(paymentAfter.unappliedBalance||0),applicationCount:applications.length,qtyInvoicedAfterPrepare,qtyInvoicedAfterPost};
  console.log('AUDIT_ORDER_TO_CASH',JSON.stringify(summary));

  expect(Number(invoiceAfterPayment.balance),'customer payment should clear the invoice').toBe(0);
  expect(invoiceAfterPayment.status).toBe('Closed');
  expect(Number(paymentAfter.unappliedBalance||0)).toBe(0);
  expect(applications.length,'payment application history').toBeGreaterThan(0);
  expect(qtyInvoicedAfterPost,'posting must not count an already-prepared invoice quantity twice').toBe(2);
});

test('AUDIT trial balance remains balanced after integrated posting scenarios',async({page})=>{
  const tb=await api(page,'GET','/api/finance/trial-balance?fromPeriod=2026-08&toPeriod=2026-08');
  const summary={totalDebits:Number(tb.totals?.totalDebits||0),totalCredits:Number(tb.totals?.totalCredits||0),difference:Number(tb.totals?.netDifference||0)};
  console.log('AUDIT_TRIAL_BALANCE',JSON.stringify(summary));
  expect(Number(summary.difference.toFixed(2))).toBe(0);
});
