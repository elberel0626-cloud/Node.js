import { test, expect, openView } from './fixtures/authenticated.js';
import { PDFDocument } from 'pdf-lib';

test.describe.configure({mode:'serial'});
async function api(page,path,method='GET',body){return page.evaluate(async({path,method,body})=>{const response=await fetch(path,{method,headers:body!==undefined?{'Content-Type':'application/json'}:undefined,body:body!==undefined?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store'}),text=await response.text();let parsed={};try{parsed=text?JSON.parse(text):{}}catch{parsed={error:text}}return{status:response.status,body:parsed};},{path,method,body});}
async function createPoVendorBill(page){const invoice=`PO-LINK-${crypto.randomUUID()}`;const created=await api(page,'/api/ap/documents','POST',{type:'Bill',vendorId:'VEND-1002',date:'2026-08-20',dueDate:'2026-09-19',vendorRef:invoice,invoiceNumber:invoice,branch:'100',terms:'NET30',taxTotal:0,freight:0,lines:[{inventoryId:'ITEM-1007',description:'Replacement part from eligible PO',qty:1,uom:'EA',unitCost:420,discountAmount:0,expenseAccount:'5110',branch:'100'}]});expect(created.status,JSON.stringify(created.body)).toBe(201);return created.body;}
async function uploadPdf(page,ref){const pdf=await PDFDocument.create();pdf.addPage([300,200]);const bytes=Buffer.from(await pdf.save());const upload=await api(page,'/api/ap/incoming-documents','POST',{fileName:`${ref}.pdf`,mimeType:'application/pdf',fileData:`data:application/pdf;base64,${bytes.toString('base64')}`,uploadedBy:'e2e',source:'PDF Upload',deferRecognition:true});expect(upload.status,JSON.stringify(upload.body)).toBe(202);return upload.body.id;}
const rentAmounts=[70346.54,8061.08,2165.01,15660.60,1704.84,1406.93,-1261.33,-4157.68];

test('incoming review saves after stale PO is removed and creates AP Bill from the UI',async({page})=>{
  const ref=`NOPO-${crypto.randomUUID()}`,id=await uploadPdf(page,ref);
  const seeded=await api(page,`/api/ap/incoming-documents/${id}`,'PUT',{status:'In Review',vendorMatch:{vendorId:'VEND-1001',vendorName:'Vendor 1001'},extracted:{vendorName:'Vendor 1001',invoiceNumber:ref,invoiceDate:'2026-08-20',dueDate:'2026-09-19',purchaseOrderNumber:'PO-1004',poNumber:'PO-1004',grossInvoiceAmount:42.5,totalAmount:42.5,lines:[{description:'No PO invoice after review',qty:1,unitPrice:42.5,extendedAmount:42.5,lineAmount:42.5,glAccountSuggestion:'5110',branch:'100'}]}});
  expect(seeded.status,JSON.stringify(seeded.body)).toBe(200);

  await openView(page,`/ap/incoming-documents/${id}/review`,'#invoiceReviewForm');
  const poInput=page.locator("#invoiceReviewForm [data-field='purchaseOrderNumber']");
  await expect(poInput).toBeVisible();
  await poInput.fill('');
  const saveResponsePromise=page.waitForResponse(response=>response.url().endsWith(`/api/ap/incoming-documents/${id}`)&&response.request().method()==='PUT');
  await page.locator('#saveReview').click();
  const saveResponse=await saveResponsePromise;const saveText=await saveResponse.text();
  expect(saveResponse.status(),saveText).toBe(200);
  const saved=await api(page,`/api/ap/incoming-documents/${id}`);
  expect(saved.status,JSON.stringify(saved.body)).toBe(200);
  expect(saved.body.extracted.purchaseOrderNumber).toBe('');
  expect(saved.body.extracted.poNumber).toBe('');
  expect(saved.body.poMatch?.poNumber||'').toBe('');
  expect((saved.body.draftBill?.lines||[]).every(line=>!(line.poNumber||line.poLineId||line.receiptNumber))).toBe(true);

  await openView(page,`/ap/incoming-documents/${id}/review`,'#invoiceReviewForm');
  await expect(page.locator("#invoiceReviewForm [data-field='purchaseOrderNumber']")).toHaveValue('');
  const createResponsePromise=page.waitForResponse(response=>response.url().endsWith(`/api/ap/incoming-documents/${id}/create-bill`)&&response.request().method()==='POST');
  await page.locator('#createBill').click();
  const createResponse=await createResponsePromise;const createText=await createResponse.text();
  expect(createResponse.status(),createText).toBe(201);
  const created=JSON.parse(createText);
  expect(created.billId).toBeTruthy();
  expect(created.bill.lines[0].poNumber||'').toBe('');
  expect(created.bill.invoicePdfAttached).toBe(true);
  await expect.poll(()=>page.url()).toContain(`/ap/bills/${created.billId}`);
});

test('incoming review saves rent invoice with negative reconciliation lines and creates AP Bill',async({page})=>{
  const ref=`RENT-${crypto.randomUUID()}`,id=await uploadPdf(page,ref);
  const descriptions=['August 2026 RENT','CAM','FIRE','REAL ESTATE TAX','INSURANCE','2% MANAGEMENT FEE','2025 CAM REC – From Landlord','2025 INS REC – From Landlord'];
  const lines=rentAmounts.map((amount,index)=>({itemCode:'9999918',description:descriptions[index],qty:1,unitPrice:amount,extendedAmount:amount,lineAmount:amount,glAccountSuggestion:'5110',branch:'100'}));
  const seeded=await api(page,`/api/ap/incoming-documents/${id}`,'PUT',{status:'In Review',vendorMatch:{vendorId:'VEND-1001',vendorName:'Vendor 1001'},extracted:{vendorName:'Vendor 1001',vendorNumber:'VEND-1001',invoiceNumber:ref,invoiceDate:'2026-07-31',dueDate:'2026-08-01',paymentTerms:'DUE',currency:'USD',purchaseOrderNumber:'',poNumber:'',subtotal:93925.99,taxAmount:0,freightAmount:0,grossInvoiceAmount:93925.99,totalAmount:93925.99,lines}});
  expect(seeded.status,JSON.stringify(seeded.body)).toBe(200);
  expect(seeded.body.extracted.grossInvoiceAmount).toBe(93925.99);

  await openView(page,`/ap/incoming-documents/${id}/review`,'#invoiceReviewForm');
  await expect(page.locator("#invoiceReviewForm [data-field='purchaseOrderNumber']")).toHaveValue('');
  await expect(page.locator("#invoiceReviewForm [data-line='6'][data-line-field='unitPrice']")).toHaveValue('-1261.33');
  await expect(page.locator("#invoiceReviewForm [data-line='7'][data-line-field='unitPrice']")).toHaveValue('-4157.68');

  const savePromise=page.waitForResponse(response=>response.url().endsWith(`/api/ap/incoming-documents/${id}`)&&response.request().method()==='PUT');
  await page.locator('#saveReview').click();
  const saveResponse=await savePromise;const saveText=await saveResponse.text();
  expect(saveResponse.status(),saveText).toBe(200);
  await expect(page.locator('#incomingSaveV2')).toContainText('Saved');

  const createPromise=page.waitForResponse(response=>response.url().endsWith(`/api/ap/incoming-documents/${id}/create-bill`)&&response.request().method()==='POST');
  await page.locator('#createBill').click();
  const createResponse=await createPromise;const createText=await createResponse.text();
  expect(createResponse.status(),createText).toBe(201);
  const created=JSON.parse(createText);
  expect(created.billId).toBeTruthy();
  expect(created.bill.amount).toBe(93925.99);
  expect(created.bill.lines).toHaveLength(8);
  expect(created.bill.lines.some(line=>Number(line.unitCost)<0)).toBe(true);
  expect(created.bill.invoicePdfAttached).toBe(true);
});

test('negative AP bill lines post as positive GL credits',async({page})=>{
  const ref=`SIGNED-GL-${crypto.randomUUID()}`;
  const created=await api(page,'/api/ap/documents','POST',{type:'Bill',vendorId:'VEND-1001',date:'2026-08-20',dueDate:'2026-09-19',vendorRef:ref,invoiceNumber:ref,branch:'100',terms:'NET30',taxTotal:0,freight:0,lines:rentAmounts.map((unitCost,index)=>({description:`Rent line ${index+1}`,qty:1,uom:'EA',unitCost,discountAmount:0,expenseAccount:'5110',branch:'100'}))});
  expect(created.status,JSON.stringify(created.body)).toBe(201);
  expect(Number(created.body.amount)).toBe(93925.99);

  const posted=await api(page,'/api/ap/documents/post','POST',{id:created.body.id});
  expect(posted.status,JSON.stringify(posted.body)).toBe(200);
  const current=await api(page,`/api/ap/documents/${created.body.id}`);
  expect(current.status,JSON.stringify(current.body)).toBe(200);
  expect(current.body.posted).toBe(true);
  const je=current.body.journalEntryNumber||current.body.jeNumber;
  expect(je).toBeTruthy();

  const journal=await api(page,`/api/finance/journal-transactions/${encodeURIComponent(je)}`);
  expect(journal.status,JSON.stringify(journal.body)).toBe(200);
  const lines=journal.body.lines||[];
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.every(line=>Number(line.debit||0)>=0&&Number(line.credit||0)>=0)).toBe(true);
  expect(lines.every(line=>!(Number(line.debit||0)>0&&Number(line.credit||0)>0))).toBe(true);

  const expense=lines.filter(line=>String(line.account||line.accountNumber||'')==='5110');
  const expenseDebit=Number(expense.reduce((sum,line)=>sum+Number(line.debit||0),0).toFixed(2));
  const expenseCredit=Number(expense.reduce((sum,line)=>sum+Number(line.credit||0),0).toFixed(2));
  expect(expenseDebit).toBe(99345);
  expect(expenseCredit).toBe(5419.01);

  const apLine=lines.find(line=>/Accounts Payable/i.test(line.lineDescription||line.description||''));
  expect(apLine).toBeTruthy();
  expect(Number(apLine.debit||0)).toBe(0);
  expect(Number(apLine.credit||0)).toBe(93925.99);

  const totalDebit=Number(lines.reduce((sum,line)=>sum+Number(line.debit||0),0).toFixed(2));
  const totalCredit=Number(lines.reduce((sum,line)=>sum+Number(line.credit||0),0).toFixed(2));
  expect(totalDebit).toBe(99345);
  expect(totalCredit).toBe(99345);
});

test('eligible vendor PO lookup returns only selectable vendor POs',async({page})=>{
  const candidates=await api(page,'/api/purchase-orders/lookup?vendorNumber=VEND-1002');
  expect(candidates.status,JSON.stringify(candidates.body)).toBe(200);
  expect(candidates.body.some(row=>row.poNumber==='PO-1002')).toBe(true);
  expect(candidates.body.every(row=>row.vendorId==='VEND-1002')).toBe(true);
  expect(candidates.body.every(row=>!['Draft','Saved','Cancelled','Voided'].includes(row.status))).toBe(true);
});

test('eligible vendor PO renders in AP bill Purchase Order tab',async({page})=>{
  const bill=await createPoVendorBill(page),billId=bill.id;
  await openView(page,`/ap/bills/${billId}`,'#bPost');
  const tab=page.locator(".erp-workspace .erp-tabs [data-tab='purchaseOrder']");await expect(tab).toBeVisible();await tab.click();
  const workspace=page.locator('#apPoV2');await expect(workspace).toBeVisible();
  const row=workspace.locator("tr[data-po='PO-1002']");await expect(row).toBeVisible();await expect(row.locator('.poPickV2')).toBeEnabled();
});

test('eligible vendor PO can be selected and saved on AP bill',async({page})=>{
  const bill=await createPoVendorBill(page),billId=bill.id;
  await openView(page,`/ap/bills/${billId}`,'#bPost');const tab=page.locator(".erp-workspace .erp-tabs [data-tab='purchaseOrder']");await expect(tab).toBeVisible();await tab.click();
  const row=page.locator("#apPoV2 tr[data-po='PO-1002']");await expect(row).toBeVisible();const checkbox=row.locator('.poPickV2');await expect(checkbox).toBeEnabled();await checkbox.check();
  const responsePromise=page.waitForResponse(response=>response.url().endsWith(`/api/ap/documents/${billId}`)&&response.request().method()==='PUT');await page.locator('#poSaveV2').click();const response=await responsePromise;const responseText=await response.text();expect(response.status(),responseText).toBe(200);
  await expect.poll(async()=>{const current=await api(page,`/api/ap/documents/${billId}`);return current.body.lines?.[0]?.poNumber||'';}).toBe('PO-1002');
  const current=await api(page,`/api/ap/documents/${billId}`);expect(current.body.lines?.[0]?.poNumber).toBe('PO-1002');expect(current.body.threeWayMatch).toBeTruthy();
});
