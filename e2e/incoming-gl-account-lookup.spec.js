import { test, expect, openView } from './fixtures/authenticated.js';

test('incoming document verification GL account lookup searches code and name', async ({ page }) => {
  const account = await page.evaluate(async () => {
    const response = await fetch('/api/finance/chart-of-accounts');
    const rows = await response.json();
    return rows.find(row => row.active !== false && row.accountNumber && row.accountTitle && row.accountTitle.length > 5);
  });
  expect(account).toBeTruthy();

  const documentId = 'GL-LOOKUP-TEST';
  await page.route(`**/api/ap/incoming-documents/${documentId}**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/metadata')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id:documentId,totalPages:1,pageCount:1,fileName:'gl-lookup-test.pdf',mimeType:'application/pdf' }) });
    }
    if (url.pathname.endsWith('/file')) {
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n% GL lookup test\n' });
    }
    if (request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        id:documentId,status:'Ready for Review',processingStatus:'Ready for Review',fileName:'gl-lookup-test.pdf',originalFileName:'gl-lookup-test.pdf',mimeType:'application/pdf',
        vendorMatch:{vendorId:'VEND-1001',vendorName:'ABC Supply Co',confidence:100},assignedProcurementPersonUserId:'',approverUser:null,
        extracted:{vendorNumber:'VEND-1001',vendorName:'ABC Supply Co',invoiceNumber:'GL-TEST-1',invoiceDate:'2026-08-19',dueDate:'2026-09-18',paymentTerms:'NET30',currency:'USD',description:'GL account lookup test',subtotal:100,taxAmount:0,freightAmount:0,grossInvoiceAmount:100,department:'',costCenter:'',lines:[{itemCode:'',description:'Office supplies',qty:1,unitPrice:100,extendedAmount:100,glAccountSuggestion:'5110',department:'',costCenter:''}]},
        validationWarnings:[],exceptions:[],auditTrail:[]
      }) });
    }
    return route.continue();
  });

  await openView(page, `/ap/incoming-documents/${documentId}/review`, '#invoiceReviewForm');
  const accountInput = page.locator("input[data-line-field='glAccountSuggestion']").first();
  await expect(accountInput).toBeVisible();

  await accountInput.fill(account.accountNumber);
  let suggestion = page.locator('.incoming-gl-account-suggestions .erp-lookup-row').filter({ hasText: account.accountTitle }).first();
  await expect(suggestion).toBeVisible();
  await expect(suggestion.locator('.erp-lookup-id')).toHaveText(account.accountNumber);
  await expect(suggestion.locator('.erp-lookup-name')).toHaveText(account.accountTitle);

  await accountInput.fill(account.accountTitle);
  suggestion = page.locator('.incoming-gl-account-suggestions .erp-lookup-row').filter({ hasText: account.accountNumber }).first();
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(accountInput).toHaveValue(account.accountNumber);
  await expect(accountInput.locator('xpath=..').locator('.incoming-gl-account-name')).toContainText(account.accountTitle);
});
