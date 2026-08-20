import { test, expect, openView } from './fixtures/authenticated.js';

test('new AP Bill refreshes professional PO workspace whenever vendor is selected', async ({ page }) => {
  await openView(page, '/ap/bills/new', '#bVendorNumber');
  await page.locator(".erp-tabs [data-tab='purchaseOrder']").click();
  const workspace=page.locator('#apPoNewV2');
  await expect(workspace).toBeVisible();
  await expect(workspace).toContainText('Select a vendor to load eligible purchase orders.');

  await page.locator('#bVendorNumber').click();
  const vendorOption=page.locator('.party-suggestions .erp-lookup-row').filter({hasText:'VEND-1002'}).first();
  await expect(vendorOption).toBeVisible();
  await vendorOption.click();
  await expect(page.locator('#bvend')).toHaveValue('VEND-1002');

  await expect(workspace).toContainText('Bill Vendor');
  await expect(workspace).toContainText('VEND-1002');
  await expect(page.locator('#purchaseOrder .po-match-summary')).toBeHidden();
  await expect(page.locator('#purchaseOrder .po-subgrid').first()).toBeHidden();
  const row=workspace.locator("tr[data-po='PO-1002']");
  await expect(row).toBeVisible();
  await row.locator('.poPickNewV2').check();
  await page.locator('#poApplyNewV2').click();
  await expect(page.locator(".ln-po[data-i='0']")).toHaveValue('PO-1002');
  await expect(workspace).toContainText(/Save the bill|Save bill/i);
});
