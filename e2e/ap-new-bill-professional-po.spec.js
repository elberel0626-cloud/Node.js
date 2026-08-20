import { test, expect, openView } from './fixtures/authenticated.js';

test('new AP Bill refreshes vendor POs and shows live match status plus GL detail before save', async ({ page }) => {
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

  const previewResponsePromise=page.waitForResponse(response=>response.url().endsWith('/api/ap/po-match-preview')&&response.request().method()==='POST');
  await page.locator('#poApplyNewV2').click();
  await expect(page.locator(".ln-po[data-i='0']")).toHaveValue('PO-1002');
  const previewResponse=await previewResponsePromise;
  const previewText=await previewResponse.text();
  expect(previewResponse.status(),previewText).toBe(200);
  const serverMatch=JSON.parse(previewText);
  expect(serverMatch.hasPo).toBe(true);
  expect(serverMatch.status).toMatch(/Waiting for Receipt|Partially Received|Matched - Ready to Post|Price Variance - Approval Required|Approved Match Exception - Ready to Post|Match Exception|Quantity Exception - Pending Purchasing Approval|Vendor Credit Pending/);

  const matchStrip=page.locator('#apMatchStatusStrip');
  await expect(matchStrip).toBeVisible();
  await expect(page.locator('#apMatchStatusValue')).toHaveText(serverMatch.status);
  await expect(matchStrip).toContainText('Posting Control');
  await expect(matchStrip).toContainText('Live Unsaved Preview');

  const preview=page.locator('#newMatchV2 .ap-unsaved-match-table');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Current 3-Way Match');
  await expect(preview).toContainText(serverMatch.status);
  await expect(preview).toContainText('GL Code');
  await expect(preview).toContainText('GL Account');

  await page.locator(".erp-tabs [data-tab='billLines']").click();
  const lineTable=page.locator('#billLines .compact-ap-lines');
  await expect(lineTable).toBeVisible();
  await expect(lineTable.locator('tr').first()).toContainText('GL Code');
  await expect(lineTable.locator('tr').first()).toContainText('GL Account Description');
  await expect(page.locator(".ln-exp[data-i='0']")).not.toHaveValue('');
  await expect(page.locator('#billLines .ap-effective-gl').first()).toBeVisible();
  await expect(page.locator('#billLines .ap-effective-gl').first()).toContainText(/GL:|PO posting basis:/);
});
