import { test, expect, openView } from './fixtures/authenticated.js';

test('new AP Bill uses professional PO workspace and applies a vendor PO', async ({ page }) => {
  await openView(page, '/ap/bills/new', '#bVendorNumber');
  await page.evaluate(() => {
    const set=(id,value)=>{const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
    set('bVendorNumber','VEND-1002');
    set('bVendorName','Vendor 1002');
    set('bvend','VEND-1002');
  });
  await page.locator(".erp-tabs [data-tab='purchaseOrder']").click();
  const workspace=page.locator('#apPoNewV2');
  await expect(workspace).toBeVisible();
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
