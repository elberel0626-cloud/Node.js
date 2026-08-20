(() => {
  'use strict';

  const ROOT_ATTR = 'data-prof-inventory-root';
  const INVENTORY_PREFIX = '/inventory';
  const allowedNav = new Set([
    '/inventory', '/inventory/items', '/inventory/receipts', '/inventory/issues',
    '/inventory/transfers', '/inventory/adjustments', '/inventory/physical-counts',
    '/inventory/release', '/inventory/summary', '/inventory/availability',
    '/inventory/transactions', '/inventory/valuation-inquiry', '/inventory/reports/reorder',
    '/inventory/warehouses', '/inventory/locations', '/inventory/reason-codes'
  ]);
  const documentPaths = {
    '/inventory/receipts': 'Receipt',
    '/inventory/issues': 'Issue',
    '/inventory/transfers': 'Transfer',
    '/inventory/adjustments': 'Adjustment'
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const money = value => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  const number = value => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
  const today = () => new Date().toISOString().slice(0, 10);

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await window.fetch(path, { ...options, headers, credentials: 'same-origin' });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
    if (!response.ok) throw new Error(body.error || body.message || text || `Request failed (${response.status})`);
    return body;
  }

  function notify(title, message, error = false) {
    const old = document.getElementById('piToast');
    if (old) old.remove();
    const toast = document.createElement('div');
    toast.id = 'piToast';
    toast.className = `pi-toast${error ? ' error' : ''}`;
    toast.innerHTML = `<strong>${esc(title)}</strong><span>${esc(message)}</span><button type='button' aria-label='Close'>×</button>`;
    document.body.appendChild(toast);
    toast.querySelector('button').onclick = () => toast.remove();
    setTimeout(() => toast.remove(), 5000);
  }

  function navigate(path) {
    history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
    setTimeout(() => scheduleRender(true), 0);
  }

  function root(html) {
    return `<div id='piInventoryRoot' ${ROOT_ATTR}>${html}</div>`;
  }

  function simplifyInventoryNavigation() {
    if (!location.pathname.startsWith(INVENTORY_PREFIX)) return;
    const nav = document.getElementById('ar-nav');
    if (!nav) return;
    nav.querySelectorAll('a[href^="/inventory"]').forEach(link => {
      const href = new URL(link.getAttribute('href'), location.origin).pathname;
      link.style.display = allowedNav.has(href) ? '' : 'none';
    });
    nav.querySelectorAll('.nav-group').forEach(group => {
      const visibleLinks = [...group.querySelectorAll('a[href^="/inventory"]')].filter(link => link.style.display !== 'none');
      if (group.querySelector('a[href^="/inventory"]')) group.style.display = visibleLinks.length ? '' : 'none';
    });
    const customize = nav.querySelector('#customizeNavBtn');
    if (customize) customize.style.display = 'none';
  }

  function toolbar(buttons) {
    return `<div class='pi-toolbar'>${buttons.map(button => {
      if (button.href) return `<button type='button' class='${button.primary ? 'primary' : ''}' data-nav='${esc(button.href)}'>${esc(button.label)}</button>`;
      return `<button type='button' id='${esc(button.id)}' class='${button.primary ? 'primary' : ''}${button.danger ? ' danger' : ''}' ${button.disabled ? 'disabled' : ''}>${esc(button.label)}</button>`;
    }).join('')}</div>`;
  }

  function bindNavButtons(host = document) {
    host.querySelectorAll('[data-nav]').forEach(button => button.onclick = () => navigate(button.dataset.nav));
  }

  function accountChoice(accounts, preferred, pattern, prefix) {
    if (accounts.some(account => account.code === preferred)) return preferred;
    const matchingName = accounts.find(account => pattern.test(`${account.code || ''} ${account.name || ''}`));
    if (matchingName) return matchingName.code;
    return accounts.find(account => String(account.code || '').startsWith(prefix))?.code || accounts[0]?.code || '';
  }

  function accountOptions(accounts, selected) {
    return accounts.map(account => `<option value='${esc(account.code)}' ${account.code === selected ? 'selected' : ''}>${esc(account.code)} - ${esc(account.name)}</option>`).join('');
  }

  function setupOptions(rows, valueKey, label, selected) {
    return rows.map(row => `<option value='${esc(row[valueKey])}' ${String(row[valueKey]) === String(selected) ? 'selected' : ''}>${esc(label(row))}</option>`).join('');
  }

  async function renderItems(view) {
    const items = await api('/api/inventory/items');
    view.innerHTML = root(`
      <div class='pi-page-head'>
        <div><h3>Inventory Items</h3><p>Maintain stock items, costing, GL posting accounts, and replenishment settings.</p></div>
        <button type='button' id='piNewItem' class='primary'>New Item</button>
      </div>
      <div class='pi-search-row'><input id='piItemSearch' type='search' placeholder='Search item ID or description'></div>
      <div class='pi-table-wrap'><table class='pi-table' id='piItemsTable'>
        <thead><tr><th>Inventory ID</th><th>Description</th><th>Status</th><th>Type</th><th>Warehouse</th><th>Available</th><th>Average Cost</th><th>Inventory Value</th></tr></thead>
        <tbody>${items.map(item => `<tr data-search='${esc(`${item.code} ${item.description || item.name || ''}`.toLowerCase())}'>
          <td><a href='/inventory/items/${encodeURIComponent(item.code)}'>${esc(item.code)}</a></td>
          <td>${esc(item.description || item.name || '')}</td><td>${esc(item.status || 'Active')}</td><td>${esc(item.type || item.itemType || '')}</td>
          <td>${esc(item.defaultWarehouse || '')}</td><td class='num'>${number(item.qtyAvailable)}</td><td class='num'>${money(item.averageCost)}</td><td class='num'>${money(item.inventoryValue)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`);
    const host = view.querySelector('#piInventoryRoot');
    host.querySelector('#piNewItem').onclick = () => navigate('/inventory/items/new');
    host.querySelector('#piItemSearch').oninput = event => {
      const query = event.target.value.trim().toLowerCase();
      host.querySelectorAll('#piItemsTable tbody tr').forEach(row => row.hidden = query && !row.dataset.search.includes(query));
    };
  }

  async function renderItemDetail(view, id) {
    const isNew = id === 'new';
    const [setup, accounts, item] = await Promise.all([
      api('/api/inventory/setup'),
      api('/api/gl/accounts'),
      isNew ? Promise.resolve(null) : api(`/api/inventory/items/${encodeURIComponent(id)}`)
    ]);
    const inventoryAccount = item?.inventoryAccount || accountChoice(accounts, '1507', /inventory|stock/i, '1');
    const cogsAccount = item?.cogsAccount || accountChoice(accounts, '5110', /cost of goods|cogs/i, '5');
    const revenueAccount = item?.revenueAccount || accountChoice(accounts, '4008', /revenue|sales/i, '4');
    const accrualAccount = item?.purchaseAccrualAccount || accountChoice(accounts, '2020', /accrual|receipt.*not.*invoice|rni/i, '2');
    const adjustmentAccount = item?.adjustmentAccount || accountChoice(accounts, '5109', /adjustment|variance|scrap/i, '5');
    const varianceAccount = item?.varianceAccount || adjustmentAccount;
    const defaultWarehouse = item?.defaultWarehouse || setup.warehouses.find(row => row.active !== false)?.warehouseId || 'MAIN';
    const warehouseLocations = setup.locations.filter(row => row.warehouse === defaultWarehouse && row.active !== false);
    const defaultLocation = item?.defaultLocation || warehouseLocations[0]?.locationId || setup.locations[0]?.locationId || '';
    const type = item?.type || item?.itemType || 'Stock Item';
    const status = item?.status || 'Active';
    const itemClass = item?.itemClass || setup.itemClasses?.[0]?.id || '';
    const baseUom = item?.baseUom || item?.uom || setup.unitsOfMeasure?.[0]?.id || 'EA';

    view.innerHTML = root(`
      ${toolbar([
        { id: 'piBack', label: 'Back' }, { id: 'piSave', label: 'Save', primary: true }, { id: 'piSaveClose', label: 'Save & Close' },
        ...(!isNew ? [{ href: '/inventory/items/new', label: 'New Item' }, { href: `/inventory/receipts/new?item=${encodeURIComponent(item.code)}`, label: 'Receive' }, { href: `/inventory/issues/new?item=${encodeURIComponent(item.code)}`, label: 'Issue' }, { href: `/inventory/adjustments/new?item=${encodeURIComponent(item.code)}`, label: 'Adjust' }] : [])
      ])}
      <div class='pi-page-head compact'><div><h3>${isNew ? 'New Inventory Item' : `${esc(item.code)} · ${esc(item.description || item.name || '')}`}</h3><p>${isNew ? 'Create an item master record.' : `On hand ${number(item.qtyOnHand)} · Available ${number(item.qtyAvailable)} · Value ${money(item.inventoryValue)}`}</p></div></div>
      <section class='pi-card'><h4>General</h4><div class='pi-form-grid'>
        <label class='required'>Inventory ID<input id='piItemCode' value='${esc(item?.code || '')}' ${isNew ? '' : 'readonly'} maxlength='40'></label>
        <label class='required span2'>Description<input id='piItemDesc' value='${esc(item?.description || item?.name || '')}' maxlength='160'></label>
        <label>Item Type<select id='piItemType'>${['Stock Item', 'Non-Stock Item', 'Service Item', 'Freight Item'].map(value => `<option ${value === type ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
        <label>Status<select id='piItemStatus'>${['Active', 'Inactive', 'No Sales', 'No Purchases', 'Discontinued'].map(value => `<option ${value === status ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
        <label>Item Class<select id='piItemClass'>${setupOptions(setup.itemClasses || [], 'id', row => `${row.id} - ${row.description}`, itemClass)}</select></label>
        <label>Base UOM<select id='piItemUom'>${setupOptions(setup.unitsOfMeasure || [], 'id', row => `${row.id} - ${row.description}`, baseUom)}</select></label>
        <label>Default Warehouse<select id='piItemWarehouse'>${setupOptions(setup.warehouses.filter(row => row.active !== false), 'warehouseId', row => `${row.warehouseId} - ${row.name}`, defaultWarehouse)}</select></label>
        <label>Default Location<select id='piItemLocation'>${setupOptions(warehouseLocations, 'locationId', row => `${row.locationId} - ${row.description}`, defaultLocation)}</select></label>
        <label>Costing Method<select id='piItemCosting'>${['Average Cost', 'Standard Cost', 'FIFO'].map(value => `<option ${value === (item?.costingMethod || 'Average Cost') ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
        <label>Standard Cost<input id='piItemStdCost' type='number' step='0.01' min='0' value='${Number(item?.standardCost || 0)}'></label>
        <label>Sales Price<input id='piItemPrice' type='number' step='0.01' min='0' value='${Number(item?.salesPrice || 0)}'></label>
      </div></section>
      <section class='pi-card'><h4>GL Posting Accounts</h4><div class='pi-form-grid'>
        <label>Inventory Asset<select id='piInvAcct'>${accountOptions(accounts, inventoryAccount)}</select></label>
        <label>COGS / Issue Expense<select id='piCogsAcct'>${accountOptions(accounts, cogsAccount)}</select></label>
        <label>Revenue<select id='piRevenueAcct'>${accountOptions(accounts, revenueAccount)}</select></label>
        <label>Receipt Accrual / RNI<select id='piAccrualAcct'>${accountOptions(accounts, accrualAccount)}</select></label>
        <label>Inventory Adjustment<select id='piAdjustmentAcct'>${accountOptions(accounts, adjustmentAccount)}</select></label>
        <label>Variance / Scrap<select id='piVarianceAcct'>${accountOptions(accounts, varianceAccount)}</select></label>
      </div></section>
      <section class='pi-card'><h4>Replenishment</h4><div class='pi-form-grid'>
        <label>Method<select id='piReplMethod'>${['None', 'Reorder Point', 'Min/Max', 'Demand Based', 'Manual'].map(value => `<option ${value === (item?.replenishmentMethod || 'Reorder Point') ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
        <label>Source<select id='piReplSource'>${['Purchase', 'Transfer', 'Manufacturing', 'Drop Ship'].map(value => `<option ${value === (item?.replenishmentSource || 'Purchase') ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
        <label>Preferred Vendor<input id='piVendor' value='${esc(item?.preferredVendor || '')}'></label>
        <label>Reorder Point<input id='piReorderPoint' type='number' min='0' step='1' value='${Number(item?.reorderPoint || 0)}'></label>
        <label>Safety Stock<input id='piSafetyStock' type='number' min='0' step='1' value='${Number(item?.safetyStock || 0)}'></label>
        <label>Lead Time Days<input id='piLeadTime' type='number' min='0' step='1' value='${Number(item?.leadTimeDays || 0)}'></label>
      </div></section>
      ${!isNew ? `<section class='pi-card'><div class='pi-section-head'><h4>On Hand by Warehouse / Location</h4><a href='/inventory/summary'>Inventory Summary</a></div>
        <div class='pi-table-wrap'><table class='pi-table'><thead><tr><th>Warehouse</th><th>Location</th><th>On Hand</th><th>Allocated</th><th>Available</th><th>Average Cost</th></tr></thead><tbody>
        ${(item.warehouseDetails || []).map(row => `<tr><td>${esc(row.warehouse)}</td><td>${esc(row.location)}</td><td class='num'>${number(row.qtyOnHand)}</td><td class='num'>${number(row.qtyAllocated)}</td><td class='num'>${number(Number(row.qtyOnHand || 0) - Number(row.qtyAllocated || 0))}</td><td class='num'>${money(row.averageCost)}</td></tr>`).join('') || `<tr><td colspan='6' class='empty'>No inventory balance yet.</td></tr>`}
        </tbody></table></div></section>
        <section class='pi-card'><div class='pi-section-head'><h4>Recent Inventory Transactions</h4><a href='/inventory/transactions'>All Transactions</a></div>
        <div class='pi-table-wrap'><table class='pi-table'><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Warehouse</th><th>Qty In</th><th>Qty Out</th><th>Unit Cost</th></tr></thead><tbody>
        ${(item.transactions || []).slice(-20).reverse().map(row => `<tr><td>${esc(row.postDate || '')}</td><td>${esc(row.transactionType || '')}</td><td>${esc(row.referenceNumber || '')}</td><td>${esc(row.warehouse || '')}</td><td class='num'>${number(row.quantityIn)}</td><td class='num'>${number(row.quantityOut)}</td><td class='num'>${money(row.unitCost)}</td></tr>`).join('') || `<tr><td colspan='7' class='empty'>No transactions yet.</td></tr>`}
        </tbody></table></div></section>` : ''}
    `);

    const host = view.querySelector('#piInventoryRoot');
    bindNavButtons(host);
    host.querySelector('#piBack').onclick = () => navigate('/inventory/items');
    host.querySelector('#piItemWarehouse').onchange = event => {
      const rows = setup.locations.filter(row => row.warehouse === event.target.value && row.active !== false);
      host.querySelector('#piItemLocation').innerHTML = setupOptions(rows, 'locationId', row => `${row.locationId} - ${row.description}`, rows[0]?.locationId || '');
    };

    const payload = () => ({
      code: host.querySelector('#piItemCode').value.trim(), inventoryId: host.querySelector('#piItemCode').value.trim(),
      description: host.querySelector('#piItemDesc').value.trim(), name: host.querySelector('#piItemDesc').value.trim(),
      type: host.querySelector('#piItemType').value, itemType: host.querySelector('#piItemType').value,
      status: host.querySelector('#piItemStatus').value, itemClass: host.querySelector('#piItemClass').value,
      baseUom: host.querySelector('#piItemUom').value, uom: host.querySelector('#piItemUom').value,
      salesUom: host.querySelector('#piItemUom').value, purchaseUom: host.querySelector('#piItemUom').value,
      defaultWarehouse: host.querySelector('#piItemWarehouse').value, defaultLocation: host.querySelector('#piItemLocation').value,
      costingMethod: host.querySelector('#piItemCosting').value, standardCost: Number(host.querySelector('#piItemStdCost').value || 0),
      salesPrice: Number(host.querySelector('#piItemPrice').value || 0), trackQuantity: host.querySelector('#piItemType').value === 'Stock Item',
      inventoryAccount: host.querySelector('#piInvAcct').value, cogsAccount: host.querySelector('#piCogsAcct').value,
      revenueAccount: host.querySelector('#piRevenueAcct').value, purchaseAccrualAccount: host.querySelector('#piAccrualAcct').value,
      adjustmentAccount: host.querySelector('#piAdjustmentAcct').value, varianceAccount: host.querySelector('#piVarianceAcct').value,
      replenishmentMethod: host.querySelector('#piReplMethod').value, replenishmentSource: host.querySelector('#piReplSource').value,
      preferredVendor: host.querySelector('#piVendor').value.trim(), reorderPoint: Number(host.querySelector('#piReorderPoint').value || 0),
      safetyStock: Number(host.querySelector('#piSafetyStock').value || 0), leadTimeDays: Number(host.querySelector('#piLeadTime').value || 0)
    });

    async function save(close) {
      const data = payload();
      if (!data.code) return notify('Inventory ID required', 'Enter a unique Inventory ID.', true);
      if (!data.description) return notify('Description required', 'Enter an item description.', true);
      try {
        const saved = await api(isNew ? '/api/inventory/items' : `/api/inventory/items/${encodeURIComponent(item.code)}`, {
          method: isNew ? 'POST' : 'PUT', body: JSON.stringify(data)
        });
        notify('Item saved', `${saved.code} was saved successfully.`);
        if (close) navigate('/inventory/items'); else navigate(`/inventory/items/${encodeURIComponent(saved.code)}`);
      } catch (error) { notify('Unable to save item', error.message, true); }
    }
    host.querySelector('#piSave').onclick = () => save(false);
    host.querySelector('#piSaveClose').onclick = () => save(true);
  }

  function docListTitle(type) { return type === 'Physical Count' ? 'Physical Counts' : `${type}s`; }
  function listPathForDocument(doc) {
    if (doc.inventoryOperation === 'Physical Count') return '/inventory/physical-counts';
    return Object.entries(documentPaths).find(([, type]) => type === doc.documentType)?.[0] || '/inventory/adjustments';
  }
  function displayDocumentType(doc) { return doc.inventoryOperation === 'Physical Count' ? 'Physical Count' : doc.documentType; }
  function documentStatus(doc) {
    if (doc.inventoryOperation === 'Physical Count' && doc.status === 'Saved' && (doc.lines || []).length && (doc.lines || []).every(line => Number(line.adjustmentQty || 0) === 0)) return 'Counted - No Variance';
    return doc.status || 'Saved';
  }

  async function renderDocumentList(view, type) {
    const all = await api('/api/inventory/documents');
    const docs = type === 'Physical Count'
      ? all.filter(doc => doc.inventoryOperation === 'Physical Count')
      : all.filter(doc => doc.documentType === type && doc.inventoryOperation !== 'Physical Count');
    const basePath = type === 'Physical Count' ? '/inventory/physical-counts' : Object.entries(documentPaths).find(([, value]) => value === type)?.[0];
    view.innerHTML = root(`
      <div class='pi-page-head'><div><h3>${docListTitle(type)}</h3><p>${type === 'Physical Count' ? 'Count stock by warehouse/location and post only the variance.' : `Create, review, and post inventory ${type.toLowerCase()} transactions.`}</p></div>
        <button type='button' id='piNewDocument' class='primary'>New ${type}</button></div>
      <div class='pi-table-wrap'><table class='pi-table'><thead><tr><th>Reference</th><th>Status</th><th>Date</th><th>Warehouse</th><th>Description</th><th>Total Qty</th><th>Total Value</th></tr></thead><tbody>
      ${docs.slice().reverse().map(doc => {
        const qty = (doc.lines || []).reduce((sum, line) => sum + Math.abs(Number(line.adjustmentQty ?? line.quantity ?? 0)), 0);
        const value = (doc.lines || []).reduce((sum, line) => sum + Math.abs(Number(line.adjustmentQty ?? line.quantity ?? 0)) * Number(line.unitCost || 0), 0);
        return `<tr><td><a href='/inventory/documents/${encodeURIComponent(doc.referenceNumber)}'>${esc(doc.referenceNumber)}</a></td><td><span class='pi-status ${String(documentStatus(doc)).toLowerCase().replace(/[^a-z]+/g, '-')}'>${esc(documentStatus(doc))}</span></td><td>${esc(doc.date || doc.postDate || '')}</td><td>${esc(doc.warehouse || doc.fromWarehouse || doc.countWarehouse || '')}</td><td>${esc(doc.description || '')}</td><td class='num'>${number(qty)}</td><td class='num'>${money(value)}</td></tr>`;
      }).join('') || `<tr><td colspan='7' class='empty'>No ${type.toLowerCase()} documents yet.</td></tr>`}
      </tbody></table></div>`);
    const host = view.querySelector('#piInventoryRoot');
    host.querySelector('#piNewDocument').onclick = () => navigate(`${basePath}/new`);
  }

  function itemOptionRows(items, selected) {
    return items.filter(item => item.status !== 'Inactive' && item.status !== 'Discontinued' && (item.trackQuantity !== false || item.type === 'Stock Item')).map(item =>
      `<option value='${esc(item.code)}' ${item.code === selected ? 'selected' : ''}>${esc(item.code)} - ${esc(item.description || item.name || '')}</option>`
    ).join('');
  }

  function locationsFor(setup, warehouse) { return setup.locations.filter(row => row.warehouse === warehouse && row.active !== false); }

  async function renderNewDocument(view, type) {
    const [items, setup] = await Promise.all([api('/api/inventory/items'), api('/api/inventory/setup')]);
    const query = new URLSearchParams(location.search);
    const initialItem = query.get('item') || items.find(item => item.status === 'Active' && (item.trackQuantity !== false || item.type === 'Stock Item'))?.code || items[0]?.code || '';
    const initialItemData = items.find(item => item.code === initialItem) || items[0] || {};
    const warehouse = initialItemData.defaultWarehouse || setup.warehouses.find(row => row.active !== false)?.warehouseId || 'MAIN';
    const locationId = initialItemData.defaultLocation || locationsFor(setup, warehouse)[0]?.locationId || '';
    const isTransfer = type === 'Transfer';
    const isAdjustment = type === 'Adjustment';
    const basePath = Object.entries(documentPaths).find(([, value]) => value === type)?.[0] || '/inventory/adjustments';

    view.innerHTML = root(`
      ${toolbar([{ id: 'piDocBack', label: 'Back' }, { id: 'piDocSave', label: 'Save' }, { id: 'piDocSavePost', label: 'Save & Post', primary: true }])}
      <div class='pi-page-head compact'><div><h3>New ${esc(type)}</h3><p>${isTransfer ? 'Move stock between warehouses or locations.' : isAdjustment ? 'Correct inventory quantity using a reason-coded adjustment.' : type === 'Receipt' ? 'Increase on-hand stock and create the receipt accrual entry.' : 'Reduce on-hand stock and create the issue expense entry.'}</p></div></div>
      <section class='pi-card'><div class='pi-form-grid'>
        <label>Date<input id='piDocDate' type='date' value='${today()}'></label>
        <label class='span2'>Description<input id='piDocDescription' value=''></label>
        <label>${isTransfer ? 'From Warehouse' : 'Warehouse'}<select id='piDocWarehouse'>${setupOptions(setup.warehouses.filter(row => row.active !== false), 'warehouseId', row => `${row.warehouseId} - ${row.name}`, warehouse)}</select></label>
        <label>${isTransfer ? 'From Location' : 'Location'}<select id='piDocLocation'>${setupOptions(locationsFor(setup, warehouse), 'locationId', row => `${row.locationId} - ${row.description}`, locationId)}</select></label>
        ${isTransfer ? `<label>To Warehouse<select id='piDocToWarehouse'>${setupOptions(setup.warehouses.filter(row => row.active !== false), 'warehouseId', row => `${row.warehouseId} - ${row.name}`, setup.warehouses.find(row => row.warehouseId !== warehouse && row.active !== false)?.warehouseId || warehouse)}</select></label><label>To Location<select id='piDocToLocation'></select></label>` : ''}
      </div></section>
      <section class='pi-card'><div class='pi-section-head'><h4>Lines</h4><button type='button' id='piAddLine'>Add Line</button></div>
        <div class='pi-table-wrap'><table class='pi-table pi-entry-table' id='piDocLines'><thead><tr><th>Item</th><th>Description</th><th>Available</th><th>${isAdjustment ? 'Adjustment Qty (+/-)' : 'Quantity'}</th><th>Unit Cost</th>${isAdjustment ? '<th>Reason</th>' : ''}<th></th></tr></thead><tbody></tbody></table></div>
      </section>`);
    const host = view.querySelector('#piInventoryRoot');
    host.querySelector('#piDocBack').onclick = () => navigate(basePath);
    const warehouseSelect = host.querySelector('#piDocWarehouse');
    const locationSelect = host.querySelector('#piDocLocation');
    const toWarehouseSelect = host.querySelector('#piDocToWarehouse');
    const toLocationSelect = host.querySelector('#piDocToLocation');
    const updateLocations = (warehouseValue, select, preferred = '') => {
      const rows = locationsFor(setup, warehouseValue);
      select.innerHTML = setupOptions(rows, 'locationId', row => `${row.locationId} - ${row.description}`, preferred || rows[0]?.locationId || '');
    };
    warehouseSelect.onchange = () => updateLocations(warehouseSelect.value, locationSelect);
    if (toWarehouseSelect) {
      updateLocations(toWarehouseSelect.value, toLocationSelect);
      toWarehouseSelect.onchange = () => updateLocations(toWarehouseSelect.value, toLocationSelect);
    }

    const balances = await api('/api/inventory/summary');
    let rowSeq = 0;
    const addLine = selectedItem => {
      const id = ++rowSeq;
      const item = items.find(row => row.code === selectedItem) || items[0] || {};
      const balance = balances.filter(row => row.inventoryId === item.code && row.warehouse === warehouseSelect.value).reduce((sum, row) => sum + Number(row.qtyAvailable || 0), 0);
      const cost = Number(item.averageCost || item.standardCost || item.cost || 0);
      const tr = document.createElement('tr');
      tr.dataset.lineId = String(id);
      tr.innerHTML = `<td><select class='pi-line-item'>${itemOptionRows(items, item.code)}</select></td><td class='pi-line-desc'>${esc(item.description || item.name || '')}</td><td class='num pi-line-avail'>${number(balance)}</td><td><input class='pi-line-qty' type='number' step='0.0001' ${isAdjustment ? '' : "min='0.0001'"} value='${isAdjustment ? '0' : '1'}'></td><td><input class='pi-line-cost' type='number' step='0.01' min='0' value='${cost}'></td>${isAdjustment ? `<td><select class='pi-line-reason'>${setupOptions(setup.reasonCodes || [], 'id', row => `${row.id} - ${row.description}`, setup.reasonCodes?.[0]?.id || '')}</select></td>` : ''}<td><button type='button' class='pi-remove-line' aria-label='Remove line'>×</button></td>`;
      host.querySelector('#piDocLines tbody').appendChild(tr);
      const itemSelect = tr.querySelector('.pi-line-item');
      itemSelect.onchange = () => {
        const selected = items.find(row => row.code === itemSelect.value) || {};
        const available = balances.filter(row => row.inventoryId === selected.code && row.warehouse === warehouseSelect.value).reduce((sum, row) => sum + Number(row.qtyAvailable || 0), 0);
        tr.querySelector('.pi-line-desc').textContent = selected.description || selected.name || '';
        tr.querySelector('.pi-line-avail').textContent = number(available);
        tr.querySelector('.pi-line-cost').value = Number(selected.averageCost || selected.standardCost || selected.cost || 0);
      };
      tr.querySelector('.pi-remove-line').onclick = () => tr.remove();
    };
    host.querySelector('#piAddLine').onclick = () => addLine(initialItem);
    addLine(initialItem);

    const payload = () => {
      const lines = [...host.querySelectorAll('#piDocLines tbody tr')].map(tr => {
        const inventoryId = tr.querySelector('.pi-line-item').value;
        const item = items.find(row => row.code === inventoryId) || {};
        const quantity = Number(tr.querySelector('.pi-line-qty').value || 0);
        return {
          inventoryId, itemId: inventoryId, description: item.description || item.name || '',
          warehouse: warehouseSelect.value, location: locationSelect.value,
          quantity: isAdjustment ? Math.abs(quantity) : quantity,
          adjustmentQty: isAdjustment ? quantity : undefined,
          unitCost: Number(tr.querySelector('.pi-line-cost').value || 0),
          reasonCode: isAdjustment ? tr.querySelector('.pi-line-reason')?.value : undefined
        };
      });
      return {
        documentType: type, date: host.querySelector('#piDocDate').value, postDate: host.querySelector('#piDocDate').value,
        description: host.querySelector('#piDocDescription').value.trim() || `${type} ${today()}`,
        warehouse: warehouseSelect.value, location: locationSelect.value,
        fromWarehouse: isTransfer ? warehouseSelect.value : undefined, fromLocation: isTransfer ? locationSelect.value : undefined,
        toWarehouse: isTransfer ? toWarehouseSelect.value : undefined, toLocation: isTransfer ? toLocationSelect.value : undefined,
        lines
      };
    };

    async function saveAndMaybePost(post) {
      const data = payload();
      if (!data.lines.length) return notify('Line required', 'Add at least one inventory line.', true);
      if (data.lines.some(line => !line.inventoryId || (!isAdjustment && Number(line.quantity || 0) <= 0) || (isAdjustment && Number(line.adjustmentQty || 0) === 0))) return notify('Check quantities', isAdjustment ? 'Adjustment quantity cannot be zero.' : 'Quantity must be greater than zero.', true);
      if (isTransfer && data.fromWarehouse === data.toWarehouse && data.fromLocation === data.toLocation) return notify('Transfer destination required', 'Choose a different destination warehouse or location.', true);
      try {
        const saved = await api('/api/inventory/documents', { method: 'POST', body: JSON.stringify(data) });
        if (post) await api('/api/inventory/documents/post', { method: 'POST', body: JSON.stringify({ referenceNumber: saved.referenceNumber }) });
        notify(post ? 'Inventory posted' : 'Inventory saved', `${saved.referenceNumber} ${post ? 'was posted' : 'was saved'}.`);
        navigate(`/inventory/documents/${encodeURIComponent(saved.referenceNumber)}`);
      } catch (error) { notify(post ? 'Unable to post inventory' : 'Unable to save inventory', error.message, true); }
    }
    host.querySelector('#piDocSave').onclick = () => saveAndMaybePost(false);
    host.querySelector('#piDocSavePost').onclick = () => saveAndMaybePost(true);
  }

  async function renderPhysicalCounts(view) { return renderDocumentList(view, 'Physical Count'); }

  async function renderNewPhysicalCount(view) {
    const [setup, summary] = await Promise.all([api('/api/inventory/setup'), api('/api/inventory/summary')]);
    const warehouse = setup.warehouses.find(row => row.active !== false)?.warehouseId || 'MAIN';
    view.innerHTML = root(`
      ${toolbar([{ id: 'piCountBack', label: 'Back' }, { id: 'piSaveCount', label: 'Save Count' }, { id: 'piPostCount', label: 'Save & Post Variance', primary: true }])}
      <div class='pi-page-head compact'><div><h3>New Physical Count</h3><p>Load stock for a warehouse/location, enter counted quantity, review variance, and post only the difference.</p></div></div>
      <section class='pi-card'><div class='pi-form-grid'>
        <label>Count Date<input id='piCountDate' type='date' value='${today()}'></label>
        <label>Warehouse<select id='piCountWarehouse'>${setupOptions(setup.warehouses.filter(row => row.active !== false), 'warehouseId', row => `${row.warehouseId} - ${row.name}`, warehouse)}</select></label>
        <label>Location<select id='piCountLocation'><option value=''>All Locations</option>${setupOptions(locationsFor(setup, warehouse), 'locationId', row => `${row.locationId} - ${row.description}`, '')}</select></label>
        <label class='span2'>Description<input id='piCountDescription' value='Physical count ${today()}'></label>
      </div><div class='pi-inline-actions'><button type='button' id='piLoadCount'>Load Stock</button><span id='piCountStats'></span></div></section>
      <section class='pi-card'><div class='pi-table-wrap'><table class='pi-table pi-entry-table' id='piCountTable'><thead><tr><th>Item</th><th>Description</th><th>Location</th><th>System Qty</th><th>Counted Qty</th><th>Variance</th><th>Unit Cost</th><th>Variance Value</th></tr></thead><tbody></tbody></table></div></section>`);
    const host = view.querySelector('#piInventoryRoot');
    host.querySelector('#piCountBack').onclick = () => navigate('/inventory/physical-counts');
    const wh = host.querySelector('#piCountWarehouse');
    const loc = host.querySelector('#piCountLocation');
    wh.onchange = () => { loc.innerHTML = `<option value=''>All Locations</option>${setupOptions(locationsFor(setup, wh.value), 'locationId', row => `${row.locationId} - ${row.description}`, '')}`; loadRows(); };
    loc.onchange = () => loadRows();

    function recalc() {
      let entered = 0, varianceQty = 0, varianceValue = 0;
      host.querySelectorAll('#piCountTable tbody tr').forEach(tr => {
        const input = tr.querySelector('.pi-counted');
        const system = Number(tr.dataset.systemQty || 0);
        const cost = Number(tr.dataset.unitCost || 0);
        if (input.value === '') { tr.querySelector('.pi-variance').textContent = '—'; tr.querySelector('.pi-variance-value').textContent = '—'; return; }
        entered++;
        const variance = Number(input.value || 0) - system;
        varianceQty += variance; varianceValue += variance * cost;
        tr.querySelector('.pi-variance').textContent = number(variance);
        tr.querySelector('.pi-variance-value').textContent = money(variance * cost);
        tr.classList.toggle('variance', variance !== 0);
      });
      host.querySelector('#piCountStats').textContent = `${entered} counted · Qty variance ${number(varianceQty)} · Value variance ${money(varianceValue)}`;
    }

    function loadRows() {
      const rows = summary.filter(row => row.warehouse === wh.value && (!loc.value || row.location === loc.value));
      host.querySelector('#piCountTable tbody').innerHTML = rows.map(row => `<tr data-item='${esc(row.inventoryId)}' data-location='${esc(row.location)}' data-system-qty='${Number(row.qtyOnHand || 0)}' data-unit-cost='${Number(row.averageCost || 0)}'>
        <td><a href='/inventory/items/${encodeURIComponent(row.inventoryId)}'>${esc(row.inventoryId)}</a></td><td>${esc(row.description || '')}</td><td>${esc(row.location || '')}</td><td class='num'>${number(row.qtyOnHand)}</td>
        <td><input class='pi-counted' type='number' min='0' step='0.0001' placeholder='Enter count'></td><td class='num pi-variance'>—</td><td class='num'>${money(row.averageCost)}</td><td class='num pi-variance-value'>—</td>
      </tr>`).join('') || `<tr><td colspan='8' class='empty'>No on-hand inventory exists for this selection.</td></tr>`;
      host.querySelectorAll('.pi-counted').forEach(input => input.oninput = recalc);
      recalc();
    }
    host.querySelector('#piLoadCount').onclick = loadRows;
    loadRows();

    const buildPayload = () => {
      const countedRows = [...host.querySelectorAll('#piCountTable tbody tr[data-item]')].filter(tr => tr.querySelector('.pi-counted').value !== '');
      const lines = countedRows.map(tr => {
        const currentQty = Number(tr.dataset.systemQty || 0), newQty = Number(tr.querySelector('.pi-counted').value || 0);
        return {
          inventoryId: tr.dataset.item, itemId: tr.dataset.item, warehouse: wh.value, location: tr.dataset.location,
          currentQty, newQty, adjustmentQty: newQty - currentQty, quantity: Math.abs(newQty - currentQty),
          unitCost: Number(tr.dataset.unitCost || 0), reasonCode: 'CYCLE'
        };
      });
      return {
        documentType: 'Adjustment', inventoryOperation: 'Physical Count', countWarehouse: wh.value, countLocation: loc.value,
        warehouse: wh.value, location: loc.value, date: host.querySelector('#piCountDate').value, postDate: host.querySelector('#piCountDate').value,
        description: host.querySelector('#piCountDescription').value.trim() || `Physical count ${wh.value} ${today()}`, countLines: lines, lines
      };
    };

    async function saveCount(post) {
      const data = buildPayload();
      if (!data.lines.length) return notify('Count required', 'Enter counted quantity for at least one item.', true);
      const varianceLines = data.lines.filter(line => Number(line.adjustmentQty || 0) !== 0);
      try {
        if (post && varianceLines.length) data.lines = varianceLines;
        const saved = await api('/api/inventory/documents', { method: 'POST', body: JSON.stringify(data) });
        if (post) {
          if (!varianceLines.length) {
            notify('Count verified', `${saved.referenceNumber} was saved. No inventory variance exists, so no GL adjustment was posted.`);
          } else {
            await api('/api/inventory/documents/post', { method: 'POST', body: JSON.stringify({ referenceNumber: saved.referenceNumber }) });
            notify('Physical count posted', `${saved.referenceNumber} posted ${varianceLines.length} variance line${varianceLines.length === 1 ? '' : 's'}.`);
          }
        } else notify('Physical count saved', `${saved.referenceNumber} was saved for review.`);
        navigate(`/inventory/documents/${encodeURIComponent(saved.referenceNumber)}`);
      } catch (error) { notify('Unable to save physical count', error.message, true); }
    }
    host.querySelector('#piSaveCount').onclick = () => saveCount(false);
    host.querySelector('#piPostCount').onclick = () => saveCount(true);
  }

  async function renderDocumentDetail(view, reference) {
    const docs = await api('/api/inventory/documents');
    const doc = docs.find(row => (row.referenceNumber || row.id) === reference);
    if (!doc) { view.innerHTML = root(`<section class='pi-card'><h3>Inventory document not found</h3></section>`); return; }
    const physical = doc.inventoryOperation === 'Physical Count';
    const backPath = listPathForDocument(doc);
    const canPost = ['Saved', 'Open'].includes(doc.status) && (!physical || (doc.lines || []).some(line => Number(line.adjustmentQty || 0) !== 0));
    const canVoid = doc.status === 'Posted';
    view.innerHTML = root(`
      ${toolbar([{ id: 'piDetailBack', label: 'Back' }, ...(canPost ? [{ id: 'piDetailPost', label: 'Post', primary: true }] : []), ...(canVoid ? [{ id: 'piDetailVoid', label: 'Void', danger: true }] : []), { href: '/inventory/transactions', label: 'Transactions' }])}
      <div class='pi-page-head compact'><div><h3>${esc(displayDocumentType(doc))} ${esc(doc.referenceNumber)}</h3><p>Status: <strong>${esc(documentStatus(doc))}</strong>${doc.jeNumber ? ` · Journal <a href='/finance/journal/${encodeURIComponent(doc.jeNumber)}'>${esc(doc.jeNumber)}</a>` : ''}</p></div></div>
      <section class='pi-card'><div class='pi-form-grid read-only'>
        <label>Date<input readonly value='${esc(doc.postDate || doc.date || '')}'></label><label>Period<input readonly value='${esc(doc.postPeriod || '')}'></label>
        <label>Warehouse<input readonly value='${esc(doc.warehouse || doc.fromWarehouse || doc.countWarehouse || '')}'></label>
        <label>Location<input readonly value='${esc(doc.location || doc.fromLocation || doc.countLocation || '')}'></label>
        ${doc.documentType === 'Transfer' ? `<label>To Warehouse<input readonly value='${esc(doc.toWarehouse || '')}'></label><label>To Location<input readonly value='${esc(doc.toLocation || '')}'></label>` : ''}
        <label class='span2'>Description<input readonly value='${esc(doc.description || '')}'></label>
      </div></section>
      <section class='pi-card'><h4>${physical ? 'Count Results' : 'Lines'}</h4><div class='pi-table-wrap'><table class='pi-table'><thead><tr><th>Item</th><th>Description</th><th>Warehouse</th><th>Location</th>${physical ? '<th>System Qty</th><th>Counted Qty</th><th>Variance</th>' : '<th>Quantity</th><th>Adjustment</th>'}<th>Unit Cost</th><th>Value</th></tr></thead><tbody>
      ${((physical && doc.countLines) || doc.lines || []).map(line => {
        const qty = physical ? Number(line.adjustmentQty || 0) : Number(line.quantity || Math.abs(line.adjustmentQty || 0) || 0);
        const val = Math.abs(qty) * Number(line.unitCost || 0);
        return `<tr><td><a href='/inventory/items/${encodeURIComponent(line.inventoryId || line.itemId || '')}'>${esc(line.inventoryId || line.itemId || '')}</a></td><td>${esc(line.description || '')}</td><td>${esc(line.warehouse || doc.warehouse || doc.fromWarehouse || '')}</td><td>${esc(line.location || doc.location || doc.fromLocation || '')}</td>${physical ? `<td class='num'>${number(line.currentQty)}</td><td class='num'>${number(line.newQty)}</td><td class='num'>${number(line.adjustmentQty)}</td>` : `<td class='num'>${number(line.quantity)}</td><td class='num'>${number(line.adjustmentQty)}</td>`}<td class='num'>${money(line.unitCost)}</td><td class='num'>${money(val)}</td></tr>`;
      }).join('') || `<tr><td colspan='9' class='empty'>No lines.</td></tr>`}
      </tbody></table></div></section>`);
    const host = view.querySelector('#piInventoryRoot');
    bindNavButtons(host);
    host.querySelector('#piDetailBack').onclick = () => navigate(backPath);
    if (canPost) host.querySelector('#piDetailPost').onclick = async () => {
      try { await api('/api/inventory/documents/post', { method: 'POST', body: JSON.stringify({ referenceNumber: doc.referenceNumber }) }); notify('Inventory posted', `${doc.referenceNumber} was posted.`); scheduleRender(true); }
      catch (error) { notify('Unable to post inventory', error.message, true); }
    };
    if (canVoid) host.querySelector('#piDetailVoid').onclick = async () => {
      if (!confirm(`Void ${doc.referenceNumber}? This will reverse inventory quantities and the journal entry.`)) return;
      try { await api('/api/inventory/documents/void', { method: 'POST', body: JSON.stringify({ referenceNumber: doc.referenceNumber }) }); notify('Inventory voided', `${doc.referenceNumber} was reversed.`); scheduleRender(true); }
      catch (error) { notify('Unable to void inventory', error.message, true); }
    };
  }

  async function renderRelease(view) {
    const docs = (await api('/api/inventory/documents')).filter(doc => ['Saved', 'Open'].includes(doc.status) && (doc.inventoryOperation !== 'Physical Count' || (doc.lines || []).some(line => Number(line.adjustmentQty || 0) !== 0)));
    view.innerHTML = root(`
      <div class='pi-page-head'><div><h3>Post Inventory Documents</h3><p>Review saved inventory transactions and post them in one controlled step.</p></div><button type='button' id='piPostSelected' class='primary'>Post Selected</button></div>
      <div class='pi-table-wrap'><table class='pi-table'><thead><tr><th><input type='checkbox' id='piSelectAll'></th><th>Type</th><th>Reference</th><th>Date</th><th>Warehouse</th><th>Description</th><th>Qty</th><th>Value</th></tr></thead><tbody>
      ${docs.map(doc => `<tr><td><input type='checkbox' class='pi-release-check' value='${esc(doc.referenceNumber)}'></td><td>${esc(displayDocumentType(doc))}</td><td><a href='/inventory/documents/${encodeURIComponent(doc.referenceNumber)}'>${esc(doc.referenceNumber)}</a></td><td>${esc(doc.date || '')}</td><td>${esc(doc.warehouse || doc.fromWarehouse || doc.countWarehouse || '')}</td><td>${esc(doc.description || '')}</td><td class='num'>${number((doc.lines || []).reduce((sum, line) => sum + Math.abs(Number(line.adjustmentQty ?? line.quantity ?? 0)), 0))}</td><td class='num'>${money((doc.lines || []).reduce((sum, line) => sum + Math.abs(Number(line.adjustmentQty ?? line.quantity ?? 0)) * Number(line.unitCost || 0), 0))}</td></tr>`).join('') || `<tr><td colspan='8' class='empty'>No inventory documents are waiting to post.</td></tr>`}
      </tbody></table></div>`);
    const host = view.querySelector('#piInventoryRoot');
    host.querySelector('#piSelectAll').onchange = event => host.querySelectorAll('.pi-release-check').forEach(box => box.checked = event.target.checked);
    host.querySelector('#piPostSelected').onclick = async () => {
      const selected = [...host.querySelectorAll('.pi-release-check:checked')].map(box => box.value);
      if (!selected.length) return notify('Select documents', 'Select at least one document to post.', true);
      const failures = []; let posted = 0;
      for (const referenceNumber of selected) {
        try { await api('/api/inventory/documents/post', { method: 'POST', body: JSON.stringify({ referenceNumber }) }); posted++; }
        catch (error) { failures.push(`${referenceNumber}: ${error.message}`); }
      }
      notify(failures.length ? 'Posting completed with errors' : 'Inventory posted', `${posted} posted${failures.length ? `; ${failures.length} failed` : ''}.`, failures.length > 0);
      scheduleRender(true);
    };
  }

  async function renderOverview(view) {
    const [summary, documents] = await Promise.all([api('/api/inventory/summary'), api('/api/inventory/documents')]);
    const inventoryValue = summary.reduce((sum, row) => sum + Number(row.inventoryValue || 0), 0);
    const onHand = summary.reduce((sum, row) => sum + Number(row.qtyOnHand || 0), 0);
    const available = summary.reduce((sum, row) => sum + Number(row.qtyAvailable || 0), 0);
    const openDocs = documents.filter(doc => ['Saved', 'Open'].includes(doc.status)).length;
    view.innerHTML = root(`
      <div class='pi-page-head'><div><h3>Inventory</h3><p>Real-time stock control from item setup through counting, movement, valuation, and GL posting.</p></div></div>
      <div class='pi-kpis'><a href='/inventory/valuation-inquiry'><strong>${money(inventoryValue)}</strong><span>Inventory Value</span></a><a href='/inventory/summary'><strong>${number(onHand)}</strong><span>Qty On Hand</span></a><a href='/inventory/availability'><strong>${number(available)}</strong><span>Qty Available</span></a><a href='/inventory/release'><strong>${openDocs}</strong><span>Documents to Post</span></a></div>
      <div class='pi-action-grid'>
        <button data-nav='/inventory/items'>Items<span>Maintain item master and costing</span></button>
        <button data-nav='/inventory/receipts'>Receive Stock<span>Increase inventory from receipts</span></button>
        <button data-nav='/inventory/issues'>Issue Stock<span>Consume or remove inventory</span></button>
        <button data-nav='/inventory/transfers'>Transfer Stock<span>Move stock between locations</span></button>
        <button data-nav='/inventory/adjustments'>Adjust Stock<span>Correct quantity differences</span></button>
        <button data-nav='/inventory/physical-counts'>Physical Count<span>Count and post only variance</span></button>
      </div>`);
    bindNavButtons(view);
  }

  async function renderCurrentInventoryPath(force = false) {
    const path = location.pathname;
    if (!path.startsWith(INVENTORY_PREFIX)) return;
    simplifyInventoryNavigation();
    const view = document.getElementById('view');
    if (!view) return;
    if (!force && view.dataset.profInventoryPath === `${path}${location.search}` && view.querySelector(`[${ROOT_ATTR}]`)) return;
    view.dataset.profInventoryPath = `${path}${location.search}`;
    try {
      if (path === '/inventory') return await renderOverview(view);
      if (path === '/inventory/items') return await renderItems(view);
      if (path.startsWith('/inventory/items/')) return await renderItemDetail(view, decodeURIComponent(path.split('/').pop()));
      if (path === '/inventory/physical-counts') return await renderPhysicalCounts(view);
      if (path === '/inventory/physical-counts/new') return await renderNewPhysicalCount(view);
      for (const [basePath, type] of Object.entries(documentPaths)) {
        if (path === basePath) return await renderDocumentList(view, type);
        if (path === `${basePath}/new`) return await renderNewDocument(view, type);
      }
      if (path.startsWith('/inventory/documents/')) return await renderDocumentDetail(view, decodeURIComponent(path.split('/').pop()));
      if (path === '/inventory/release') return await renderRelease(view);
    } catch (error) {
      view.innerHTML = root(`<section class='pi-card pi-error'><h3>Inventory could not load</h3><p>${esc(error.message)}</p><button type='button' id='piRetry'>Retry</button></section>`);
      view.querySelector('#piRetry').onclick = () => scheduleRender(true);
    }
  }

  let scheduled = false;
  function scheduleRender(force = false) {
    if (!location.pathname.startsWith(INVENTORY_PREFIX)) return;
    if (scheduled && !force) return;
    scheduled = true;
    setTimeout(async () => { scheduled = false; await renderCurrentInventoryPath(force); }, 0);
  }

  const observer = new MutationObserver(() => scheduleRender(false));
  const start = () => {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', () => scheduleRender(true));
    document.addEventListener('click', event => {
      const anchor = event.target.closest('a[href^="/inventory"]');
      if (anchor) setTimeout(() => scheduleRender(true), 0);
    }, true);
    scheduleRender(true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
