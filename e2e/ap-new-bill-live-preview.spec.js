import { test, expect, openView } from './fixtures/authenticated.js';

async function jsonFetch(page,path,method='GET',body){
  return page.evaluate(async({path,method,body})=>{
    const response=await fetch(path,{method,headers:body!==undefined?{'Content-Type':'application/json'}:undefined,body:body!==undefined?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store'});
    const text=await response.text();let parsed={};try{parsed=text?JSON.parse(text):{}}catch{parsed={error:text}}
    return{status:response.status,body:parsed,text};
  },{path,method,body});
}

async function selectVendorAndPo(page){
  await openView(page,'/ap/bills/new','#bVendorNumber');
  await page.locator(".erp-tabs [data-tab='purchaseOrder']").click();
  await page.locator('#bVendorNumber').click();
  const vendorOption=page.locator('.party-suggestions .erp-lookup-row').filter({hasText:'VEND-1002'}).first();
  await expect(vendorOption).toBeVisible();await vendorOption.click();
  await expect(page.locator('#bvend')).toHaveValue('VEND-1002');
  const workspace=page.locator('#apPoNewV2');await expect(workspace).toContainText('VEND-1002');
  const row=workspace.locator("tr[data-po='PO-1002']");await expect(row).toBeVisible();await row.locator('.poPickNewV2').check();
  return{workspace,row};
}

test('unsaved AP PO preview API returns server 3-way status',async({page})=>{
  await openView(page,'/ap/bills/new','#bVendorNumber');
  const result=await jsonFetch(page,'/api/ap/po-match-preview','POST',{type:'Bill',status:'Draft',vendorId:'VEND-1002',lines:[{poNumber:'PO-1002',inventoryId:'ITEM-1007',description:'Printer Head Replacement',qty:1,uom:'EA',unitCost:420,discountAmount:0,expenseAccount:'2020',branch:'100'}]});
  expect(result.status,result.text).toBe(200);
  expect(result.body.hasPo).toBe(true);
  expect(result.body.status).not.toBe('Not Applicable');
  expect(Array.isArray(result.body.lines)).toBe(true);
  expect(result.body.lines.length).toBeGreaterThan(0);
});

test('new AP line grid shows GL code and account outline before save',async({page})=>{
  await openView(page,'/ap/bills/new','#bVendorNumber');
  await page.locator(".erp-tabs [data-tab='billLines']").click();
  const table=page.locator('#billLines .compact-ap-lines');await expect(table).toBeVisible();
  await expect(table.locator('tr').first()).toContainText('GL Code');
  await expect(table.locator('tr').first()).toContainText('GL Account Description');
  await expect(page.locator(".ln-exp[data-i='0']")).not.toHaveValue('');
  await expect(page.locator('#billLines .ap-effective-gl').first()).toBeVisible();
});

test('new AP PO selection displays same server match status before save',async({page})=>{
  await selectVendorAndPo(page);
  const responsePromise=page.waitForResponse(response=>response.url().endsWith('/api/ap/po-match-preview')&&response.request().method()==='POST'&&response.status()===200);
  await page.locator('#poApplyNewV2').click();
  await expect(page.locator(".ln-po[data-i='0']")).toHaveValue('PO-1002');
  const response=await responsePromise,serverMatch=await response.json();
  expect(serverMatch.hasPo).toBe(true);
  const strip=page.locator('#apMatchStatusStrip');await expect(strip).toBeVisible();
  await expect(page.locator('#apMatchStatusValue')).toHaveText(serverMatch.status);
  await expect(strip).toContainText('Live Unsaved Preview');
  const detail=page.locator('#newMatchV2 .ap-unsaved-match-table');await expect(detail).toBeVisible();
  await expect(detail).toContainText(serverMatch.status);
  await expect(detail).toContainText('GL Code');
});
