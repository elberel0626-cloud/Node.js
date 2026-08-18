import { test, expect, openView } from './fixtures/authenticated.js';

test.describe.configure({ mode: 'serial' });

const viewports = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 }
];

const routes = [
  ['/ap/incoming-documents', '#incomingDocsGrid'],
  ['/ap/bills', '#apBillGrid'],
  ['/ap/payments', '#apPayGrid'],
  ['/finance/journal', '#jeGrid'],
  ['/finance/chart-of-accounts', '#coaGrid'],
  ['/finance/trial-balance', '#tbGrid'],
  ['/purchase-orders/orders', '#view'],
  ['/inventory/items', '#view'],
  ['/ar/invoices', '#view']
];

for (const viewport of viewports) {
  test(`ERP shell fits ${viewport.width}x${viewport.height} without root horizontal overflow`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const [path, ready] of routes) {
      await openView(page, path, ready);
      const dimensions = await page.evaluate(() => ({
        rootScrollWidth: document.documentElement.scrollWidth,
        rootClientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth
      }));
      expect(dimensions.rootScrollWidth, `${path} overflowed the root viewport at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(dimensions.rootClientWidth + 2);
      expect(dimensions.bodyScrollWidth, `${path} overflowed the body at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(dimensions.bodyClientWidth + 2);
    }
  });
}

test('wide AP bill lines scroll inside their own grid instead of widening the page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openView(page, '/ap/bills/new', '#billLines');
  const result = await page.evaluate(() => {
    const wrapper = document.querySelector('.ap-bill-lines-scroll');
    return {
      rootScrollWidth: document.documentElement.scrollWidth,
      rootClientWidth: document.documentElement.clientWidth,
      wrapperExists: Boolean(wrapper),
      wrapperScrollWidth: wrapper?.scrollWidth || 0,
      wrapperClientWidth: wrapper?.clientWidth || 0,
      overflowX: wrapper ? getComputedStyle(wrapper).overflowX : ''
    };
  });
  expect(result.wrapperExists).toBe(true);
  expect(result.rootScrollWidth).toBeLessThanOrEqual(result.rootClientWidth + 2);
  expect(['auto', 'scroll']).toContain(result.overflowX);
  expect(result.wrapperScrollWidth).toBeGreaterThanOrEqual(result.wrapperClientWidth);
});

test('incoming documents list auto-fits its available window instead of becoming a separate horizontal-scroll canvas', async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1600, height: 900 }]) {
    await page.setViewportSize(viewport);
    await openView(page, '/ap/incoming-documents', '#incomingDocsGrid');
    const result = await page.evaluate(() => {
      const table = document.querySelector('#incomingDocsGrid');
      const wrapper = table?.closest('.grid-wrap') || table?.parentElement;
      const tableRect = table?.getBoundingClientRect();
      const wrapperRect = wrapper?.getBoundingClientRect();
      return {
        rootScrollWidth: document.documentElement.scrollWidth,
        rootClientWidth: document.documentElement.clientWidth,
        wrapperExists: Boolean(wrapper),
        tableWidth: tableRect?.width || 0,
        wrapperWidth: wrapperRect?.width || 0,
        tableScrollWidth: table?.scrollWidth || 0,
        tableClientWidth: table?.clientWidth || 0,
        wrapperScrollWidth: wrapper?.scrollWidth || 0,
        wrapperClientWidth: wrapper?.clientWidth || 0,
        tableLayout: table ? getComputedStyle(table).tableLayout : ''
      };
    });
    expect(result.rootScrollWidth).toBeLessThanOrEqual(result.rootClientWidth + 2);
    expect(result.wrapperExists).toBe(true);
    expect(result.tableLayout).toBe('fixed');
    expect(result.tableWidth).toBeLessThanOrEqual(result.wrapperWidth + 2);
    expect(result.tableScrollWidth).toBeLessThanOrEqual(result.tableClientWidth + 2);
    expect(result.wrapperScrollWidth).toBeLessThanOrEqual(result.wrapperClientWidth + 2);
  }
});
