import { test, expect, openView } from './fixtures/authenticated.js';
import { PDFDocument } from 'pdf-lib';

test.describe.configure({ mode: 'serial' });

async function api(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin', cache: 'no-store'
    });
    const text = await response.text();
    let parsed = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { error: text }; }
    return { status: response.status, body: parsed };
  }, { path, method, body });
}

async function uploadPdf(page, billId, bytes, fileName) {
  const base64 = Buffer.from(bytes).toString('base64');
  return page.evaluate(async ({ billId, base64, fileName }) => {
    const binary = atob(base64);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
    const form = new FormData();
    form.append('file', new File([data], fileName, { type: 'application/pdf' }));
    const response = await fetch(`/api/ap/documents/${encodeURIComponent(billId)}/attachments`, { method: 'POST', body: form, credentials: 'same-origin' });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
    return { status: response.status, body };
  }, { billId, base64, fileName });
}

async function approver(page) {
  const users = await api(page, '/api/ap/approval-users');
  expect(users.status).toBe(200);
  return users.body.find(user => user.status === 'Active');
}

test('PDF-attached stock bill can save and post directly', async ({ page }) => {
  await openView(page, '/ap/bills', '#apBillGrid');
  const ref = `PDF-STOCK-${crypto.randomUUID()}`;
  const created = await api(page, '/api/ap/documents', 'POST', {
    type: 'Bill', vendorId: 'VEND-1002', date: '2026-08-17', dueDate: '2026-08-17',
    vendorRef: ref, invoiceNumber: ref, branch: '100', terms: 'NET15', taxTotal: 0, freight: 0,
    lines: [{ inventoryId: 'ITEM-1003', description: 'LED Panel 4ft', qty: 1234, uom: 'EA', unitCost: 30, discountAmount: 0, expenseAccount: '2020', branch: '100', warehouse: 'MAIN', location: 'MAIN-A2', poNumber: '', receiptNumber: '' }]
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const billId = created.body.id;

  const pdf = await PDFDocument.create();
  pdf.addPage([300, 200]);
  const upload = await uploadPdf(page, billId, await pdf.save(), `${ref}.pdf`);
  expect(upload.status, JSON.stringify(upload.body)).toBe(201);

  const saved = await api(page, `/api/ap/documents/${billId}`, 'PUT', {
    vendorId: 'VEND-1002', approverUserId: created.body.approverUserId, date: '2026-08-17', dueDate: '2026-08-17',
    vendorRef: ref, invoiceNumber: ref, branch: '100', terms: 'NET15', taxTotal: 0, freight: 0,
    lines: [{ inventoryId: 'ITEM-1003', description: 'LED Panel 4ft', qty: 1234, uom: 'EA', unitCost: 30, discountAmount: 0, expenseAccount: '2020', branch: '100', warehouse: 'MAIN', location: 'MAIN-A2', poNumber: '', receiptNumber: '' }]
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  expect(saved.body.invoicePdfAttached).toBe(true);
  expect(saved.body.status).toBe('Saved');

  const posted = await api(page, '/api/ap/documents/post', 'POST', { id: billId });
  expect(posted.status, JSON.stringify(posted.body)).toBe(200);
  expect(posted.body.posted).toBe(true);
});

test('document status moves Pending Approval to Pending Post and then posts', async ({ page }) => {
  await openView(page, '/ap/bills', '#apBillGrid');
  const activeApprover = await approver(page);
  expect(activeApprover?.id).toBeTruthy();
  await api(page, '/api/ap/vendors/VEND-1001', 'PUT', { approverUserId: activeApprover.id });
  const ref = `STATUS-${crypto.randomUUID()}`;
  const created = await api(page, '/api/ap/documents', 'POST', {
    type: 'Bill', vendorId: 'VEND-1001', date: '2026-08-17', dueDate: '2026-09-16', vendorRef: ref, invoiceNumber: ref,
    branch: '100', terms: 'NET30', taxTotal: 0, freight: 0,
    lines: [{ description: 'Approval status test', qty: 1, uom: 'EA', unitCost: 75, discountAmount: 0, expenseAccount: '5110', branch: '100' }]
  });
  expect(created.status).toBe(201);
  const billId = created.body.id;

  const submitted = await api(page, `/api/ap/documents/${billId}/submit-approval`, 'POST', {});
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  expect(submitted.body.status).toBe('Pending Approval');
  expect(submitted.body.approvalStatus).toBe('Pending Approval');

  const approved = await api(page, `/api/ap/documents/${billId}/approval-action`, 'POST', { action: 'approve', comments: 'Approved for posting' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  expect(approved.body.status).toBe('Pending Post');
  expect(approved.body.approvalStatus).toBe('Approved');

  await openView(page, `/ap/bills/${billId}`, '#bPost');
  await expect(page.locator('#bstatus')).toHaveValue('Pending Post');
  await expect(page.locator('#bPost')).toBeEnabled();

  const posted = await api(page, '/api/ap/documents/post', 'POST', { id: billId });
  expect(posted.status, JSON.stringify(posted.body)).toBe(200);
  expect(posted.body.posted).toBe(true);
});
