import { test, expect, openView } from './fixtures/authenticated.js';
import { PDFDocument } from 'pdf-lib';

test.describe.configure({ mode: 'serial' });

async function api(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' });
    const text = await response.text();
    let parsed = {}; try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { error: text }; }
    return { status: response.status, body: parsed };
  }, { path, method, body });
}

async function configureVendorApprover(page) {
  const users = await api(page, '/api/ap/approval-users');
  expect(users.status).toBe(200);
  const approver = users.body.find(user => user.status === 'Active') || users.body[0];
  expect(approver?.id).toBeTruthy();
  const update = await api(page, '/api/ap/vendors/VEND-1001', 'PUT', { assignedProcurementPersonUserId: approver.id });
  expect(update.status).toBe(200);
}

function bill(invoiceNumber, amount = 37.25) {
  return { type:'Bill', vendorId:'VEND-1001', date:'2026-08-17', dueDate:'2026-09-16', vendorRef:invoiceNumber, invoiceNumber, branch:'100', terms:'NET30', taxTotal:0, freight:0, lines:[{description:'E2E AP workflow',qty:1,uom:'EA',unitCost:amount,discountAmount:0,expenseAccount:'5110',branch:'100'}] };
}

test('incoming PDF is retained on a saved bill and the bill posts directly', async ({ page }) => {
  await openView(page, '/ap/bills', '#apBillGrid');
  await configureVendorApprover(page);
  const pdf = await PDFDocument.create(); pdf.addPage([300,200]);
  const bytes = Buffer.from(await pdf.save());
  const ref = `PDF-E2E-${crypto.randomUUID()}`;
  const upload = await api(page, '/api/ap/incoming-documents', 'POST', { fileName:`${ref}.pdf`, mimeType:'application/pdf', fileData:`data:application/pdf;base64,${bytes.toString('base64')}`, uploadedBy:'e2e', source:'PDF Upload', deferRecognition:true });
  expect(upload.status).toBe(202);
  const id = upload.body.id;
  const review = await api(page, `/api/ap/incoming-documents/${id}`, 'PUT', { status:'In Review', vendorMatch:{vendorId:'VEND-1001',vendorName:'Vendor 1001'}, extracted:{vendorName:'Vendor 1001',invoiceNumber:ref,invoiceDate:'2026-08-17',dueDate:'2026-09-16',grossInvoiceAmount:42.5,totalAmount:42.5,lines:[{description:'PDF invoice',qty:1,unitPrice:42.5,extendedAmount:42.5,lineAmount:42.5,glAccountSuggestion:'5110',branch:'100'}]}, draftBill:{vendorId:'VEND-1001',vendorName:'Vendor 1001',date:'2026-08-17',dueDate:'2026-09-16',vendorRef:ref,invoiceNumber:ref,terms:'NET30',branch:'100',lines:[{description:'PDF invoice',qty:1,uom:'EA',unitCost:42.5,extendedCost:42.5,amount:42.5,expenseAccount:'5110',branch:'100'}]} });
  expect(review.status).toBe(200);
  const converted = await api(page, `/api/ap/incoming-documents/${id}/create-bill`, 'POST', {});
  expect(converted.status, JSON.stringify(converted.body)).toBe(201);
  expect(converted.body.bill.status).toBe('Saved');
  expect(converted.body.bill.billApprovalStatus).toBe('Not Submitted');
  expect(converted.body.bill.invoicePdfAttached).toBe(true);
  const billId = converted.body.billId;
  const attachments = await api(page, `/api/ap/documents/${billId}/attachments`);
  expect(attachments.status).toBe(200);
  expect(attachments.body.some(a => a.isPrimary && a.mimeType === 'application/pdf')).toBe(true);
  await openView(page, `/ap/bills/${billId}`, '#bPost');
  await expect(page.locator('#bPost')).toBeEnabled();
  page.once('dialog', d => d.accept());
  const postedResponse = page.waitForResponse(r => r.url().endsWith('/api/ap/documents/post') && r.request().method() === 'POST');
  await page.locator('#bPost').click();
  expect((await postedResponse).status()).toBe(200);
  const posted = await api(page, `/api/ap/documents/${billId}`);
  expect(posted.body.posted).toBe(true);
});

test('saved bill can post directly despite vendor approver configuration', async ({ page }) => {
  await openView(page, '/ap/bills', '#apBillGrid'); await configureVendorApprover(page);
  const created = await api(page, '/api/ap/documents', 'POST', bill(`DIRECT-E2E-${crypto.randomUUID()}`));
  expect(created.status).toBe(201); expect(created.body.status).toBe('Saved'); expect(created.body.billApprovalStatus).toBe('Not Submitted');
  await openView(page, `/ap/bills/${created.body.id}`, '#bPost');
  await expect(page.locator('#bPost')).toBeEnabled(); await expect(page.locator('#bSubmit')).toBeEnabled();
  page.once('dialog', d => d.accept());
  const response = page.waitForResponse(r => r.url().endsWith('/api/ap/documents/post') && r.request().method() === 'POST');
  await page.locator('#bPost').click(); expect((await response).status()).toBe(200);
  expect((await api(page, `/api/ap/documents/${created.body.id}`)).body.posted).toBe(true);
});

test('pending approval blocks post; approved bill exposes Post and posts successfully', async ({ page }) => {
  await openView(page, '/ap/bills', '#apBillGrid'); await configureVendorApprover(page);
  const created = await api(page, '/api/ap/documents', 'POST', bill(`APPROVAL-E2E-${crypto.randomUUID()}`, 51.75));
  expect(created.status).toBe(201); const billId = created.body.id;
  const submitted = await api(page, `/api/ap/documents/${billId}/submit-approval`, 'POST', {});
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200); expect(submitted.body.status).toBe('Pending Approval');
  const blocked = await api(page, '/api/ap/documents/post', 'POST', {id:billId});
  expect(blocked.status).toBe(400); expect(blocked.body.error).toMatch(/pending approval/i);
  const approved = await api(page, `/api/ap/documents/${billId}/approval-action`, 'POST', {action:'approve',comments:'E2E approval'});
  expect(approved.status, JSON.stringify(approved.body)).toBe(200); expect(approved.body.status).toBe('Approved'); expect(approved.body.billApprovalStatus).toBe('Approved');
  await openView(page, `/ap/bills/${billId}`, '#bPost');
  await expect(page.locator('#bPost')).toBeEnabled(); await expect(page.locator('#bSubmit')).toHaveCount(0);
  page.once('dialog', d => d.accept());
  const response = page.waitForResponse(r => r.url().endsWith('/api/ap/documents/post') && r.request().method() === 'POST');
  await page.locator('#bPost').click(); expect((await response).status()).toBe(200);
  expect((await api(page, `/api/ap/documents/${billId}`)).body.posted).toBe(true);
});
