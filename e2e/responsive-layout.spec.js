import { test, expect, openView } from './fixtures/authenticated.js';

test.describe.configure({ mode: 'serial' });

const viewports = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 }
];

const routes = [
  ['/ap/incoming-documents', '#incomingDocsGrid'],
  ['/ap/bills', '#apBillGrid'],
  ['/ap/bills/new', '#billLines'],
  ['/ap/payments', '#apPayGrid'],
  ['/ap/vendors', '#apVend'],
  ['/finance/journal', '#jeGrid'],
  ['/finance/chart-of-accounts', '#coaGrid'],
  ['/finance/trial-balance', '#tbGrid'],
  ['/purchase-orders/orders', '#view'],
  ['/sales-orders/orders', '#view'],
  ['/inventory/items', '#view'],
  ['/ar/invoices', '#view']
];

async function assertProfessionalFit(page, path, viewport) {
  await page.waitForTimeout(75);
  const result = await page.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const view = document.querySelector('#view');
    const viewRect = view?.getBoundingClientRect();
    const tables = [...document.querySelectorAll('#view table')].filter(visible).map(table => {
      const rect = table.getBoundingClientRect();
      return {
        id: table.id || '(anonymous)',
        left: rect.left,
        right: rect.right,
        scrollWidth: table.scrollWidth,
        clientWidth: table.clientWidth,
        enhanced: table.classList.contains('erp-auto-fit-table')
      };
    });
    const wrappers = [...document.querySelectorAll('#view .grid-wrap,#view .table-wrap,#view .ap-bill-lines-scroll,#view .po-subgrid')]
      .filter(visible)
      .map(wrapper => ({
        className: wrapper.className,
        scrollWidth: wrapper.scrollWidth,
        clientWidth: wrapper.clientWidth
      }));
    const toolbars = [...document.querySelectorAll('#view .erp-toolbar,#view .header-row,#view .review-toolbar')]
      .filter(visible)
      .map(toolbar => {
        const rect = toolbar.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });
    return {
      rootScrollWidth: document.documentElement.scrollWidth,
      rootClientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      viewLeft: viewRect?.left || 0,
      viewRight: viewRect?.right || 0,
      tables,
      wrappers,
      toolbars
    };
  });

  expect(result.rootScrollWidth, `${path} overflowed root at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(result.rootClientWidth + 2);
  expect(result.bodyScrollWidth, `${path} overflowed body at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(result.bodyClientWidth + 2);
  for (const table of result.tables) {
    expect(table.left, `${path} table ${table.id} starts outside the workspace`).toBeGreaterThanOrEqual(result.viewLeft - 2);
    expect(table.right, `${path} table ${table.id} extends past the workspace`).toBeLessThanOrEqual(result.viewRight + 2);
    expect(table.scrollWidth, `${path} table ${table.id} still requires its own horizontal canvas`).toBeLessThanOrEqual(table.clientWidth + 2);
    expect(table.enhanced, `${path} table ${table.id} was not processed by the professional auto-fit helper`).toBe(true);
  }
  for (const wrapper of result.wrappers) {
    expect(wrapper.scrollWidth, `${path} ${wrapper.className} still horizontally scrolls`).toBeLessThanOrEqual(wrapper.clientWidth + 2);
  }
  for (const toolbar of result.toolbars) {
    expect(toolbar.left, `${path} toolbar starts outside workspace`).toBeGreaterThanOrEqual(result.viewLeft - 2);
    expect(toolbar.right, `${path} toolbar extends past workspace`).toBeLessThanOrEqual(result.viewRight + 2);
  }
}

for (const viewport of viewports) {
  test(`professional ERP shell and grids fit ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const [path, ready] of routes) {
      await openView(page, path, ready);
      await assertProfessionalFit(page, path, viewport);
    }
  });
}

test('Incoming Documents uses one fitted workspace instead of a nested scrolling grid', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openView(page, '/ap/incoming-documents', '#incomingDocsGrid');
  await page.waitForFunction(() => document.querySelector('#incomingDocsGrid')?.classList.contains('erp-auto-fit-table'));
  const result = await page.evaluate(() => {
    const table = document.querySelector('#incomingDocsGrid');
    const wrapper = table?.closest('.grid-wrap');
    const content = document.querySelector('.content');
    return {
      tableWidth: table?.getBoundingClientRect().width || 0,
      contentWidth: content?.getBoundingClientRect().width || 0,
      tableScrollWidth: table?.scrollWidth || 0,
      tableClientWidth: table?.clientWidth || 0,
      wrapperScrollWidth: wrapper?.scrollWidth || 0,
      wrapperClientWidth: wrapper?.clientWidth || 0,
      rootScrollWidth: document.documentElement.scrollWidth,
      rootClientWidth: document.documentElement.clientWidth
    };
  });
  expect(result.tableWidth).toBeLessThanOrEqual(result.contentWidth + 2);
  expect(result.tableScrollWidth).toBeLessThanOrEqual(result.tableClientWidth + 2);
  expect(result.wrapperScrollWidth).toBeLessThanOrEqual(result.wrapperClientWidth + 2);
  expect(result.rootScrollWidth).toBeLessThanOrEqual(result.rootClientWidth + 2);
});
