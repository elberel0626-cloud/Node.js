import { test, expect, openView } from './fixtures/authenticated.js';
import { PDFDocument } from 'pdf-lib';

test.describe.configure({mode:'serial'});
async function api(page,path,method='GET',body){return page.evaluate(async({path,method,body})=>{const response=await fetch(path,{method,headers:body!==undefined?{'Content-Type':'application/json'}:undefined,body:body!==undefined?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store'}),text=await response.text();let parsed={};try{parsed=text?JSON.parse(text):{}}catch{parsed={error:text}}return{status:response.status,body:parsed};},{path,method,body});}
async function createPoVendorBill(page){const invoice=`PO-LINK-${crypto.randomUUID()}`;const created=await api(page,'/api/ap/documents','POST',{type:'Bill',vendorId:'VEND-1004',date:'2026-08-20',dueDate:'2026-09-19',vendorRef:invoice,invoiceNumber:invoice,branch:'100',terms:'NET30',taxTotal:0,freight:0,lines:[{inventoryId:'ITEM-1001',description:'Ink from PO',qty:10,uom:'EA',unitCost:80,discountAmount:0,expenseAccount:'5110',branch:'100'}]});expect(created.status,JSON.stringify(created.body)).toBe(201);return created.body;}

test('incoming review saves with PO removed and creates AP Bill',async({page})=>{
  const pdf=await PDFDocument.create();pdf.addPage([300,200]);const bytes=Buffer.from(await pdf.save()),ref=`NOPO-${crypto.randomUUID()}`;
  const upload=await api(page,'/api/ap/incoming-documents','POST',{fileName:`${ref}.pdf`,mimeType:'application/pdf',fileData:`data:application/pdf;base64,${bytes.toString('base64')}`,uploadedBy:'e2e',source:'PDF Upload',deferRecognition:true});
  expect(upload.status,JSON.stringify(upload.body)).toBe(202);const id=upload.body.id;
  const saved=await api(page,`/api/ap/incoming-documents/${id}`,'PUT',{status:'In Review',vendorMatch:{vendorId:'VEND-1001',vendorName:'Vendor 1001'},extracted:{vendorName:'Vendor 1001',invoiceNumber:ref,invoiceDate:'2026-08-20',dueDate:'2026-09-19',purchaseOrderNumber:'',poNumber:'',grossInvoiceAmount:42.5,totalAmount:42.5,lines:[{description:'No PO invoice',qty:1,unitPrice:42.5,extendedAmount:42.5,lineAmount:42.5,glAccountSuggestion:'5110',branch:'100'}]}});
  expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect(saved.body.extracted.purchaseOrderNumber).toBe('');expect(saved.body.extracted.poNumber).toBe('');
  const created=await api(page,`/api/ap/incoming-documents/${id}/create-bill`,'POST',{overrideDuplicate:true});
  expect(created.status,JSON.stringify(created.body)).toBe(201);expect(created.body.billId).toBeTruthy();expect(created.body.bill.lines[0].poNumber||'').toBe('');expect(created.body.bill.invoicePdfAttached).toBe(true);
});

test('eligible vendor PO appears in AP bill Purchase Order tab',async({page})=>{
  const bill=await createPoVendorBill(page),billId=bill.id;
  const candidates=await api(page,'/api/purchase-orders/lookup?vendorNumber=VEND-1004');expect(candidates.status,JSON.stringify(candidates.body)).toBe(200);expect(candidates.body.some(row=>row.poNumber==='PO-1001')).toBe(true);expect(candidates.body.every(row=>['Open','Partially Received','Partially Billed','Received','Closed'].includes(row.status))).toBe(true);
  await openView(page,`/ap/bills/${billId}`,'#bPost');const tab=page.locator(".erp-workspace .erp-tabs [data-tab='purchaseOrder']");await expect(tab).toBeVisible();await tab.click();
  const workspace=page.locator('#apPoV2');await expect(workspace).toBeVisible();const row=workspace.locator("tr[data-po='PO-1001']");await expect(row).toBeVisible();await expect(row.locator('.poPickV2')).toBeEnabled();
});

test('eligible vendor PO can be selected and saved on AP bill',async({page})=>{
  const bill=await createPoVendorBill(page),billId=bill.id;
  await openView(page,`/ap/bills/${billId}`,'#bPost');const tab=page.locator(".erp-workspace .erp-tabs [data-tab='purchaseOrder']");await expect(tab).toBeVisible();await tab.click();
  const row=page.locator("#apPoV2 tr[data-po='PO-1001']");await expect(row).toBeVisible();const checkbox=row.locator('.poPickV2');await expect(checkbox).toBeEnabled();await checkbox.check();
  const responsePromise=page.waitForResponse(response=>response.url().endsWith(`/api/ap/documents/${billId}`)&&response.request().method()==='PUT');await page.locator('#poSaveV2').click();const response=await responsePromise;const responseText=await response.text();expect(response.status(),responseText).toBe(200);
  await expect.poll(async()=>{const current=await api(page,`/api/ap/documents/${billId}`);return current.body.lines?.[0]?.poNumber||'';}).toBe('PO-1001');
  const current=await api(page,`/api/ap/documents/${billId}`);expect(current.body.threeWayMatch.status).toBe('Waiting for Receipt');expect(current.body.threeWayMatch.postable).toBe(false);
});
