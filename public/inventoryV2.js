(() => {
  'use strict';

  const ROOT_ID = 'inventoryV2Root';
  const INVENTORY_PREFIX = '/inventory';
  const MANAGED = new Set([
    '/inventory', '/inventory/items', '/inventory/item-classes',
    '/inventory/receipts', '/inventory/issues', '/inventory/transfers', '/inventory/adjustments', '/inventory/physical-counts',
    '/inventory/release', '/inventory/summary', '/inventory/availability', '/inventory/transactions', '/inventory/valuation-inquiry',
    '/inventory/warehouses', '/inventory/locations', '/inventory/reason-codes'
  ]);
  const DOC_PATHS = {
    Receipt: '/inventory/receipts',
    Issue: '/inventory/issues',
    Transfer: '/inventory/transfers',
    Adjustment: '/inventory/adjustments'
  };
  const ITEM_CLASS_DEFAULTS = {
    'INDUSTRIAL-EQUIPMENT': {
      description: 'Industrial Equipment', itemType: 'Stock Item', baseUom: 'EA', salesUom: 'EA', purchaseUom: 'EA',
      warehouse: 'MAIN', location: 'MAIN-A1', costingMethod: 'Average Cost', lotSerialTracking: 'Serial',
      replenishmentMethod: 'Manual', replenishmentSource: 'Purchase', reorderPoint: 0, safetyStock: 0, leadTimeDays: 30
    },
    'SERVICE-PARTS': {
      description: 'Service Parts', itemType: 'Stock Item', baseUom: 'EA', salesUom: 'EA', purchaseUom: 'EA',
      warehouse: 'SERVICE', location: 'SERVICE-BIN', costingMethod: 'Average Cost', lotSerialTracking: 'None',
      replenishmentMethod: 'Reorder Point', replenishmentSource: 'Purchase', reorderPoint: 5, safetyStock: 2, leadTimeDays: 14
    },
    'RAW-MATERIALS': {
      description: 'Raw Materials', itemType: 'Stock Item', baseUom: 'LB', salesUom: 'LB', purchaseUom: 'LB',
      warehouse: 'PROD', location: 'PROD-WIP', costingMethod: 'Average Cost', lotSerialTracking: 'Lot',
      replenishmentMethod: 'Min/Max', replenishmentSource: 'Purchase', reorderPoint: 100, safetyStock: 50, leadTimeDays: 10
    },
    'FINISHED-GOODS': {
      description: 'Finished Goods', itemType: 'Stock Item', baseUom: 'EA', salesUom: 'EA', purchaseUom: 'EA',
      warehouse: 'MAIN', location: 'MAIN-A1', costingMethod: 'Standard Cost', lotSerialTracking: 'Serial',
      replenishmentMethod: 'Demand Based', replenishmentSource: 'Manufacturing', reorderPoint: 0, safetyStock: 0, leadTimeDays: 7
    },
    'CONSUMABLES': {
      description: 'Shop / Warehouse Consumables', itemType: 'Stock Item', baseUom: 'EA', salesUom: 'EA', purchaseUom: 'EA',
      warehouse: 'MAIN', location: 'MAIN-A2', costingMethod: 'Average Cost', lotSerialTracking: 'None',
      replenishmentMethod: 'Reorder Point', replenishmentSource: 'Purchase', reorderPoint: 20, safetyStock: 10, leadTimeDays: 7
    },
    'SERVICES': {
      description: 'Services', itemType: 'Service Item', baseUom: 'HR', salesUom: 'HR', purchaseUom: 'HR',
      warehouse: 'SERVICE', location: 'SERVICE-BIN', costingMethod: 'Average Cost', lotSerialTracking: 'None',
      replenishmentMethod: 'None', replenishmentSource: 'Purchase', reorderPoint: 0, safetyStock: 0, leadTimeDays: 0
    },
    'FREIGHT': {
      description: 'Freight / Logistics', itemType: 'Freight Item', baseUom: 'EA', salesUom: 'EA', purchaseUom: 'EA',
      warehouse: 'MAIN', location: 'MAIN-A1', costingMethod: 'Average Cost', lotSerialTracking: 'None',
      replenishmentMethod: 'None', replenishmentSource: 'Purchase', reorderPoint: 0, safetyStock: 0, leadTimeDays: 0
    }
  };
  const EXTRA_UOMS = [
    { id: 'EA', description: 'Each' }, { id: 'SET', description: 'Set' }, { id: 'LB', description: 'Pound' },
    { id: 'FT', description: 'Foot' }, { id: 'HR', description: 'Hour' }, { id: 'LOT', description: 'Lot' }
  ];

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = value => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  const num = value => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
  const today = () => new Date().toISOString().slice(0, 10);
  const uniqueBy = (rows, key) => [...new Map(rows.map(row => [row[key], row])).values()];

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
    document.getElementById('inventoryV2Toast')?.remove();
    const el = document.createElement('div');
    el.id = 'inventoryV2Toast';
    el.className = `iv2-toast${error ? ' error' : ''}`;
    el.innerHTML = `<strong>${esc(title)}</strong><span>${esc(message)}</span><button type='button' aria-label='Close'>×</button>`;
    document.body.appendChild(el);
    el.querySelector('button').onclick = () => el.remove();
    setTimeout(() => el.remove(), 5000);
  }

  function root(html) { return `<div id='${ROOT_ID}'>${html}</div>`; }
  function setTitle(title) { const el = document.getElementById('title'); if (el) el.textContent = title; }

  function isManagedPath(path = location.pathname) {
    if (MANAGED.has(path)) return true;
    if (path.startsWith('/inventory/items/')) return true;
    if (path.startsWith('/inventory/documents/')) return true;
    if (Object.values(DOC_PATHS).some(base => path === `${base}/new`)) return true;
    return path === '/inventory/physical-counts/new';
  }

  function navigate(path) {
    history.pushState({}, '', path);
    renderManagedPath(true);
  }

  function rebuildSidebar() {
    if (!location.pathname.startsWith(INVENTORY_PREFIX)) return;
    const nav = document.getElementById('ar-nav');
    if (!nav) return;
    const existingMarker = nav.querySelector('[data-inventory-v2-nav]');
    if (existingMarker?.dataset.path === location.pathname) return;
    const groups = [
      ['Overview', [['/inventory', 'Inventory Overview']]],
      ['Transactions', [['/inventory/receipts', 'Receipts'], ['/inventory/issues', 'Issues'], ['/inventory/transfers', 'Transfers'], ['/inventory/adjustments', 'Adjustments'], ['/inventory/physical-counts', 'Physical Counts']]],
      ['Manage', [['/inventory/items', 'Inventory Items'], ['/inventory/item-classes', 'Item Classes'], ['/inventory/warehouses', 'Warehouses'], ['/inventory/locations', 'Locations'], ['/inventory/reason-codes', 'Reason Codes']]],
      ['Processes', [['/inventory/release', 'Post Inventory Documents']]],
      ['Inquiries', [['/inventory/summary', 'On Hand'], ['/inventory/availability', 'Availability'], ['/inventory/transactions', 'Transaction History'], ['/inventory/valuation-inquiry', 'Valuation']]]
    ];
    nav.innerHTML = `<span data-inventory-v2-nav data-path='${esc(location.pathname)}' hidden></span>` + groups.map(([group, links]) => `<div class='nav-group'><div class='nav-group-title'>${group}</div>${links.map(([href, label]) => `<a href='${href}' class='${location.pathname === href ? 'active' : ''}'>${label}</a>`).join('')}</div>`).join('');
  }

  function toolbar(buttons) {
    return `<div class='iv2-toolbar'>${buttons.map(button => `<button type='button' id='${esc(button.id)}' class='${button.primary ? 'primary' : ''}${button.danger ? ' danger' : ''}' ${button.disabled ? 'disabled' : ''}>${esc(button.label)}</button>`).join('')}</div>`;
  }

  function optionRows(rows, valueKey, label, selected) {
    return rows.map(row => `<option value='${esc(row[valueKey])}' ${String(row[valueKey]) === String(selected) ? 'selected' : ''}>${esc(label(row))}</option>`).join('');
  }

  function activeLocations(setup, warehouse) { return (setup.locations || []).filter(row => row.warehouse === warehouse && row.active !== false); }
  function mergedUoms(setup) { return uniqueBy([...(setup.unitsOfMeasure || []), ...EXTRA_UOMS], 'id'); }
  function classRows(setup) {
    const server = (setup.itemClasses || []).map(row => ({ id: row.id, description: row.description, ...(ITEM_CLASS_DEFAULTS[row.id] || {}) }));
    const missing = Object.entries(ITEM_CLASS_DEFAULTS).filter(([id]) => !server.some(row => row.id === id)).map(([id, defaults]) => ({ id, ...defaults }));
    return [...server, ...missing];
  }

  function accountChoice(accounts, preferred, pattern, prefix) {
    if (accounts.some(account => account.code === preferred)) return preferred;
    return accounts.find(account => pattern.test(`${account.code || ''} ${account.name || ''}`))?.code || accounts.find(account => String(account.code || '').startsWith(prefix))?.code || accounts[0]?.code || '';
  }
  function accountOptions(accounts, selected) { return optionRows(accounts, 'code', row => `${row.code} - ${row.name}`, selected); }

  async function renderOverview(view) {
    setTitle('Inventory');
    const [summary, docs] = await Promise.all([api('/api/inventory/summary'), api('/api/inventory/documents')]);
    const value = summary.reduce((s, row) => s + Number(row.inventoryValue || 0), 0);
    const onHand = summary.reduce((s, row) => s + Number(row.qtyOnHand || 0), 0);
    const available = summary.reduce((s, row) => s + Number(row.qtyAvailable || 0), 0);
    const open = docs.filter(row => ['Saved', 'Open'].includes(row.status)).length;
    view.innerHTML = root(`
      <div class='iv2-page-head'><div><h3>Inventory Management</h3><p>Receive, issue, move, adjust, count, and value stock using controlled ERP transactions.</p></div></div>
      <div class='iv2-kpis'><a href='/inventory/valuation-inquiry'><strong>${money(value)}</strong><span>Inventory Value</span></a><a href='/inventory/summary'><strong>${num(onHand)}</strong><span>On Hand</span></a><a href='/inventory/availability'><strong>${num(available)}</strong><span>Available</span></a><a href='/inventory/release'><strong>${open}</strong><span>Documents to Post</span></a></div>
      <section class='iv2-card'><h4>Transactions</h4><div class='iv2-actions'>
        <button data-nav='/inventory/receipts'>Receipt<span>Receive stock into a warehouse</span></button>
        <button data-nav='/inventory/issues'>Issue<span>Consume or remove stock</span></button>
        <button data-nav='/inventory/transfers'>Transfer<span>Move stock between locations</span></button>
        <button data-nav='/inventory/adjustments'>Adjustment<span>Correct inventory quantities</span></button>
        <button data-nav='/inventory/physical-counts'>Physical Count<span>Count stock and post variance</span></button>
      </div></section>
      <section class='iv2-card'><h4>Manage</h4><div class='iv2-actions manage'>
        <button data-nav='/inventory/items'>Inventory Items<span>Item master, costing and accounts</span></button>
        <button data-nav='/inventory/item-classes'>Item Classes<span>Default UOM, warehouse and tracking</span></button>
        <button data-nav='/inventory/warehouses'>Warehouses<span>Warehouse setup</span></button>
        <button data-nav='/inventory/locations'>Locations<span>Bin and location setup</span></button>
      </div></section>`);
    view.querySelectorAll('[data-nav]').forEach(el => el.onclick = () => navigate(el.dataset.nav));
  }

  async function renderItems(view) {
    setTitle('Inventory Items');
    const items = await api('/api/inventory/items');
    view.innerHTML = root(`
      <div class='iv2-page-head'><div><h3>Inventory Items</h3><p>Maintain item master records. Transaction buttons belong on transaction screens, not the item master.</p></div><button id='iv2NewItem' class='primary'>New Item</button></div>
      <div class='iv2-search'><input id='iv2ItemSearch' type='search' placeholder='Search inventory ID or description'></div>
      <div class='iv2-table-wrap'><table class='iv2-table'><thead><tr><th>Inventory ID</th><th>Description</th><th>Class</th><th>UOM</th><th>Warehouse</th><th>Status</th><th>Available</th><th>Inventory Value</th></tr></thead><tbody>
      ${items.map(item => `<tr data-search='${esc(`${item.code} ${item.description || item.name || ''}`.toLowerCase())}'><td><a href='/inventory/items/${encodeURIComponent(item.code)}'>${esc(item.code)}</a></td><td>${esc(item.description || item.name || '')}</td><td>${esc(item.itemClass || '')}</td><td>${esc(item.baseUom || item.uom || '')}</td><td>${esc(item.defaultWarehouse || '')}</td><td>${esc(item.status || '')}</td><td class='num'>${num(item.qtyAvailable)}</td><td class='num'>${money(item.inventoryValue)}</td></tr>`).join('') || `<tr><td colspan='8' class='empty'>No inventory items.</td></tr>`}
      </tbody></table></div>`);
    view.querySelector('#iv2NewItem').onclick = () => navigate('/inventory/items/new');
    view.querySelector('#iv2ItemSearch').oninput = event => {
      const q = event.target.value.toLowerCase().trim();
      view.querySelectorAll('tbody tr[data-search]').forEach(row => row.hidden = q && !row.dataset.search.includes(q));
    };
  }

  async function renderItemClasses(view) {
    setTitle('Item Classes');
    const setup = await api('/api/inventory/setup');
    const rows = classRows(setup);
    view.innerHTML = root(`
      <div class='iv2-page-head'><div><h3>Item Classes</h3><p>Classes apply consistent defaults when a new item is created. Users can override a default on the item when needed.</p></div></div>
      <div class='iv2-table-wrap'><table class='iv2-table'><thead><tr><th>Class</th><th>Description</th><th>Item Type</th><th>Base UOM</th><th>Warehouse</th><th>Location</th><th>Costing</th><th>Tracking</th><th>Replenishment</th></tr></thead><tbody>
      ${rows.map(row => `<tr><td><strong>${esc(row.id)}</strong></td><td>${esc(row.description || '')}</td><td>${esc(row.itemType || 'Stock Item')}</td><td>${esc(row.baseUom || 'EA')}</td><td>${esc(row.warehouse || 'MAIN')}</td><td>${esc(row.location || '')}</td><td>${esc(row.costingMethod || 'Average Cost')}</td><td>${esc(row.lotSerialTracking || 'None')}</td><td>${esc(row.replenishmentMethod || 'None')}</td></tr>`).join('')}
      </tbody></table></div>`);
  }

  async function renderItemDetail(view, id) {
    setTitle(id === 'new' ? 'New Inventory Item' : 'Inventory Item');
    const isNew = id === 'new';
    const [setup, accounts, item] = await Promise.all([api('/api/inventory/setup'), api('/api/gl/accounts'), isNew ? Promise.resolve(null) : api(`/api/inventory/items/${encodeURIComponent(id)}`)]);
    const classes = classRows(setup);
    const selectedClass = item?.itemClass || 'INDUSTRIAL-EQUIPMENT';
    const preset = ITEM_CLASS_DEFAULTS[selectedClass] || classes.find(row => row.id === selectedClass) || ITEM_CLASS_DEFAULTS['INDUSTRIAL-EQUIPMENT'];
    const selectedWarehouse = item?.defaultWarehouse || preset.warehouse || 'MAIN';
    const selectedLocation = item?.defaultLocation || preset.location || activeLocations(setup, selectedWarehouse)[0]?.locationId || '';
    const uoms = mergedUoms(setup);
    const inventoryAccount = item?.inventoryAccount || accountChoice(accounts, '1507', /inventory|stock/i, '1');
    const cogsAccount = item?.cogsAccount || accountChoice(accounts, '5110', /cost of goods|cogs/i, '5');
    const revenueAccount = item?.revenueAccount || accountChoice(accounts, '4008', /revenue|sales/i, '4');
    const accrualAccount = item?.purchaseAccrualAccount || accountChoice(accounts, '2020', /accrual|receipt.*not.*invoice|rni/i, '2');
    const adjustmentAccount = item?.adjustmentAccount || accountChoice(accounts, '5109', /adjustment|variance|scrap/i, '5');
    const varianceAccount = item?.varianceAccount || adjustmentAccount;
    view.innerHTML = root(`
      ${toolbar([{ id: 'iv2ItemBack', label: 'Back' }, { id: 'iv2ItemSave', label: 'Save', primary: true }, { id: 'iv2ItemSaveClose', label: 'Save & Close' }])}
      <div class='iv2-page-head compact'><div><h3>${isNew ? 'New Inventory Item' : `${esc(item.code)} · ${esc(item.description || item.name || '')}`}</h3><p>${isNew ? 'Choose an item class first; its operational defaults will be applied automatically.' : `On hand ${num(item.qtyOnHand)} · Available ${num(item.qtyAvailable)} · Value ${money(item.inventoryValue)}`}</p></div></div>
      <section class='iv2-card'><h4>General</h4><div class='iv2-form-grid'>
        <label class='required'>Inventory ID<input id='iv2ItemCode' value='${esc(item?.code || '')}' ${isNew ? '' : 'readonly'}></label>
        <label class='required span2'>Description<input id='iv2ItemDesc' value='${esc(item?.description || item?.name || '')}'></label>
        <label>Item Class<select id='iv2ItemClass'>${optionRows(classes, 'id', row => `${row.id} - ${row.description}`, selectedClass)}</select><small>Changing class applies class defaults.</small></label>
        <label>Item Type<select id='iv2ItemType'>${['Stock Item', 'Non-Stock Item', 'Service Item', 'Freight Item'].map(x => `<option ${x === (item?.type || preset.itemType || 'Stock Item') ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Status<select id='iv2ItemStatus'>${['Active', 'Inactive', 'No Sales', 'No Purchases', 'Discontinued'].map(x => `<option ${x === (item?.status || 'Active') ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Base UOM<select id='iv2BaseUom'>${optionRows(uoms, 'id', row => `${row.id} - ${row.description}`, item?.baseUom || item?.uom || preset.baseUom || 'EA')}</select></label>
        <label>Sales UOM<select id='iv2SalesUom'>${optionRows(uoms, 'id', row => `${row.id} - ${row.description}`, item?.salesUom || preset.salesUom || 'EA')}</select></label>
        <label>Purchase UOM<select id='iv2PurchaseUom'>${optionRows(uoms, 'id', row => `${row.id} - ${row.description}`, item?.purchaseUom || preset.purchaseUom || 'EA')}</select></label>
        <label>Default Warehouse<select id='iv2Warehouse'>${optionRows((setup.warehouses || []).filter(row => row.active !== false), 'warehouseId', row => `${row.warehouseId} - ${row.name}`, selectedWarehouse)}</select></label>
        <label>Default Location<select id='iv2Location'>${optionRows(activeLocations(setup, selectedWarehouse), 'locationId', row => `${row.locationId} - ${row.description}`, selectedLocation)}</select></label>
        <label>Tracking<select id='iv2Tracking'>${['None', 'Lot', 'Serial'].map(x => `<option ${x === (item?.lotSerialTracking || preset.lotSerialTracking || 'None') ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      </div></section>
      <section class='iv2-card'><h4>Costing & Pricing</h4><div class='iv2-form-grid'>
        <label>Costing Method<select id='iv2Costing'>${['Average Cost', 'Standard Cost', 'FIFO'].map(x => `<option ${x === (item?.costingMethod || preset.costingMethod || 'Average Cost') ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Standard Cost<input id='iv2StdCost' type='number' min='0' step='0.01' value='${Number(item?.standardCost || 0)}'></label>
        <label>Sales Price<input id='iv2SalesPrice' type='number' min='0' step='0.01' value='${Number(item?.salesPrice || 0)}'></label>
      </div></section>
      <section class='iv2-card'><h4>GL Posting Accounts</h4><div class='iv2-form-grid'>
        <label>Inventory Asset<select id='iv2InvAcct'>${accountOptions(accounts, inventoryAccount)}</select></label>
        <label>COGS / Issue Expense<select id='iv2CogsAcct'>${accountOptions(accounts, cogsAccount)}</select></label>
        <label>Revenue<select id='iv2RevAcct'>${accountOptions(accounts, revenueAccount)}</select></label>
        <label>Receipt Accrual / RNI<select id='iv2RniAcct'>${accountOptions(accounts, accrualAccount)}</select></label>
        <label>Adjustment<select id='iv2AdjAcct'>${accountOptions(accounts, adjustmentAccount)}</select></label>
        <label>Variance / Scrap<select id='iv2VarAcct'>${accountOptions(accounts, varianceAccount)}</select></label>
      </div></section>
      <section class='iv2-card'><h4>Replenishment</h4><div class='iv2-form-grid'>
        <label>Method<select id='iv2ReplMethod'>${['None', 'Reorder Point', 'Min/Max', 'Demand Based', 'Manual'].map(x => `<option ${x === (item?.replenishmentMethod || preset.replenishmentMethod || 'None') ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Source<select id='iv2ReplSource'>${['Purchase', 'Transfer', 'Manufacturing', 'Drop Ship'].map(x => `<option ${x === (item?.replenishmentSource || preset.replenishmentSource || 'Purchase') ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Reorder Point<input id='iv2Reorder' type='number' min='0' step='1' value='${Number(item?.reorderPoint ?? preset.reorderPoint ?? 0)}'></label>
        <label>Safety Stock<input id='iv2Safety' type='number' min='0' step='1' value='${Number(item?.safetyStock ?? preset.safetyStock ?? 0)}'></label>
        <label>Lead Time Days<input id='iv2Lead' type='number' min='0' step='1' value='${Number(item?.leadTimeDays ?? preset.leadTimeDays ?? 0)}'></label>
        <label>Preferred Vendor<input id='iv2Vendor' value='${esc(item?.preferredVendor || '')}'></label>
      </div></section>
      ${!isNew ? `<section class='iv2-card'><h4>On Hand by Warehouse / Location</h4><div class='iv2-table-wrap'><table class='iv2-table'><thead><tr><th>Warehouse</th><th>Location</th><th>On Hand</th><th>Allocated</th><th>Available</th><th>Average Cost</th></tr></thead><tbody>${(item.warehouseDetails || []).map(row => `<tr><td>${esc(row.warehouse)}</td><td>${esc(row.location)}</td><td class='num'>${num(row.qtyOnHand)}</td><td class='num'>${num(row.qtyAllocated)}</td><td class='num'>${num(Number(row.qtyOnHand || 0) - Number(row.qtyAllocated || 0))}</td><td class='num'>${money(row.averageCost)}</td></tr>`).join('') || `<tr><td colspan='6' class='empty'>No inventory balance.</td></tr>`}</tbody></table></div></section>` : ''}`);

    const host = view.querySelector(`#${ROOT_ID}`);
    host.querySelector('#iv2ItemBack').onclick = () => navigate('/inventory/items');
    const wh = host.querySelector('#iv2Warehouse');
    const loc = host.querySelector('#iv2Location');
    const refreshLocations = preferred => {
      const rows = activeLocations(setup, wh.value);
      loc.innerHTML = optionRows(rows, 'locationId', row => `${row.locationId} - ${row.description}`, preferred || rows[0]?.locationId || '');
    };
    wh.onchange = () => refreshLocations('');
    host.querySelector('#iv2ItemClass').onchange = event => {
      const defaults = ITEM_CLASS_DEFAULTS[event.target.value];
      if (!defaults) return;
      host.querySelector('#iv2ItemType').value = defaults.itemType;
      host.querySelector('#iv2BaseUom').value = defaults.baseUom;
      host.querySelector('#iv2SalesUom').value = defaults.salesUom;
      host.querySelector('#iv2PurchaseUom').value = defaults.purchaseUom;
      if ([...wh.options].some(option => option.value === defaults.warehouse)) wh.value = defaults.warehouse;
      refreshLocations(defaults.location);
      host.querySelector('#iv2Tracking').value = defaults.lotSerialTracking;
      host.querySelector('#iv2Costing').value = defaults.costingMethod;
      host.querySelector('#iv2ReplMethod').value = defaults.replenishmentMethod;
      host.querySelector('#iv2ReplSource').value = defaults.replenishmentSource;
      host.querySelector('#iv2Reorder').value = defaults.reorderPoint;
      host.querySelector('#iv2Safety').value = defaults.safetyStock;
      host.querySelector('#iv2Lead').value = defaults.leadTimeDays;
      notify('Item class defaults applied', `${defaults.description}: ${defaults.baseUom}, ${defaults.warehouse}/${defaults.location}, ${defaults.costingMethod}.`);
    };
    const payload = () => ({
      code: host.querySelector('#iv2ItemCode').value.trim(), inventoryId: host.querySelector('#iv2ItemCode').value.trim(),
      description: host.querySelector('#iv2ItemDesc').value.trim(), name: host.querySelector('#iv2ItemDesc').value.trim(),
      itemClass: host.querySelector('#iv2ItemClass').value, type: host.querySelector('#iv2ItemType').value, itemType: host.querySelector('#iv2ItemType').value,
      status: host.querySelector('#iv2ItemStatus').value, baseUom: host.querySelector('#iv2BaseUom').value, uom: host.querySelector('#iv2BaseUom').value,
      salesUom: host.querySelector('#iv2SalesUom').value, purchaseUom: host.querySelector('#iv2PurchaseUom').value,
      defaultWarehouse: wh.value, defaultLocation: loc.value, lotSerialTracking: host.querySelector('#iv2Tracking').value,
      costingMethod: host.querySelector('#iv2Costing').value, standardCost: Number(host.querySelector('#iv2StdCost').value || 0), salesPrice: Number(host.querySelector('#iv2SalesPrice').value || 0),
      trackQuantity: host.querySelector('#iv2ItemType').value === 'Stock Item', inventoryAccount: host.querySelector('#iv2InvAcct').value,
      cogsAccount: host.querySelector('#iv2CogsAcct').value, revenueAccount: host.querySelector('#iv2RevAcct').value,
      purchaseAccrualAccount: host.querySelector('#iv2RniAcct').value, adjustmentAccount: host.querySelector('#iv2AdjAcct').value, varianceAccount: host.querySelector('#iv2VarAcct').value,
      replenishmentMethod: host.querySelector('#iv2ReplMethod').value, replenishmentSource: host.querySelector('#iv2ReplSource').value,
      reorderPoint: Number(host.querySelector('#iv2Reorder').value || 0), safetyStock: Number(host.querySelector('#iv2Safety').value || 0), leadTimeDays: Number(host.querySelector('#iv2Lead').value || 0),
      preferredVendor: host.querySelector('#iv2Vendor').value.trim()
    });
    async function save(close) {
      const data = payload();
      if (!data.code) return notify('Inventory ID required', 'Enter an Inventory ID.', true);
      if (!data.description) return notify('Description required', 'Enter an item description.', true);
      try {
        const saved = await api(isNew ? '/api/inventory/items' : `/api/inventory/items/${encodeURIComponent(item.code)}`, { method: isNew ? 'POST' : 'PUT', body: JSON.stringify(data) });
        notify('Item saved', `${saved.code} was saved.`);
        navigate(close ? '/inventory/items' : `/inventory/items/${encodeURIComponent(saved.code)}`);
      } catch (error) { notify('Unable to save item', error.message, true); }
    }
    host.querySelector('#iv2ItemSave').onclick = () => save(false);
    host.querySelector('#iv2ItemSaveClose').onclick = () => save(true);
  }

  function docTitle(type) { return type === 'Physical Count' ? 'Physical Counts' : `${type}s`; }
  function docBase(type) { return type === 'Physical Count' ? '/inventory/physical-counts' : DOC_PATHS[type]; }
  function displayType(doc) { return doc.inventoryOperation === 'Physical Count' ? 'Physical Count' : doc.documentType; }
  function docStatus(doc) {
    if (doc.inventoryOperation === 'Physical Count' && doc.status === 'Saved' && (doc.lines || []).length && (doc.lines || []).every(line => Number(line.adjustmentQty || 0) === 0)) return 'Counted - No Variance';
    return doc.status || 'Saved';
  }

  async function renderDocumentList(view, type) {
    setTitle(docTitle(type));
    const docs = await api('/api/inventory/documents');
    const rows = type === 'Physical Count' ? docs.filter(doc => doc.inventoryOperation === 'Physical Count') : docs.filter(doc => doc.documentType === type && doc.inventoryOperation !== 'Physical Count');
    view.innerHTML = root(`
      <div class='iv2-page-head'><div><h3>${docTitle(type)}</h3><p>${type === 'Physical Count' ? 'Count warehouse stock and post only the difference.' : `Create and review inventory ${type.toLowerCase()} transactions.`}</p></div><button id='iv2NewDoc' class='primary'>New ${type}</button></div>
      <div class='iv2-table-wrap'><table class='iv2-table'><thead><tr><th>Reference</th><th>Status</th><th>Date</th><th>Warehouse</th><th>Description</th><th>Qty</th><th>Value</th></tr></thead><tbody>
      ${rows.slice().reverse().map(doc => { const qty = (doc.lines || []).reduce((s, l) => s + Math.abs(Number(l.adjustmentQty ?? l.quantity ?? 0)), 0); const value = (doc.lines || []).reduce((s, l) => s + Math.abs(Number(l.adjustmentQty ?? l.quantity ?? 0)) * Number(l.unitCost || 0), 0); return `<tr><td><a href='/inventory/documents/${encodeURIComponent(doc.referenceNumber)}'>${esc(doc.referenceNumber)}</a></td><td><span class='iv2-status'>${esc(docStatus(doc))}</span></td><td>${esc(doc.date || doc.postDate || '')}</td><td>${esc(doc.warehouse || doc.fromWarehouse || doc.countWarehouse || '')}</td><td>${esc(doc.description || '')}</td><td class='num'>${num(qty)}</td><td class='num'>${money(value)}</td></tr>`; }).join('') || `<tr><td colspan='7' class='empty'>No documents.</td></tr>`}
      </tbody></table></div>`);
    view.querySelector('#iv2NewDoc').onclick = () => navigate(`${docBase(type)}/new`);
  }

  function stockItems(items) { return items.filter(item => item.status !== 'Inactive' && item.status !== 'Discontinued' && (item.trackQuantity !== false || item.type === 'Stock Item')); }
  function findBalance(summary, itemId, warehouse, location) { return summary.filter(row => row.inventoryId === itemId && row.warehouse === warehouse && (!location || row.location === location)).reduce((s, row) => s + Number(row.qtyAvailable || 0), 0); }

  async function renderNewDocument(view, type) {
    setTitle(`New ${type}`);
    const [itemsAll, setup, summary] = await Promise.all([api('/api/inventory/items'), api('/api/inventory/setup'), api('/api/inventory/summary')]);
    const items = stockItems(itemsAll);
    const query = new URLSearchParams(location.search);
    const firstItem = items.find(row => row.code === query.get('item')) || items[0] || {};
    const warehouse = firstItem.defaultWarehouse || setup.warehouses?.find(row => row.active !== false)?.warehouseId || 'MAIN';
    const locationId = firstItem.defaultLocation || activeLocations(setup, warehouse)[0]?.locationId || '';
    const isTransfer = type === 'Transfer';
    const isAdjustment = type === 'Adjustment';
    const reasons = setup.reasonCodes || [];
    view.innerHTML = root(`
      ${toolbar([{ id: 'iv2DocBack', label: 'Back' }, { id: 'iv2DocSave', label: 'Save' }, { id: 'iv2DocPost', label: 'Save & Post', primary: true }])}
      <div class='iv2-page-head compact'><div><h3>New ${type}</h3><p>${type === 'Receipt' ? 'Receive stock by inventory item and quantity.' : type === 'Issue' ? 'Issue stock from on-hand inventory.' : type === 'Transfer' ? 'Move stock between warehouses or locations.' : 'Record a signed quantity correction with a reason code.'}</p></div></div>
      <section class='iv2-card'><h4>Document</h4><div class='iv2-form-grid'>
        <label>Date<input id='iv2DocDate' type='date' value='${today()}'></label>
        <label>Reference / Source<input id='iv2SourceRef' placeholder='PO, work order, count sheet, etc.'></label>
        <label class='span2'>Description<input id='iv2DocDesc' placeholder='Transaction description'></label>
        <label>${isTransfer ? 'From Warehouse' : 'Warehouse'}<select id='iv2DocWh'>${optionRows((setup.warehouses || []).filter(row => row.active !== false), 'warehouseId', row => `${row.warehouseId} - ${row.name}`, warehouse)}</select></label>
        <label>${isTransfer ? 'From Location' : 'Location'}<select id='iv2DocLoc'>${optionRows(activeLocations(setup, warehouse), 'locationId', row => `${row.locationId} - ${row.description}`, locationId)}</select></label>
        ${isTransfer ? `<label>To Warehouse<select id='iv2ToWh'>${optionRows((setup.warehouses || []).filter(row => row.active !== false), 'warehouseId', row => `${row.warehouseId} - ${row.name}`, setup.warehouses?.find(row => row.active !== false && row.warehouseId !== warehouse)?.warehouseId || warehouse)}</select></label><label>To Location<select id='iv2ToLoc'></select></label>` : ''}
      </div></section>
      <section class='iv2-card'><div class='iv2-section-head'><h4>Lines</h4><button id='iv2AddLine'>Add Line</button></div><datalist id='iv2ItemList'>${items.map(item => `<option value='${esc(item.code)}'>${esc(item.description || item.name || '')}</option>`).join('')}</datalist>
        <div class='iv2-table-wrap'><table class='iv2-table iv2-entry' id='iv2Lines'><thead><tr><th>Inventory Item</th><th>Description</th><th>UOM</th><th>Available</th><th>${isAdjustment ? 'Adjustment Qty (+/-)' : 'Quantity'}</th><th>Unit Cost</th>${isAdjustment ? '<th>Reason</th><th>New Qty</th>' : ''}<th></th></tr></thead><tbody></tbody></table></div>
      </section>`);
    const host = view.querySelector(`#${ROOT_ID}`);
    const wh = host.querySelector('#iv2DocWh');
    const loc = host.querySelector('#iv2DocLoc');
    const toWh = host.querySelector('#iv2ToWh');
    const toLoc = host.querySelector('#iv2ToLoc');
    const refreshLocationSelect = (select, warehouseValue, preferred = '') => { const rows = activeLocations(setup, warehouseValue); select.innerHTML = optionRows(rows, 'locationId', row => `${row.locationId} - ${row.description}`, preferred || rows[0]?.locationId || ''); };
    wh.onchange = () => { refreshLocationSelect(loc, wh.value); refreshAllLines(); };
    loc.onchange = () => refreshAllLines();
    if (toWh) { refreshLocationSelect(toLoc, toWh.value); toWh.onchange = () => refreshLocationSelect(toLoc, toWh.value); }
    host.querySelector('#iv2DocBack').onclick = () => navigate(DOC_PATHS[type]);

    function selectedItem(input) { return items.find(item => item.code === input.value.trim()); }
    function refreshRow(tr) {
      const item = selectedItem(tr.querySelector('.iv2-line-item'));
      const desc = tr.querySelector('.iv2-line-desc');
      const uom = tr.querySelector('.iv2-line-uom');
      const availableCell = tr.querySelector('.iv2-line-available');
      if (!item) { desc.textContent = 'Select a valid inventory item'; uom.textContent = ''; availableCell.textContent = '—'; return; }
      const available = findBalance(summary, item.code, wh.value, loc.value);
      desc.textContent = item.description || item.name || '';
      uom.textContent = item.baseUom || item.uom || 'EA';
      availableCell.textContent = num(available);
      tr.dataset.available = String(available);
      if (!tr.querySelector('.iv2-line-cost').dataset.touched) tr.querySelector('.iv2-line-cost').value = Number(item.averageCost || item.standardCost || item.cost || 0);
      if (isAdjustment) recalcAdjustment(tr);
    }
    function recalcAdjustment(tr) {
      if (!isAdjustment) return;
      const available = Number(tr.dataset.available || 0);
      const qty = Number(tr.querySelector('.iv2-line-qty').value || 0);
      tr.querySelector('.iv2-line-newqty').textContent = num(available + qty);
    }
    function refreshAllLines() { host.querySelectorAll('#iv2Lines tbody tr').forEach(refreshRow); }
    function addLine(itemCode = firstItem.code || '') {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><input class='iv2-line-item' list='iv2ItemList' value='${esc(itemCode)}' placeholder='Type item ID'></td><td class='iv2-line-desc'></td><td class='iv2-line-uom'></td><td class='num iv2-line-available'>—</td><td><input class='iv2-line-qty' type='number' step='0.0001' value='${isAdjustment ? '0' : '1'}'></td><td><input class='iv2-line-cost' type='number' min='0' step='0.01' value='0'></td>${isAdjustment ? `<td><select class='iv2-line-reason'>${optionRows(reasons, 'id', row => `${row.id} - ${row.description}`, reasons[0]?.id || '')}</select></td><td class='num iv2-line-newqty'>—</td>` : ''}<td><button type='button' class='iv2-remove'>×</button></td>`;
      host.querySelector('#iv2Lines tbody').appendChild(tr);
      tr.querySelector('.iv2-line-item').oninput = () => refreshRow(tr);
      tr.querySelector('.iv2-line-qty').oninput = () => recalcAdjustment(tr);
      tr.querySelector('.iv2-line-cost').oninput = event => event.target.dataset.touched = '1';
      tr.querySelector('.iv2-remove').onclick = () => tr.remove();
      refreshRow(tr);
    }
    host.querySelector('#iv2AddLine').onclick = () => addLine('');
    addLine(firstItem.code || '');

    function buildPayload() {
      const lines = [...host.querySelectorAll('#iv2Lines tbody tr')].map(tr => {
        const item = selectedItem(tr.querySelector('.iv2-line-item'));
        const rawQty = Number(tr.querySelector('.iv2-line-qty').value || 0);
        return {
          inventoryId: item?.code || '', itemId: item?.code || '', description: item?.description || item?.name || '',
          warehouse: wh.value, location: loc.value, quantity: isAdjustment ? Math.abs(rawQty) : rawQty,
          adjustmentQty: isAdjustment ? rawQty : undefined, unitCost: Number(tr.querySelector('.iv2-line-cost').value || 0),
          reasonCode: isAdjustment ? tr.querySelector('.iv2-line-reason')?.value : undefined
        };
      });
      return {
        documentType: type, date: host.querySelector('#iv2DocDate').value, postDate: host.querySelector('#iv2DocDate').value,
        sourceReference: host.querySelector('#iv2SourceRef').value.trim(), description: host.querySelector('#iv2DocDesc').value.trim() || `${type} ${today()}`,
        warehouse: wh.value, location: loc.value, fromWarehouse: isTransfer ? wh.value : undefined, fromLocation: isTransfer ? loc.value : undefined,
        toWarehouse: isTransfer ? toWh.value : undefined, toLocation: isTransfer ? toLoc.value : undefined, lines
      };
    }
    async function save(post) {
      const data = buildPayload();
      if (!data.lines.length || data.lines.some(line => !line.inventoryId)) return notify('Inventory item required', 'Every line needs a valid inventory item.', true);
      if (isAdjustment && data.lines.some(line => Number(line.adjustmentQty || 0) === 0)) return notify('Adjustment quantity required', 'Adjustment quantity cannot be zero.', true);
      if (!isAdjustment && data.lines.some(line => Number(line.quantity || 0) <= 0)) return notify('Quantity required', 'Quantity must be greater than zero.', true);
      if (type === 'Issue' && data.lines.some(line => findBalance(summary, line.inventoryId, wh.value, loc.value) < Number(line.quantity || 0))) return notify('Insufficient inventory', 'One or more issue quantities exceed available inventory.', true);
      if (isTransfer && data.fromWarehouse === data.toWarehouse && data.fromLocation === data.toLocation) return notify('Destination required', 'Choose a different destination warehouse or location.', true);
      try {
        const saved = await api('/api/inventory/documents', { method: 'POST', body: JSON.stringify(data) });
        if (post) await api('/api/inventory/documents/post', { method: 'POST', body: JSON.stringify({ referenceNumber: saved.referenceNumber }) });
        notify(post ? 'Inventory posted' : 'Inventory saved', `${saved.referenceNumber} ${post ? 'posted' : 'saved'}.`);
        navigate(`/inventory/documents/${encodeURIComponent(saved.referenceNumber)}`);
      } catch (error) { notify(post ? 'Unable to post' : 'Unable to save', error.message, true); }
    }
    host.querySelector('#iv2DocSave').onclick = () => save(false);
    host.querySelector('#iv2DocPost').onclick = () => save(true);
  }

  async function renderPhysicalCount(view) {
    setTitle('New Physical Count');
    const [setup, summary] = await Promise.all([api('/api/inventory/setup'), api('/api/inventory/summary')]);
    const warehouse = setup.warehouses?.find(row => row.active !== false)?.warehouseId || 'MAIN';
    view.innerHTML = root(`
      ${toolbar([{ id: 'iv2CountBack', label: 'Back' }, { id: 'iv2CountSave', label: 'Save Count' }, { id: 'iv2CountPost', label: 'Save & Post Variance', primary: true }])}
      <div class='iv2-page-head compact'><div><h3>New Physical Count</h3><p>Load system stock, enter the actual count, review the variance, and post only the difference.</p></div></div>
      <section class='iv2-card'><div class='iv2-form-grid'><label>Count Date<input id='iv2CountDate' type='date' value='${today()}'></label><label>Warehouse<select id='iv2CountWh'>${optionRows((setup.warehouses || []).filter(row => row.active !== false), 'warehouseId', row => `${row.warehouseId} - ${row.name}`, warehouse)}</select></label><label>Location<select id='iv2CountLoc'><option value=''>All Locations</option>${optionRows(activeLocations(setup, warehouse), 'locationId', row => `${row.locationId} - ${row.description}`, '')}</select></label><label class='span2'>Description<input id='iv2CountDesc' value='Physical count ${today()}'></label></div><div class='iv2-inline'><button id='iv2LoadCount'>Load Stock</button><span id='iv2CountStats'></span></div></section>
      <section class='iv2-card'><div class='iv2-table-wrap'><table class='iv2-table iv2-entry' id='iv2CountTable'><thead><tr><th>Item</th><th>Description</th><th>Location</th><th>System Qty</th><th>Counted Qty</th><th>Variance</th><th>Unit Cost</th><th>Variance Value</th></tr></thead><tbody></tbody></table></div></section>`);
    const host = view.querySelector(`#${ROOT_ID}`);
    const wh = host.querySelector('#iv2CountWh');
    const loc = host.querySelector('#iv2CountLoc');
    host.querySelector('#iv2CountBack').onclick = () => navigate('/inventory/physical-counts');
    function recalc() {
      let entered = 0, varianceQty = 0, varianceValue = 0;
      host.querySelectorAll('tbody tr[data-item]').forEach(tr => {
        const input = tr.querySelector('.iv2-counted');
        const varianceCell = tr.querySelector('.iv2-variance');
        const valueCell = tr.querySelector('.iv2-variance-value');
        if (input.value === '') { varianceCell.textContent = '—'; valueCell.textContent = '—'; return; }
        entered++;
        const variance = Number(input.value || 0) - Number(tr.dataset.systemQty || 0);
        const value = variance * Number(tr.dataset.cost || 0);
        varianceQty += variance; varianceValue += value;
        varianceCell.textContent = num(variance); valueCell.textContent = money(value); tr.classList.toggle('variance', variance !== 0);
      });
      host.querySelector('#iv2CountStats').textContent = `${entered} counted · Qty variance ${num(varianceQty)} · Value variance ${money(varianceValue)}`;
    }
    function load() {
      const rows = summary.filter(row => row.warehouse === wh.value && (!loc.value || row.location === loc.value));
      host.querySelector('tbody').innerHTML = rows.map(row => `<tr data-item='${esc(row.inventoryId)}' data-location='${esc(row.location)}' data-system-qty='${Number(row.qtyOnHand || 0)}' data-cost='${Number(row.averageCost || 0)}'><td><a href='/inventory/items/${encodeURIComponent(row.inventoryId)}'>${esc(row.inventoryId)}</a></td><td>${esc(row.description || '')}</td><td>${esc(row.location || '')}</td><td class='num'>${num(row.qtyOnHand)}</td><td><input class='iv2-counted' type='number' min='0' step='0.0001' placeholder='Enter count'></td><td class='num iv2-variance'>—</td><td class='num'>${money(row.averageCost)}</td><td class='num iv2-variance-value'>—</td></tr>`).join('') || `<tr><td colspan='8' class='empty'>No inventory in this selection.</td></tr>`;
      host.querySelectorAll('.iv2-counted').forEach(input => input.oninput = recalc); recalc();
    }
    wh.onchange = () => { loc.innerHTML = `<option value=''>All Locations</option>${optionRows(activeLocations(setup, wh.value), 'locationId', row => `${row.locationId} - ${row.description}`, '')}`; load(); };
    loc.onchange = load; host.querySelector('#iv2LoadCount').onclick = load; load();
    function payload() {
      const countLines = [...host.querySelectorAll('tbody tr[data-item]')].filter(tr => tr.querySelector('.iv2-counted').value !== '').map(tr => {
        const currentQty = Number(tr.dataset.systemQty || 0), newQty = Number(tr.querySelector('.iv2-counted').value || 0), adjustmentQty = newQty - currentQty;
        return { inventoryId: tr.dataset.item, itemId: tr.dataset.item, warehouse: wh.value, location: tr.dataset.location, currentQty, newQty, adjustmentQty, quantity: Math.abs(adjustmentQty), unitCost: Number(tr.dataset.cost || 0), reasonCode: 'CYCLE' };
      });
      return { documentType: 'Adjustment', inventoryOperation: 'Physical Count', countWarehouse: wh.value, countLocation: loc.value, warehouse: wh.value, location: loc.value, date: host.querySelector('#iv2CountDate').value, postDate: host.querySelector('#iv2CountDate').value, description: host.querySelector('#iv2CountDesc').value.trim() || `Physical count ${today()}`, countLines, lines: countLines };
    }
    async function save(post) {
      const data = payload();
      if (!data.countLines.length) return notify('Count required', 'Enter a counted quantity for at least one item.', true);
      const variance = data.countLines.filter(line => Number(line.adjustmentQty || 0) !== 0);
      try {
        if (post) data.lines = variance;
        const saved = await api('/api/inventory/documents', { method: 'POST', body: JSON.stringify(data) });
        if (post && variance.length) await api('/api/inventory/documents/post', { method: 'POST', body: JSON.stringify({ referenceNumber: saved.referenceNumber }) });
        notify(post && variance.length ? 'Physical count posted' : post ? 'Count verified' : 'Physical count saved', post && !variance.length ? 'No variance existed, so no GL adjustment was posted.' : saved.referenceNumber);
        navigate(`/inventory/documents/${encodeURIComponent(saved.referenceNumber)}`);
      } catch (error) { notify('Unable to save physical count', error.message, true); }
    }
    host.querySelector('#iv2CountSave').onclick = () => save(false); host.querySelector('#iv2CountPost').onclick = () => save(true);
  }

  async function renderDocumentDetail(view, reference) {
    setTitle('Inventory Document');
    const docs = await api('/api/inventory/documents');
    const doc = docs.find(row => (row.referenceNumber || row.id) === reference);
    if (!doc) { view.innerHTML = root(`<section class='iv2-card'><h3>Inventory document not found.</h3></section>`); return; }
    const physical = doc.inventoryOperation === 'Physical Count';
    const canPost = ['Saved', 'Open'].includes(doc.status) && (!physical || (doc.lines || []).some(line => Number(line.adjustmentQty || 0) !== 0));
    const canVoid = doc.status === 'Posted';
    const back = physical ? '/inventory/physical-counts' : DOC_PATHS[doc.documentType] || '/inventory';
    view.innerHTML = root(`
      ${toolbar([{ id: 'iv2DetailBack', label: 'Back' }, ...(canPost ? [{ id: 'iv2DetailPost', label: 'Post', primary: true }] : []), ...(canVoid ? [{ id: 'iv2DetailVoid', label: 'Void', danger: true }] : [])])}
      <div class='iv2-page-head compact'><div><h3>${esc(displayType(doc))} ${esc(doc.referenceNumber)}</h3><p>Status: <strong>${esc(docStatus(doc))}</strong>${doc.jeNumber ? ` · Journal ${esc(doc.jeNumber)}` : ''}</p></div></div>
      <section class='iv2-card'><div class='iv2-form-grid read-only'><label>Date<input readonly value='${esc(doc.postDate || doc.date || '')}'></label><label>Warehouse<input readonly value='${esc(doc.warehouse || doc.fromWarehouse || doc.countWarehouse || '')}'></label><label>Location<input readonly value='${esc(doc.location || doc.fromLocation || doc.countLocation || '')}'></label>${doc.documentType === 'Transfer' ? `<label>To Warehouse<input readonly value='${esc(doc.toWarehouse || '')}'></label><label>To Location<input readonly value='${esc(doc.toLocation || '')}'></label>` : ''}<label class='span2'>Description<input readonly value='${esc(doc.description || '')}'></label></div></section>
      <section class='iv2-card'><h4>${physical ? 'Count Results' : 'Lines'}</h4><div class='iv2-table-wrap'><table class='iv2-table'><thead><tr><th>Item</th><th>Description</th><th>Warehouse</th><th>Location</th>${physical ? '<th>System</th><th>Counted</th><th>Variance</th>' : '<th>Quantity</th><th>Adjustment</th>'}<th>Unit Cost</th><th>Value</th></tr></thead><tbody>${((physical && doc.countLines) || doc.lines || []).map(line => { const qty = physical ? Number(line.adjustmentQty || 0) : Number(line.quantity || Math.abs(line.adjustmentQty || 0) || 0); return `<tr><td>${esc(line.inventoryId || line.itemId || '')}</td><td>${esc(line.description || '')}</td><td>${esc(line.warehouse || doc.warehouse || doc.fromWarehouse || '')}</td><td>${esc(line.location || doc.location || doc.fromLocation || '')}</td>${physical ? `<td class='num'>${num(line.currentQty)}</td><td class='num'>${num(line.newQty)}</td><td class='num'>${num(line.adjustmentQty)}</td>` : `<td class='num'>${num(line.quantity)}</td><td class='num'>${num(line.adjustmentQty)}</td>`}<td class='num'>${money(line.unitCost)}</td><td class='num'>${money(Math.abs(qty) * Number(line.unitCost || 0))}</td></tr>`; }).join('') || `<tr><td colspan='9' class='empty'>No lines.</td></tr>`}</tbody></table></div></section>`);
    const host = view.querySelector(`#${ROOT_ID}`); host.querySelector('#iv2DetailBack').onclick = () => navigate(back);
    if (canPost) host.querySelector('#iv2DetailPost').onclick = async () => { try { await api('/api/inventory/documents/post', { method: 'POST', body: JSON.stringify({ referenceNumber: doc.referenceNumber }) }); notify('Inventory posted', doc.referenceNumber); renderManagedPath(true); } catch (error) { notify('Unable to post', error.message, true); } };
    if (canVoid) host.querySelector('#iv2DetailVoid').onclick = async () => { if (!confirm(`Void ${doc.referenceNumber}?`)) return; try { await api('/api/inventory/documents/void', { method: 'POST', body: JSON.stringify({ referenceNumber: doc.referenceNumber }) }); notify('Inventory voided', doc.referenceNumber); renderManagedPath(true); } catch (error) { notify('Unable to void', error.message, true); } };
  }

  async function renderRelease(view) {
    setTitle('Post Inventory Documents');
    const docs = (await api('/api/inventory/documents')).filter(doc => ['Saved', 'Open'].includes(doc.status) && (doc.inventoryOperation !== 'Physical Count' || (doc.lines || []).some(line => Number(line.adjustmentQty || 0) !== 0)));
    view.innerHTML = root(`<div class='iv2-page-head'><div><h3>Post Inventory Documents</h3><p>Post saved inventory documents in one controlled process.</p></div><button id='iv2PostSelected' class='primary'>Post Selected</button></div><div class='iv2-table-wrap'><table class='iv2-table'><thead><tr><th><input type='checkbox' id='iv2All'></th><th>Type</th><th>Reference</th><th>Date</th><th>Warehouse</th><th>Description</th></tr></thead><tbody>${docs.map(doc => `<tr><td><input type='checkbox' class='iv2-check' value='${esc(doc.referenceNumber)}'></td><td>${esc(displayType(doc))}</td><td><a href='/inventory/documents/${encodeURIComponent(doc.referenceNumber)}'>${esc(doc.referenceNumber)}</a></td><td>${esc(doc.date || '')}</td><td>${esc(doc.warehouse || doc.fromWarehouse || doc.countWarehouse || '')}</td><td>${esc(doc.description || '')}</td></tr>`).join('') || `<tr><td colspan='6' class='empty'>Nothing waiting to post.</td></tr>`}</tbody></table></div>`);
    const host = view.querySelector(`#${ROOT_ID}`); host.querySelector('#iv2All').onchange = event => host.querySelectorAll('.iv2-check').forEach(box => box.checked = event.target.checked);
    host.querySelector('#iv2PostSelected').onclick = async () => { const selected = [...host.querySelectorAll('.iv2-check:checked')].map(box => box.value); if (!selected.length) return notify('Select documents', 'Select at least one document.', true); let posted = 0; const errors = []; for (const referenceNumber of selected) { try { await api('/api/inventory/documents/post', { method: 'POST', body: JSON.stringify({ referenceNumber }) }); posted++; } catch (error) { errors.push(`${referenceNumber}: ${error.message}`); } } notify(errors.length ? 'Posting completed with errors' : 'Inventory posted', `${posted} posted${errors.length ? `; ${errors.length} failed` : ''}`, errors.length > 0); renderManagedPath(true); };
  }

  async function renderSimpleInquiry(view, path) {
    if (path === '/inventory/summary') {
      setTitle('Inventory On Hand'); const rows = await api('/api/inventory/summary');
      view.innerHTML = root(`<div class='iv2-page-head'><div><h3>Inventory On Hand</h3><p>Current quantity and value by item, warehouse, and location.</p></div></div><div class='iv2-table-wrap'><table class='iv2-table'><thead><tr><th>Item</th><th>Description</th><th>Warehouse</th><th>Location</th><th>On Hand</th><th>Available</th><th>Allocated</th><th>Average Cost</th><th>Value</th></tr></thead><tbody>${rows.map(row => `<tr><td><a href='/inventory/items/${encodeURIComponent(row.inventoryId)}'>${esc(row.inventoryId)}</a></td><td>${esc(row.description || '')}</td><td>${esc(row.warehouse)}</td><td>${esc(row.location)}</td><td class='num'>${num(row.qtyOnHand)}</td><td class='num'>${num(row.qtyAvailable)}</td><td class='num'>${num(row.qtyAllocated)}</td><td class='num'>${money(row.averageCost)}</td><td class='num'>${money(row.inventoryValue)}</td></tr>`).join('') || `<tr><td colspan='9' class='empty'>No inventory balances.</td></tr>`}</tbody></table></div>`); return;
    }
    if (path === '/inventory/availability') {
      setTitle('Inventory Availability'); const rows = await api('/api/inventory/availability');
      view.innerHTML = root(`<div class='iv2-page-head'><div><h3>Inventory Availability</h3></div></div><div class='iv2-table-wrap'><table class='iv2-table'><thead><tr><th>Item</th><th>Description</th><th>Warehouse</th><th>Location</th><th>On Hand</th><th>Available</th><th>Allocated</th><th>Backorders</th><th>Incoming</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.inventoryId)}</td><td>${esc(row.description || '')}</td><td>${esc(row.warehouse)}</td><td>${esc(row.location)}</td><td class='num'>${num(row.onHand)}</td><td class='num'>${num(row.available)}</td><td class='num'>${num(row.allocated)}</td><td class='num'>${num(row.backorders)}</td><td class='num'>${num(row.incomingReceipts)}</td></tr>`).join('') || `<tr><td colspan='9' class='empty'>No availability data.</td></tr>`}</tbody></table></div>`); return;
    }
    if (path === '/inventory/transactions') {
      setTitle('Inventory Transaction History'); const rows = await api('/api/inventory/transactions');
      view.innerHTML = root(`<div class='iv2-page-head'><div><h3>Inventory Transaction History</h3></div></div><div class='iv2-table-wrap'><table class='iv2-table'><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Item</th><th>Warehouse</th><th>Location</th><th>Qty In</th><th>Qty Out</th><th>Unit Cost</th><th>Journal</th></tr></thead><tbody>${rows.slice().reverse().map(row => `<tr><td>${esc(row.postDate || '')}</td><td>${esc(row.transactionType || '')}</td><td>${esc(row.referenceNumber || '')}</td><td>${esc(row.itemId || row.inventoryId || '')}</td><td>${esc(row.warehouse || '')}</td><td>${esc(row.location || '')}</td><td class='num'>${num(row.quantityIn)}</td><td class='num'>${num(row.quantityOut)}</td><td class='num'>${money(row.unitCost)}</td><td>${esc(row.jeReference || '')}</td></tr>`).join('') || `<tr><td colspan='10' class='empty'>No inventory transactions.</td></tr>`}</tbody></table></div>`); return;
    }
    if (path === '/inventory/valuation-inquiry') {
      setTitle('Inventory Valuation'); const rows = await api('/api/inventory/valuation'); const total = rows.reduce((s, row) => s + Number(row.totalValue || 0), 0);
      view.innerHTML = root(`<div class='iv2-page-head'><div><h3>Inventory Valuation</h3><p>Total ${money(total)}</p></div></div><div class='iv2-table-wrap'><table class='iv2-table'><thead><tr><th>Item</th><th>Description</th><th>Warehouse</th><th>Account</th><th>Costing</th><th>Quantity</th><th>Unit Cost</th><th>Total Value</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.inventoryId)}</td><td>${esc(row.description || '')}</td><td>${esc(row.warehouse)}</td><td>${esc(row.account)}</td><td>${esc(row.costingMethod)}</td><td class='num'>${num(row.quantity)}</td><td class='num'>${money(row.unitCost)}</td><td class='num'>${money(row.totalValue)}</td></tr>`).join('') || `<tr><td colspan='8' class='empty'>No valuation data.</td></tr>`}</tbody></table></div>`); return;
    }
  }

  async function renderSetupPage(view, path) {
    const setup = await api('/api/inventory/setup');
    if (path === '/inventory/warehouses') {
      setTitle('Warehouses'); const rows = setup.warehouses || [];
      view.innerHTML = root(`<div class='iv2-page-head'><div><h3>Warehouses</h3><p>Warehouse master used by inventory transactions and item-class defaults.</p></div></div><div class='iv2-table-wrap'><table class='iv2-table'><thead><tr><th>Warehouse</th><th>Name</th><th>Branch</th><th>Default Location</th><th>Active</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.warehouseId)}</td><td>${esc(row.name)}</td><td>${esc(row.branch || '')}</td><td>${esc(row.defaultLocation || '')}</td><td>${row.active === false ? 'No' : 'Yes'}</td></tr>`).join('') || `<tr><td colspan='5' class='empty'>No warehouses.</td></tr>`}</tbody></table></div>`); return;
    }
    if (path === '/inventory/locations') {
      setTitle('Locations'); const rows = setup.locations || [];
      view.innerHTML = root(`<div class='iv2-page-head'><div><h3>Locations</h3><p>Inventory bins and operational locations by warehouse.</p></div></div><div class='iv2-table-wrap'><table class='iv2-table'><thead><tr><th>Warehouse</th><th>Location</th><th>Description</th><th>Receivable</th><th>Pickable</th><th>Active</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.warehouse)}</td><td>${esc(row.locationId)}</td><td>${esc(row.description || '')}</td><td>${row.receivable === false ? 'No' : 'Yes'}</td><td>${row.pickable === false ? 'No' : 'Yes'}</td><td>${row.active === false ? 'No' : 'Yes'}</td></tr>`).join('') || `<tr><td colspan='6' class='empty'>No locations.</td></tr>`}</tbody></table></div>`); return;
    }
    if (path === '/inventory/reason-codes') {
      setTitle('Reason Codes'); const rows = setup.reasonCodes || [];
      view.innerHTML = root(`<div class='iv2-page-head'><div><h3>Reason Codes</h3><p>Reason codes control inventory adjustment and count variance classification.</p></div></div><div class='iv2-table-wrap'><table class='iv2-table'><thead><tr><th>Code</th><th>Description</th><th>GL Account</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.id)}</td><td>${esc(row.description || '')}</td><td>${esc(row.account || '')}</td></tr>`).join('') || `<tr><td colspan='3' class='empty'>No reason codes.</td></tr>`}</tbody></table></div>`); return;
    }
  }

  async function renderManagedPath(force = false) {
    const path = location.pathname;
    if (!path.startsWith(INVENTORY_PREFIX) || !isManagedPath(path)) return;
    rebuildSidebar();
    const view = document.getElementById('view'); if (!view) return;
    if (!force && view.dataset.inventoryV2Path === `${path}${location.search}` && view.querySelector(`#${ROOT_ID}`)) return;
    view.dataset.inventoryV2Path = `${path}${location.search}`;
    try {
      if (path === '/inventory') return await renderOverview(view);
      if (path === '/inventory/items') return await renderItems(view);
      if (path === '/inventory/item-classes') return await renderItemClasses(view);
      if (path.startsWith('/inventory/items/')) return await renderItemDetail(view, decodeURIComponent(path.split('/').pop()));
      if (path === '/inventory/physical-counts') return await renderDocumentList(view, 'Physical Count');
      if (path === '/inventory/physical-counts/new') return await renderPhysicalCount(view);
      for (const [type, base] of Object.entries(DOC_PATHS)) {
        if (path === base) return await renderDocumentList(view, type);
        if (path === `${base}/new`) return await renderNewDocument(view, type);
      }
      if (path.startsWith('/inventory/documents/')) return await renderDocumentDetail(view, decodeURIComponent(path.split('/').pop()));
      if (path === '/inventory/release') return await renderRelease(view);
      if (['/inventory/warehouses', '/inventory/locations', '/inventory/reason-codes'].includes(path)) return await renderSetupPage(view, path);
      if (['/inventory/summary', '/inventory/availability', '/inventory/transactions', '/inventory/valuation-inquiry'].includes(path)) return await renderSimpleInquiry(view, path);
    } catch (error) {
      view.innerHTML = root(`<section class='iv2-card error'><h3>Inventory could not load</h3><p>${esc(error.message)}</p><button id='iv2Retry'>Retry</button></section>`);
      view.querySelector('#iv2Retry').onclick = () => renderManagedPath(true);
    }
  }

  let repairTimer = null;
  function repairIfLegacyWon() {
    if (!isManagedPath()) return;
    clearTimeout(repairTimer);
    repairTimer = setTimeout(() => {
      const view = document.getElementById('view');
      if (view && !view.querySelector(`#${ROOT_ID}`)) renderManagedPath(true);
      rebuildSidebar();
    }, 0);
  }

  function start() {
    document.addEventListener('click', event => {
      const anchor = event.target.closest('a[href^="/inventory"]');
      if (!anchor || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const url = new URL(anchor.getAttribute('href'), location.origin);
      if (!isManagedPath(url.pathname)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      navigate(url.pathname + url.search);
    }, true);
    window.addEventListener('popstate', () => setTimeout(() => renderManagedPath(true), 0));
    new MutationObserver(repairIfLegacyWon).observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => renderManagedPath(true), 0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
