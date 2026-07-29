import { test, expect, openView } from './fixtures/authenticated.js';

test.describe.configure({ mode: 'serial' });

const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');

test('AP Bill PDF uploads, persists, downloads, and opens from Inquiry', async ({ page }) => {
  await openView(page, '/ap/bills', '#apBillGrid');
  const billHref = await page.locator('#apBillGrid a[href^="/ap/bills/"]').first().getAttribute('href');
  expect(billHref).toBeTruthy();
  await page.goto(billHref);
  await page.locator(".erp-tabs .tab[data-tab='billNotes']").click();
  await page.locator('#billPdfFile').setInputFiles({
    name: 'vendor-invoice.pdf',
    mimeType: 'application/pdf',
    buffer: pdf
  });
  await page.locator('#billUploadPdf').click();
  await expect(page.locator('#billAttachmentGrid')).toContainText('vendor-invoice.pdf');
  await expect(page.locator('#billAttachmentStatus')).toHaveText('Invoice PDF Attached');

  await page.reload();
  await page.locator(".erp-tabs .tab[data-tab='billNotes']").click();
  await expect(page.locator('#billAttachmentGrid')).toContainText('vendor-invoice.pdf');

  // Headless Chromium can leave an inline PDF popup at about:blank. Capture the
  // URL passed to window.open, then verify the authenticated PDF response itself.
  await page.evaluate(() => {
    window.__e2eOpenedPdfUrl = '';
    window.open = url => {
      window.__e2eOpenedPdfUrl = String(url || '');
      return null;
    };
  });
  await page.locator('#bInquiry').selectOption('view-pdf');

  await expect.poll(() => page.evaluate(() => window.__e2eOpenedPdfUrl)).toMatch(
    /\/api\/ap\/documents\/[^/]+\/attachments\/ATT-\d+\/file$/
  );
  const openedUrl = await page.evaluate(() => window.__e2eOpenedPdfUrl);
  const pdfResponse = await page.evaluate(async url => {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      signature: String.fromCharCode(...bytes.slice(0, 5))
    };
  }, openedUrl);
  expect(pdfResponse.status).toBe(200);
  expect(pdfResponse.contentType).toContain('application/pdf');
  expect(pdfResponse.signature).toBe('%PDF-');
});

test('AP Bill rejects a renamed non-PDF', async ({ page }) => {
  await openView(page, '/ap/bills', '#apBillGrid');
  const billHref = await page.locator('#apBillGrid a[href^="/ap/bills/"]').first().getAttribute('href');
  expect(billHref).toBeTruthy();
  await page.goto(billHref);
  await page.locator(".erp-tabs .tab[data-tab='billNotes']").click();
  await page.locator('#billPdfFile').setInputFiles({
    name: 'malware.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('MZ executable')
  });
  await page.locator('#billUploadPdf').click();
  await expect(page.locator('.erp-dialog.error')).toContainText('PDF upload failed');
  await expect(page.locator('#billAttachmentStatus')).toHaveText('PDF Upload Failed');
});
