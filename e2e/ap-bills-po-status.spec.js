import { test, expect, openView } from './fixtures/authenticated.js';

async function request(page,path,method='GET',body){
  return page.evaluate(async({path,method,body})=>{
    const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text();let parsed={};try{parsed=text?JSON.parse(text):{}}catch{parsed={error:text}}
    return{status:response.status,body:parsed,text};
  },{path,method,body});
}

async function createPoLinkedBill(page){
  const lookup=await request(page,'/api/purchase-orders/lookup?vendorNumber=VEND-1002');
  expect(lookup.status,lookup.text).toBe(200);
  const po=(lookup.body||[]).find(row=>Array.isArray(row.lines)&&row.lines.length);
  expect(po,'VEND-1002 must have an eligible PO with a billable line for this regression').toBeTruthy();
  const line=po.lines[0];
  const qty=Math.max(0.01,Math.min(1,Number(line.qtyRemaining??line.receiveQty??line.openQty??line.qtyOrdered??line.quantity??1)||1));
  const unitCost=Number(line.unitCost||1)||1;
  const invoiceNumber=`E2E-PO-STATUS-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const created=await request(page,'/api/ap/documents','POST',{
    type:'Bill',vendorId:po.vendorId||'VEND-1002',vendorRef:invoiceNumber,invoiceNumber,
    date:'2026-08-20',dueDate:'2026-09-19',terms:'NET30',branch:'100',description:'AP bills navigation and PO status regression',
    lines:[{poNumber:po.poNumber,poLineId:line.id||line.poLineId||'',inventoryId:line.inventoryId||line.itemId||'',description:line.description||'PO line',qty,uom:line.uom||'EA',unitCost,discountAmount:0,expenseAccount:line.apAccrualAccount||line.rniAccount||line.expenseAccount||'2020',branch:'100'}]
  });
  expect(created.status,created.text).toBe(201);
  expect(created.body?.id).toBeTruthy();
  return{bill:created.body,po};
}

test('running AP Bills list API returns serialized bills successfully',async({page})=>{
  const result=await request(page,'/api/ap/documents?type=Bill');
  expect(result.status,result.text).toBe(200);
  expect(Array.isArray(result.body)).toBe(true);
});

test('AP sidebar navigation actually replaces the screen with Bills and Adjustments',async({page})=>{
  await openView(page,'/ap/incoming-documents','#view');
  const billsNav=page.locator("#ar-nav a[href='/ap/bills']");
  await expect(billsNav).toBeVisible();
  await billsNav.click();
  await expect(page).toHaveURL(/\/ap\/bills$/);
  await expect(page.locator('#apBillGrid')).toBeVisible();
  await expect(page.locator('#view .header-row h3')).toHaveText('Bills and Adjustments');
  await expect(page.locator("#ar-nav a[href='/ap/bills']")).toHaveClass(/active/);
  await expect(page.locator("#ar-nav a[href='/ap/incoming-documents']")).not.toHaveClass(/active/);
});

test('Bills and Adjustments shows PO Number and exact live PO Match Status',async({page})=>{
  const {bill,po}=await createPoLinkedBill(page);
  const expectedStatus=bill.threeWayMatch?.status||bill.matchStatus||'Not Matched';
  try{
    await openView(page,'/ap/bills','#apBillGrid');
    await expect(page.locator("#apBillGrid th[data-k='poNumbers']")).toContainText('PO Number');
    await expect(page.locator("#apBillGrid th[data-k='poMatchStatus']")).toContainText('PO Match Status');
    const row=page.locator('#apBillGrid tr[data-row]').filter({has:page.locator(`a[href='/ap/bills/${bill.id}']`)}).first();
    await expect(row).toBeVisible();
    await expect(row.locator("td[data-k='poNumbers']")).toContainText(po.poNumber);
    await expect(row.locator("td[data-k='poMatchStatus']")).toContainText(expectedStatus);
  }finally{
    await request(page,`/api/ap/documents/${encodeURIComponent(bill.id)}`,'DELETE');
  }
});
