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
  return journals.find(j=>j.sourceRef===sourceRef&&String(j.module||'').toUpperCase()===String(module||'').toUpperCase()&&!j.reversalOf);
}

function assertBalanced(je,label){
  const debit=(je?.lines||[]).reduce((sum,line)=>sum+Number(line.debit||0),0);
  const credit=(je?.lines||[]).reduce((sum,line)=>sum+Number(line.credit||0),0);
  expect(Number(debit.toFixed(2)),`${label} debit`).toBe(Number(credit.toFixed(2)));
}

test.describe.configure({mode:'serial'});

test('SO invoice preparation and posting count invoiced quantity exactly once',async({page})=>{
  const tag=Date.now().toString().slice(-8),soNumber=`SO-REG-${tag}`,invoiceNumber=`INV-REG-${tag}`;
  const before=await api(page,'GET','/api/inventory/items/ITEM-1001');
  const so=await api(page,'POST','/api/sales-orders',{
    orderNumber:soNumber,customerId:'CUST-1002',orderDate:DATE,postDate:DATE,warehouse:'MAIN',description:'SO invoice quantity regression',
    lines:[{itemId:'ITEM-1001',qtyOrdered:2,unitPrice:120,warehouse:'MAIN',revenueAccount:'4008',cogsAccount:'5110',inventoryAccount:'1507'}]
  });
  const orderId=so.orderNumber||so.id||soNumber;
  await api(page,'POST','/api/sales-orders/action',{id:orderId,action:'Confirm'});
  await api(page,'POST','/api/sales-orders/create-shipment',{salesOrderId:orderId,shipDate:DATE,confirm:true});
  const shipments=await api(page,'GET','/api/sales-orders/shipments');
  const shipment=shipments.filter(row=>row.salesOrderId===orderId||row.salesOrderNumber===soNumber).at(-1);
  expect(shipment).toBeTruthy();
  const afterShipment=await api(page,'GET','/api/inventory/items/ITEM-1001');
  expect(Number(before.qtyOnHand||0)-Number(afterShipment.qtyOnHand||0)).toBe(2);

  const prepared=await api(page,'POST','/api/sales-orders/prepare-invoice',{salesOrderId:orderId,shipmentId:shipment.id,invoiceNumber,date:DATE,postDate:DATE});
  const orderAfterPrepare=await api(page,'GET',`/api/sales-orders/${encodeURIComponent(orderId)}`);
  expect(Number(orderAfterPrepare.lines[0].qtyInvoiced||0)).toBe(2);

  await api(page,'POST','/api/ar/documents/post',{id:prepared.invoice.id});
  const orderAfterPost=await api(page,'GET',`/api/sales-orders/${encodeURIComponent(orderId)}`);
  expect(Number(orderAfterPost.lines[0].qtyInvoiced||0),'posting the prepared invoice must not add the same quantity again').toBe(2);

  const journals=await api(page,'GET','/api/finance/journal-transactions');
  const shipmentJe=journalFor(journals,shipment.id,'Inventory');
  const invoiceJe=journalFor(journals,prepared.invoice.id,'AR');
  expect(shipmentJe).toBeTruthy(); expect(invoiceJe).toBeTruthy();
  assertBalanced(shipmentJe,'shipment JE'); assertBalanced(invoiceJe,'invoice JE');
});

test('integrated posting leaves Trial Balance balanced',async({page})=>{
  const tb=await api(page,'GET','/api/finance/trial-balance?fromPeriod=2026-08&toPeriod=2026-08');
  expect(Math.abs(Number(tb.totals?.netDifference||0))).toBeLessThan(0.005);
  expect(Number(Number(tb.totals?.totalDebits||0).toFixed(2))).toBe(Number(Number(tb.totals?.totalCredits||0).toFixed(2)));
});
