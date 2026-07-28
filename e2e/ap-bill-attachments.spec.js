import { test, expect } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  if (await page.locator('#login-screen').isVisible()) {
    await page.locator('#username').fill('admin');
    await page.locator('#password').fill('admin');
    await page.locator('#login-form button').click();
  }
}

const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');

test('AP Bill PDF uploads, persists, downloads, and opens from Inquiry', async ({ page }) => {
  await login(page);
  await page.goto('/ap/bills');
  const billHref = await page.locator('#apBillGrid a[href^="/ap/bills/"]').first().getAttribute('href');
  await page.goto(billHref);
  await page.locator(".erp-tabs .tab[data-tab='billNotes']").click();
  await page.locator('#billPdfFile').setInputFiles({ name: 'vendor-invoice.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.locator('#billUploadPdf').click();
  await expect(page.locator('#billAttachmentGrid')).toContainText('vendor-invoice.pdf');
  await expect(page.locator('#billAttachmentStatus')).toHaveText('Invoice PDF Attached');
  await page.reload();
  await page.locator(".erp-tabs .tab[data-tab='billNotes']").click();
  await expect(page.locator('#billAttachmentGrid')).toContainText('vendor-invoice.pdf');
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#bInquiry').selectOption('view-pdf');
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/attachments\/ATT-\d+\/file$/);
  expect((await popup.locator('body').textContent().catch(() => '')) ?? '').not.toContain('Incoming Documents');
});

test('AP Bill rejects a renamed non-PDF', async ({ page }) => {
  await login(page);
  await page.goto('/ap/bills');
  const billHref = await page.locator('#apBillGrid a[href^="/ap/bills/"]').first().getAttribute('href');
  await page.goto(billHref);
  await page.locator(".erp-tabs .tab[data-tab='billNotes']").click();
  await page.locator('#billPdfFile').setInputFiles({ name: 'malware.pdf', mimeType: 'application/pdf', buffer: Buffer.from('MZ executable') });
  await page.locator('#billUploadPdf').click();
  await expect(page.locator('.erp-dialog.error')).toContainText('PDF upload failed');
  await expect(page.locator('#billAttachmentStatus')).toHaveText('PDF Upload Failed');
});
