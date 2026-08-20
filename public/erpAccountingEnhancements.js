(() => {
  'use strict';

  const INVENTORY_REPORTS = {
    '/inventory/reports/valuation': { title: 'Inventory Valuation', kind: 'valuation' },
    '/inventory/reports/on-hand': { title: 'Inventory On Hand', kind: 'onHand' },
    '/inventory/reports/availability': { title: 'Inventory Availability', kind: 'availability' },
    '/inventory/reports/movement': { title: 'Inventory Movement', kind: 'movement' },
    '/inventory/reports/aging': { title: 'Inventory Aging', kind: 'aging' },
    '/inventory/reports/stock-status': { title: 'Stock Status', kind: 'stockStatus' },
    '/inventory/reports/reorder': { title: 'Reorder Report', kind: 'reorder' },
    '/inventory/reports/gl-reconciliation': { title: 'Inventory to GL Reconciliation', kind: 'glReconciliation' }
  };

  const INVENTORY_GROUPS = [
    ['Overview', [['/inventory', 'Inventory Overview']]],
    ['Enter', [
      ['/inventory/items', 'Inventory Items'],
      ['/inventory/receipts', 'Receipts'],
      ['/inventory/issues', 'Issues'],
      ['/inventory/adjustments', 'Adjustments'],
      ['/inventory/transfers', 'Transfers'],
      ['/inventory/physical-counts', 'Physical Counts']
    ]],
    ['Processes', [
      ['/inventory/release', 'Release Inventory Documents'],
      ['/inventory/prepare-replenishment', 'Prepare Replenishment'],
      ['/inventory/create-purchase-orders', 'Create Purchase Orders'],
      ['/inventory/create-transfer-orders', 'Create Transfer Orders'],
      ['/inventory/allocate', 'Allocate Inventory'],
      ['/inventory/replenishment', 'Replenishment'],
      ['/inventory/valuation-process', 'Inventory Valuation'],
      ['/inventory/update-standard-costs', 'Update Standard Costs']
    ]],
    ['Manage', [
      ['/inventory/warehouses', 'Warehouses'],
      ['/inventory/locations', 'Locations'],
      ['/inventory/item-classes', 'Item Classes'],
      ['/inventory/uom', 'Units of Measure'],
      ['/inventory/reason-codes', 'Reason Codes'],
      ['/inventory/costing-methods', 'Costing Methods']
    ]],
    ['Explore', [
      ['/inventory/summary', 'Inventory Summary'],
      ['/inventory/item-details', 'Item Details'],
      ['/inventory/availability', 'Item Availability'],
      ['/inventory/transactions', 'Inventory Transactions'],
      ['/inventory/lot-serial', 'Lot/Serial History'],
      ['/inventory/valuation-inquiry', 'Inventory Valuation Inquiry']
    ]],
    ['Reports', [
      ['/inventory/reports/valuation', 'Inventory Valuation'],
      ['/inventory/reports/gl-reconciliation', 'Inventory to GL Reconciliation'],
      ['/inventory/reports/on-hand', 'Inventory On Hand'],
      ['/inventory/reports/availability', 'Inventory Availability'],
      ['/inventory/reports/movement', 'Inventory Movement'],
      ['/inventory/reports/aging', 'Inventory Aging'],
      ['/inventory/reports/stock-status', 'Stock Status'],
      ['/inventory/reports/reorder', 'Reorder Report']
    ]]
  ];

  const CONTROLLED_ROUTES = new Set([
    ...Object.keys(INVENTORY_REPORTS),
    '/ap/bills',
    '/ap/cash-purchases',
    '/ap/cash-purchases/new'
  ]);

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const money = value => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  const number = value => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
  const today = () => new Date().toISOString().slice(0, 10);
  const safeKey = value => String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'grid';

  async function api(path, options = {}) {
    const response = await window.fetch(path, options);
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
    if (!response.ok) throw new Error(body.error || body.message || text || `Request failed (${response.status})`);
    return body;
  }

  function setTitle(value) {
    const title = $('#title');
    if (title) title.textContent = value;
  }

  function notify(title, message, error = false) {
    $('#erpAccountingEnhancementToast')?.remove();
    const element = document.createElement('div');
    element.id = 'erpAccountingEnhancementToast';
    element.className = `iv2-toast${error ? ' error' : ''}`;
    element.innerHTML = `<strong>${esc(title)}</strong><span>${esc(message)}</span><button type='button' aria-label='Close'>×</button>`;
    document.body.appendChild(element);
    $('button', element).onclick = () => element.remove();
    setTimeout(() => element.remove(), 5000);
  }

  function moduleForPath() {
    if (location.pathname.startsWith('/inventory')) return 'Inventory';
    if (location.pathname.startsWith('/ap')) return 'AP';
    return 'ERP';
  }

  function gridStorageKey(id) {
    return `erp_accounting_grid_${moduleForPath()}_${safeKey(location.pathname)}_${safeKey(id)}`;
  }

  function defaultGridState(columns) {
    return {
      visible: columns.map(column => column.key),
      filters: {},
      search: '',
      sort: null,
      page: 1
    };
  }

  function readGridState(id, columns) {
    const defaults = defaultGridState(columns);
    try {
      const stored = JSON.parse(localStorage.getItem(gridStorageKey(id)) || 'null');
      if (!stored) return defaults;
      const keys = new Set(columns.map(column => column.key));
      const visible = Array.isArray(stored.visible) ? stored.visible.filter(key => keys.has(key)) : defaults.visible;
      return { ...defaults, ...stored, visible: visible.length ? visible : defaults.visible };
    } catch {
      return defaults;
    }
  }

  function writeGridState(id, state) {
    localStorage.setItem(gridStorageKey(id), JSON.stringify(state));
  }

  function cellText(row, column) {
    if (typeof column.value === 'function') return column.value(row);
    const value = row[column.key];
    if (value && typeof value === 'object' && 'text' in value) return value.text;
    return value ?? '';
  }

  function cellHtml(row, column) {
    if (typeof column.render === 'function') return column.render(row);
    const value = row[column.key];
    if (value && typeof value === 'object' && 'html' in value) return value.html;
    if (column.money) return money(value);
    if (column.number) return number(value);
    return esc(value ?? '');
  }

  function enhancedGridHtml({ id, rows, columns, checkboxSelection = false }) {
    const state = readGridState(id, columns);
    const visible = new Set(state.visible);
    const filterBadge = key => state.filters?.[key] ? `<span class='f-badge'>Filtered</span>` : '';
    return `
      <div class='grid-wrap erp-data-grid erp-accounting-grid' data-enhanced-grid='${esc(id)}'>
        <div class='grid-tools'>
          <input class='grid-search search-input' data-grid-search='${esc(id)}' placeholder='Search all visible columns' value='${esc(state.search || '')}'>
          <button type='button' data-grid-columns='${esc(id)}'>⚙ Customize Columns</button>
          <button type='button' data-grid-reset='${esc(id)}'>Reset</button>
          <button type='button' data-grid-export='${esc(id)}'>Export Visible CSV</button>
        </div>
        <div class='filter-chip-row' data-grid-chips='${esc(id)}'></div>
        <table id='${esc(id)}'>
          <thead><tr>
            ${checkboxSelection ? `<th class='grid-check-col'><input type='checkbox' data-grid-all='${esc(id)}'></th>` : ''}
            ${columns.map(column => `<th data-grid-key='${esc(column.key)}' class='grid-sort' ${visible.has(column.key) ? '' : 'hidden'}>
              <div class='th-wrap'><span>${esc(column.label || column.key)}</span>
                <button type='button' class='grid-dir' data-grid-sort='${esc(column.key)}' data-dir='asc' title='Sort ascending'>▲</button>
                <button type='button' class='grid-dir' data-grid-sort='${esc(column.key)}' data-dir='desc' title='Sort descending'>▼</button>
                <button type='button' class='grid-filter-btn' data-grid-filter='${esc(column.key)}' title='Filter column'>☰${filterBadge(column.key)}</button>
              </div>
            </th>`).join('')}
          </tr></thead>
          <tbody></tbody>
        </table>
        <nav class='grid-pagination' data-grid-pager='${esc(id)}' aria-label='Grid pagination'>
          <button type='button' data-grid-prev='${esc(id)}'>Previous</button>
          <span data-grid-page='${esc(id)}'>Page 1 of 1</span>
          <button type='button' data-grid-next='${esc(id)}'>Next</button>
        </nav>
      </div>`;
  }

  function bindEnhancedGrid({ id, rows, columns, checkboxSelection = false }) {
    const root = $(`[data-enhanced-grid="${CSS.escape(id)}"]`);
    if (!root) return;
    const table = $('table', root);
    const tbody = $('tbody', table);
    let state = readGridState(id, columns);
    const PAGE_SIZE = 20;

    const save = () => writeGridState(id, state);
    const visibleColumns = () => columns.filter(column => state.visible.includes(column.key));

    function matchesFilter(value, filter) {
      const raw = String(value ?? '');
      const lhs = raw.toLowerCase();
      const rhs = String(filter.value ?? '').toLowerCase();
      switch (filter.op) {
        case 'equals': return lhs === rhs;
        case 'not_equals': return lhs !== rhs;
        case 'starts_with': return lhs.startsWith(rhs);
        case 'ends_with': return lhs.endsWith(rhs);
        case 'greater_than': return Number(raw.replace(/[^0-9.-]/g, '')) > Number(filter.value);
        case 'less_than': return Number(raw.replace(/[^0-9.-]/g, '')) < Number(filter.value);
        case 'is_blank': return !raw.trim();
        case 'is_not_blank': return !!raw.trim();
        default: return lhs.includes(rhs);
      }
    }

    function filteredRows() {
      const search = String(state.search || '').trim().toLowerCase();
      let result = rows.map((row, index) => ({ row, index }));
      if (search) {
        result = result.filter(({ row }) => visibleColumns().some(column => String(cellText(row, column)).toLowerCase().includes(search)));
      }
      for (const [key, filter] of Object.entries(state.filters || {})) {
        const column = columns.find(item => item.key === key);
        if (!column) continue;
        result = result.filter(({ row }) => matchesFilter(cellText(row, column), filter));
      }
      if (state.sort?.key) {
        const column = columns.find(item => item.key === state.sort.key);
        if (column) {
          const direction = state.sort.dir === 'desc' ? -1 : 1;
          result.sort((a, b) => String(cellText(a.row, column)).localeCompare(String(cellText(b.row, column)), undefined, { numeric: true }) * direction);
        }
      }
      return result;
    }

    function renderChips() {
      const host = $(`[data-grid-chips="${CSS.escape(id)}"]`, root);
      if (!host) return;
      host.innerHTML = Object.entries(state.filters || {}).map(([key, filter]) => {
        const label = columns.find(column => column.key === key)?.label || key;
        const suffix = ['is_blank', 'is_not_blank'].includes(filter.op) ? '' : ` ${esc(filter.value)}`;
        return `<span class='filter-chip'>${esc(label)} ${esc(filter.op.replaceAll('_', ' '))}${suffix}<button type='button' data-remove-filter='${esc(key)}'>×</button></span>`;
      }).join('');
      $$('[data-remove-filter]', host).forEach(button => {
        button.onclick = () => {
          delete state.filters[button.dataset.removeFilter];
          state.page = 1;
          save();
          render();
        };
      });
    }

    function render() {
      const result = filteredRows();
      const pages = Math.max(1, Math.ceil(result.length / PAGE_SIZE));
      state.page = Math.min(Math.max(1, Number(state.page || 1)), pages);
      const start = (state.page - 1) * PAGE_SIZE;
      const pageRows = result.slice(start, start + PAGE_SIZE);
      const visible = new Set(state.visible);
      $$('th[data-grid-key]', table).forEach(th => th.hidden = !visible.has(th.dataset.gridKey));
      tbody.innerHTML = pageRows.map(({ row, index }) => `<tr data-grid-row='${index}'>
        ${checkboxSelection ? `<td class='grid-check-col'><input type='checkbox' class='grid-row' data-row-index='${index}'></td>` : ''}
        ${columns.map(column => `<td data-grid-key='${esc(column.key)}' class='${column.money || column.number || /(amount|balance|cost|value|qty|quantity|variance)/i.test(column.key) ? 'num' : ''}' ${visible.has(column.key) ? '' : 'hidden'}>${cellHtml(row, column)}</td>`).join('')}
      </tr>`).join('') || `<tr><td colspan='${columns.length + (checkboxSelection ? 1 : 0)}'>No records.</td></tr>`;
      const pageLabel = $(`[data-grid-page="${CSS.escape(id)}"]`, root);
      if (pageLabel) pageLabel.textContent = `Page ${state.page} of ${pages} · ${result.length} records`;
      const prev = $(`[data-grid-prev="${CSS.escape(id)}"]`, root);
      const next = $(`[data-grid-next="${CSS.escape(id)}"]`, root);
      if (prev) prev.disabled = state.page <= 1;
      if (next) next.disabled = state.page >= pages;
      const pager = $(`[data-grid-pager="${CSS.escape(id)}"]`, root);
      if (pager) pager.classList.toggle('hidden', result.length <= PAGE_SIZE);
      renderChips();
    }

    const search = $(`[data-grid-search="${CSS.escape(id)}"]`, root);
    if (search) search.oninput = () => {
      state.search = search.value;
      state.page = 1;
      save();
      render();
    };

    $$('[data-grid-sort]', root).forEach(button => {
      button.onclick = event => {
        event.preventDefault();
        state.sort = { key: button.dataset.gridSort, dir: button.dataset.dir };
        state.page = 1;
        save();
        render();
      };
    });

    $$('[data-grid-filter]', root).forEach(button => {
      button.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        const key = button.dataset.gridFilter;
        const column = columns.find(item => item.key === key);
        const current = state.filters?.[key] || { op: 'contains', value: '' };
        const overlay = document.createElement('div');
        overlay.className = 'cn-overlay';
        overlay.innerHTML = `<div class='cn-modal' style='max-width:460px'>
          <div class='cn-head'><h3>Filter ${esc(column?.label || key)}</h3><p>Apply a filter to this Inventory/AP grid column.</p></div>
          <div class='cn-list'>
            <label>Criteria<select id='enhFilterOp'>
              ${[
                ['contains', 'contains'], ['equals', 'equals'], ['not_equals', 'not equals'],
                ['starts_with', 'starts with'], ['ends_with', 'ends with'],
                ['greater_than', 'greater than'], ['less_than', 'less than'],
                ['is_blank', 'is blank'], ['is_not_blank', 'is not blank']
              ].map(([value, label]) => `<option value='${value}' ${value === current.op ? 'selected' : ''}>${label}</option>`).join('')}
            </select></label>
            <label id='enhFilterValueWrap'>Value<input id='enhFilterValue' value='${esc(current.value || '')}'></label>
          </div>
          <div class='cn-foot'><button id='enhFilterApply'>Apply</button><button id='enhFilterClear'>Remove Filter</button><button id='enhFilterCancel'>Cancel</button></div>
        </div>`;
        document.body.appendChild(overlay);
        const op = $('#enhFilterOp', overlay);
        const wrap = $('#enhFilterValueWrap', overlay);
        const sync = () => wrap.classList.toggle('hidden', ['is_blank', 'is_not_blank'].includes(op.value));
        op.onchange = sync;
        sync();
        $('#enhFilterCancel', overlay).onclick = () => overlay.remove();
        $('#enhFilterClear', overlay).onclick = () => {
          delete state.filters[key];
          state.page = 1;
          save();
          overlay.remove();
          render();
        };
        $('#enhFilterApply', overlay).onclick = () => {
          state.filters[key] = { op: op.value, value: $('#enhFilterValue', overlay).value };
          state.page = 1;
          save();
          overlay.remove();
          render();
        };
      };
    });

    $(`[data-grid-prev="${CSS.escape(id)}"]`, root)?.addEventListener('click', () => {
      state.page = Math.max(1, Number(state.page || 1) - 1);
      save();
      render();
    });
    $(`[data-grid-next="${CSS.escape(id)}"]`, root)?.addEventListener('click', () => {
      state.page = Number(state.page || 1) + 1;
      save();
      render();
    });

    $(`[data-grid-reset="${CSS.escape(id)}"]`, root)?.addEventListener('click', () => {
      state = defaultGridState(columns);
      writeGridState(id, state);
      if (search) search.value = '';
      render();
    });

    $(`[data-grid-columns="${CSS.escape(id)}"]`, root)?.addEventListener('click', () => {
      const overlay = document.createElement('div');
      overlay.className = 'grid-panel-overlay';
      overlay.innerHTML = `<aside class='grid-panel'>
        <div class='cn-head'><h3>⚙ Customize Columns</h3><p>Show or hide fields for this grid. The layout is saved for this screen.</p></div>
        <div class='grid-panel-actions'><button id='enhColumnsSave'>Save Personal Layout</button><button id='enhColumnsReset'>Reset to Default</button><button id='enhColumnsClose'>Close</button></div>
        <div class='cn-filters'><input id='enhColumnsSearch' placeholder='Search available fields'></div>
        <div class='cn-list' id='enhColumnsList'></div>
      </aside>`;
      document.body.appendChild(overlay);
      const renderList = () => {
        const query = ($('#enhColumnsSearch', overlay)?.value || '').toLowerCase();
        $('#enhColumnsList', overlay).innerHTML = columns.filter(column => !query || String(column.label || column.key).toLowerCase().includes(query)).map(column =>
          `<div class='cn-row'><label><input type='checkbox' data-column-visible='${esc(column.key)}' ${state.visible.includes(column.key) ? 'checked' : ''}> ${esc(column.label || column.key)}</label></div>`
        ).join('');
      };
      renderList();
      $('#enhColumnsSearch', overlay).oninput = renderList;
      $('#enhColumnsClose', overlay).onclick = () => overlay.remove();
      $('#enhColumnsReset', overlay).onclick = () => {
        state.visible = columns.map(column => column.key);
        save();
        overlay.remove();
        render();
      };
      $('#enhColumnsSave', overlay).onclick = () => {
        const selected = $$('[data-column-visible]:checked', overlay).map(input => input.dataset.columnVisible);
        if (!selected.length) return notify('At least one column required', 'Select at least one visible column.', true);
        state.visible = selected;
        save();
        overlay.remove();
        render();
      };
    });

    $(`[data-grid-export="${CSS.escape(id)}"]`, root)?.addEventListener('click', () => {
      const visible = visibleColumns();
      const result = filteredRows();
      const lines = [
        visible.map(column => column.label || column.key),
        ...result.map(({ row }) => visible.map(column => cellText(row, column)))
      ].map(values => values.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','));
      const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(blob);
      anchor.download = `${safeKey(location.pathname)}.csv`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
    });

    const all = $(`[data-grid-all="${CSS.escape(id)}"]`, root);
    if (all) all.onchange = () => $$('.grid-row', root).forEach(box => box.checked = all.checked);

    render();
  }

  function inventoryNavItems() {
    return INVENTORY_GROUPS.flatMap(([section, items]) => items.map(([route, label]) => ({ route, label, section })));
  }

  function readInventoryNavPrefs() {
    const items = inventoryNavItems();
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem('nav_pref_Inventory') || 'null'); } catch {}
    if (!Array.isArray(stored)) {
      return items.map((item, index) => ({ ...item, visible: true, order: index, pinned: false }));
    }
    const itemByRoute = new Map(items.map(item => [item.route, item]));
    const retained = stored.filter(pref => itemByRoute.has(pref?.route)).map(pref => ({
      ...pref,
      label: itemByRoute.get(pref.route).label,
      section: itemByRoute.get(pref.route).section
    }));
    const existing = new Set(retained.map(pref => pref.route));
    let order = Math.max(-1, ...retained.map((pref, index) => Number.isFinite(Number(pref.order)) ? Number(pref.order) : index)) + 1;
    for (const item of items) {
      if (!existing.has(item.route)) retained.push({ ...item, visible: true, order: order++, pinned: false });
    }
    return retained;
  }

  function writeInventoryNavPrefs(prefs) {
    localStorage.setItem('nav_pref_Inventory', JSON.stringify(prefs));
  }

  function renderInventorySidebar(force = false) {
    if (!location.pathname.startsWith('/inventory')) return;
    const nav = $('#ar-nav');
    if (!nav) return;
    const marker = $('[data-accounting-enhanced-nav]', nav);
    if (!force && marker?.dataset.path === location.pathname && $('#customizeInventoryNavBtn', nav)) return;
    const prefs = readInventoryNavPrefs();
    const byRoute = new Map(prefs.map(pref => [pref.route, pref]));
    nav.innerHTML = `<span data-inventory-v2-nav data-accounting-enhanced-nav data-path='${esc(location.pathname)}' hidden></span>
      <button id='customizeInventoryNavBtn'>Customize Navigation</button>
      ${INVENTORY_GROUPS.map(([section, items]) => {
        const visible = items
          .filter(([route]) => byRoute.get(route)?.visible !== false)
          .sort((a, b) => (byRoute.get(a[0])?.order ?? 9999) - (byRoute.get(b[0])?.order ?? 9999));
        if (!visible.length) return '';
        return `<div class='nav-group'><div class='nav-group-title'>${esc(section)}</div>${visible.map(([route, label]) =>
          `<a href='${esc(route)}' class='${location.pathname === route ? 'active' : ''}'>${esc(label)}</a>`
        ).join('')}</div>`;
      }).join('')}`;
    $('#customizeInventoryNavBtn', nav).onclick = showInventoryCustomize;
  }

  function showInventoryCustomize() {
    let prefs = readInventoryNavPrefs().sort((a, b) => a.order - b.order);
    const overlay = document.createElement('div');
    overlay.className = 'cn-overlay';
    overlay.innerHTML = `<div class='cn-modal'>
      <div class='cn-head'><h3>Customize Navigation</h3><p>Choose which Inventory functions appear in the left navigation, including accounting reports.</p></div>
      <div class='cn-filters'><input id='inventoryNavSearch' placeholder='Search functions'><select id='inventoryNavSection'><option value=''>All Sections</option>${[...new Set(prefs.map(pref => pref.section))].map(section => `<option>${esc(section)}</option>`).join('')}</select></div>
      <div id='inventoryNavList' class='cn-list'></div>
      <div class='cn-foot'><button id='inventoryNavSave'>Save Changes</button><button id='inventoryNavReset'>Reset to Default</button><button id='inventoryNavCancel'>Cancel</button></div>
    </div>`;
    document.body.appendChild(overlay);
    const render = () => {
      const query = ($('#inventoryNavSearch', overlay)?.value || '').toLowerCase();
      const section = $('#inventoryNavSection', overlay)?.value || '';
      const rows = prefs.filter(pref => (!query || pref.label.toLowerCase().includes(query)) && (!section || pref.section === section));
      $('#inventoryNavList', overlay).innerHTML = rows.map(pref => `<div class='cn-row' draggable='true' data-route='${esc(pref.route)}'>
        <span class='cn-drag'>☰</span><span class='cn-name'>${esc(pref.label)}</span><span class='cn-badge'>${esc(pref.section)}</span>
        <label class='cn-switch'><input type='checkbox' data-nav-visible='${esc(pref.route)}' ${pref.visible ? 'checked' : ''}><span></span></label>
      </div>`).join('');
      let from = '';
      $$('.cn-row', overlay).forEach(row => {
        row.ondragstart = () => { from = row.dataset.route; };
        row.ondragover = event => event.preventDefault();
        row.ondrop = () => {
          const to = row.dataset.route;
          const a = prefs.findIndex(pref => pref.route === from);
          const b = prefs.findIndex(pref => pref.route === to);
          if (a < 0 || b < 0 || a === b) return;
          prefs.splice(b, 0, prefs.splice(a, 1)[0]);
          prefs.forEach((pref, index) => { pref.order = index; });
          render();
        };
      });
      $$('[data-nav-visible]', overlay).forEach(input => input.onchange = () => {
        const pref = prefs.find(item => item.route === input.dataset.navVisible);
        if (pref) pref.visible = input.checked;
      });
    };
    render();
    $('#inventoryNavSearch', overlay).oninput = render;
    $('#inventoryNavSection', overlay).onchange = render;
    $('#inventoryNavCancel', overlay).onclick = () => overlay.remove();
    $('#inventoryNavSave', overlay).onclick = () => {
      writeInventoryNavPrefs(prefs);
      overlay.remove();
      renderInventorySidebar(true);
    };
    $('#inventoryNavReset', overlay).onclick = () => {
      localStorage.removeItem('nav_pref_Inventory');
      overlay.remove();
      renderInventorySidebar(true);
    };
  }

  function sumBy(rows, key) {
    return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
  }

  function aggregateSummaryByItem(summary) {
    const map = new Map();
    for (const row of summary) {
      const key = row.inventoryId;
      const current = map.get(key) || {
        inventoryId: key,
        description: row.description || '',
        qtyOnHand: 0,
        qtyAvailable: 0,
        qtyAllocated: 0,
        inventoryValue: 0
      };
      current.qtyOnHand += Number(row.qtyOnHand || 0);
      current.qtyAvailable += Number(row.qtyAvailable || 0);
      current.qtyAllocated += Number(row.qtyAllocated || 0);
      current.inventoryValue += Number(row.inventoryValue || 0);
      map.set(key, current);
    }
    return map;
  }

  function normalizedTrialBalanceRows(report) {
    if (Array.isArray(report)) return report;
    for (const key of ['rows', 'accounts', 'data', 'details']) {
      if (Array.isArray(report?.[key])) return report[key];
    }
    return [];
  }

  function trialBalanceAccount(row) {
    return String(row.accountNumber ?? row.account ?? row.code ?? row.accountCode ?? '');
  }

  function trialBalanceAmount(row) {
    const direct = row.balance ?? row.endingBalance ?? row.currentBalance ?? row.netBalance;
    if (direct !== undefined && direct !== null && direct !== '') return Number(direct || 0);
    return Number(row.debit ?? row.debits ?? 0) - Number(row.credit ?? row.credits ?? 0);
  }

  async function inventoryReportData(kind) {
    if (kind === 'valuation') {
      const rows = await api('/api/inventory/valuation');
      return {
        rows,
        columns: [
          { key: 'inventoryId', label: 'Inventory ID' },
          { key: 'description', label: 'Description' },
          { key: 'warehouse', label: 'Warehouse' },
          { key: 'account', label: 'Inventory GL Account' },
          { key: 'costingMethod', label: 'Costing Method' },
          { key: 'quantity', label: 'Quantity', number: true },
          { key: 'unitCost', label: 'Unit Cost', money: true },
          { key: 'totalValue', label: 'Total Value', money: true }
        ],
        summary: `Total inventory value ${money(sumBy(rows, 'totalValue'))}`
      };
    }

    if (kind === 'onHand') {
      const rows = await api('/api/inventory/summary');
      return {
        rows,
        columns: [
          { key: 'inventoryId', label: 'Inventory ID' },
          { key: 'description', label: 'Description' },
          { key: 'warehouse', label: 'Warehouse' },
          { key: 'location', label: 'Location' },
          { key: 'qtyOnHand', label: 'On Hand', number: true },
          { key: 'qtyAllocated', label: 'Allocated', number: true },
          { key: 'qtyAvailable', label: 'Available', number: true },
          { key: 'averageCost', label: 'Average Cost', money: true },
          { key: 'inventoryValue', label: 'Inventory Value', money: true },
          { key: 'inventoryAccount', label: 'Inventory GL Account' }
        ],
        summary: `${number(sumBy(rows, 'qtyOnHand'))} units on hand · ${money(sumBy(rows, 'inventoryValue'))}`
      };
    }

    if (kind === 'availability') {
      const rows = await api('/api/inventory/availability');
      return {
        rows,
        columns: [
          { key: 'inventoryId', label: 'Inventory ID' },
          { key: 'description', label: 'Description' },
          { key: 'warehouse', label: 'Warehouse' },
          { key: 'location', label: 'Location' },
          { key: 'onHand', label: 'On Hand', number: true },
          { key: 'allocated', label: 'Allocated', number: true },
          { key: 'available', label: 'Available', number: true },
          { key: 'salesOrders', label: 'Sales Orders', number: true },
          { key: 'backorders', label: 'Backorders', number: true },
          { key: 'incomingReceipts', label: 'Incoming Receipts', number: true }
        ],
        summary: `${number(sumBy(rows, 'available'))} available`
      };
    }

    if (kind === 'movement') {
      const transactions = await api('/api/inventory/transactions');
      const map = new Map();
      for (const tx of transactions) {
        const inventoryId = tx.itemId || tx.inventoryId || '';
        const warehouse = tx.warehouse || '';
        const key = `${inventoryId}|${warehouse}`;
        const row = map.get(key) || {
          inventoryId,
          description: tx.description || '',
          warehouse,
          qtyIn: 0,
          qtyOut: 0,
          netMovement: 0,
          movementValue: 0,
          transactionCount: 0,
          lastMovementDate: ''
        };
        const qtyIn = Number(tx.quantityIn || 0);
        const qtyOut = Number(tx.quantityOut || 0);
        const cost = Number(tx.unitCost || 0);
        row.qtyIn += qtyIn;
        row.qtyOut += qtyOut;
        row.netMovement += qtyIn - qtyOut;
        row.movementValue += (qtyIn + qtyOut) * cost;
        row.transactionCount += 1;
        const date = tx.postDate || tx.date || '';
        if (date > row.lastMovementDate) row.lastMovementDate = date;
        map.set(key, row);
      }
      const rows = [...map.values()];
      return {
        rows,
        columns: [
          { key: 'inventoryId', label: 'Inventory ID' },
          { key: 'description', label: 'Description' },
          { key: 'warehouse', label: 'Warehouse' },
          { key: 'qtyIn', label: 'Qty In', number: true },
          { key: 'qtyOut', label: 'Qty Out', number: true },
          { key: 'netMovement', label: 'Net Movement', number: true },
          { key: 'movementValue', label: 'Gross Movement Value', money: true },
          { key: 'transactionCount', label: 'Transactions', number: true },
          { key: 'lastMovementDate', label: 'Last Movement Date' }
        ],
        summary: `${rows.reduce((sum, row) => sum + row.transactionCount, 0)} inventory transactions`
      };
    }

    if (kind === 'aging') {
      const [summary, transactions] = await Promise.all([api('/api/inventory/summary'), api('/api/inventory/transactions')]);
      const lastMove = new Map();
      for (const tx of transactions) {
        const key = `${tx.itemId || tx.inventoryId || ''}|${tx.warehouse || ''}`;
        const date = tx.postDate || tx.date || '';
        if (!lastMove.get(key) || date > lastMove.get(key)) lastMove.set(key, date);
      }
      const now = Date.now();
      const rows = summary.filter(row => Number(row.qtyOnHand || 0) !== 0).map(row => {
        const date = lastMove.get(`${row.inventoryId}|${row.warehouse}`) || '';
        const daysSinceMovement = date ? Math.max(0, Math.floor((now - Date.parse(date)) / 86400000)) : null;
        const agingBucket = daysSinceMovement === null ? 'No movement history'
          : daysSinceMovement <= 30 ? '0-30 days'
          : daysSinceMovement <= 60 ? '31-60 days'
          : daysSinceMovement <= 90 ? '61-90 days'
          : daysSinceMovement <= 180 ? '91-180 days'
          : daysSinceMovement <= 365 ? '181-365 days'
          : '365+ days';
        return { ...row, lastMovementDate: date || 'No movement history', daysSinceMovement: daysSinceMovement ?? '', agingBucket };
      });
      return {
        rows,
        columns: [
          { key: 'inventoryId', label: 'Inventory ID' },
          { key: 'description', label: 'Description' },
          { key: 'warehouse', label: 'Warehouse' },
          { key: 'location', label: 'Location' },
          { key: 'qtyOnHand', label: 'On Hand', number: true },
          { key: 'inventoryValue', label: 'Inventory Value', money: true },
          { key: 'lastMovementDate', label: 'Last Movement Date' },
          { key: 'daysSinceMovement', label: 'Days Since Movement', number: true },
          { key: 'agingBucket', label: 'Aging Bucket' }
        ],
        summary: `${money(sumBy(rows, 'inventoryValue'))} inventory included in aging`
      };
    }

    if (kind === 'stockStatus' || kind === 'reorder') {
      const [summary, items] = await Promise.all([api('/api/inventory/summary'), api('/api/inventory/items')]);
      const totals = aggregateSummaryByItem(summary);
      const rows = items.map(item => {
        const balance = totals.get(item.code || item.inventoryId) || {};
        const reorderPoint = Number(item.reorderPoint || 0);
        const safetyStock = Number(item.safetyStock || 0);
        const available = Number(balance.qtyAvailable || item.qtyAvailable || 0);
        const target = reorderPoint + safetyStock;
        const suggestedOrderQty = Math.max(0, target - available);
        const stockStatus = available <= 0 ? 'Out of Stock'
          : available <= safetyStock ? 'Below Safety Stock'
          : available <= reorderPoint ? 'At / Below Reorder Point'
          : 'Available';
        return {
          inventoryId: item.code || item.inventoryId,
          description: item.description || item.name || '',
          itemClass: item.itemClass || '',
          preferredVendor: item.preferredVendor || '',
          status: item.status || 'Active',
          qtyOnHand: Number(balance.qtyOnHand || item.qtyOnHand || 0),
          qtyAllocated: Number(balance.qtyAllocated || item.qtyAllocated || 0),
          qtyAvailable: available,
          reorderPoint,
          safetyStock,
          suggestedOrderQty,
          leadTimeDays: Number(item.leadTimeDays || 0),
          stockStatus,
          inventoryValue: Number(balance.inventoryValue || item.inventoryValue || 0)
        };
      }).filter(row => kind === 'stockStatus' || row.suggestedOrderQty > 0);
      return {
        rows,
        columns: [
          { key: 'inventoryId', label: 'Inventory ID' },
          { key: 'description', label: 'Description' },
          { key: 'itemClass', label: 'Item Class' },
          { key: 'preferredVendor', label: 'Preferred Vendor' },
          { key: 'status', label: 'Item Status' },
          { key: 'stockStatus', label: 'Stock Status' },
          { key: 'qtyOnHand', label: 'On Hand', number: true },
          { key: 'qtyAllocated', label: 'Allocated', number: true },
          { key: 'qtyAvailable', label: 'Available', number: true },
          { key: 'reorderPoint', label: 'Reorder Point', number: true },
          { key: 'safetyStock', label: 'Safety Stock', number: true },
          { key: 'suggestedOrderQty', label: 'Suggested Order Qty', number: true },
          { key: 'leadTimeDays', label: 'Lead Time Days', number: true },
          { key: 'inventoryValue', label: 'Inventory Value', money: true }
        ],
        summary: kind === 'reorder' ? `${rows.length} items need replenishment` : `${rows.length} inventory items`
      };
    }

    if (kind === 'glReconciliation') {
      const [valuation, trialBalance] = await Promise.all([api('/api/inventory/valuation'), api('/api/finance/trial-balance')]);
      const valuationByAccount = new Map();
      for (const row of valuation) {
        const account = String(row.account || '');
        valuationByAccount.set(account, (valuationByAccount.get(account) || 0) + Number(row.totalValue || 0));
      }
      const tbByAccount = new Map();
      for (const row of normalizedTrialBalanceRows(trialBalance)) {
        const account = trialBalanceAccount(row);
        if (account) tbByAccount.set(account, trialBalanceAmount(row));
      }
      const accounts = [...new Set([...valuationByAccount.keys(), ...[...tbByAccount.keys()].filter(account => valuationByAccount.has(account))])];
      const rows = accounts.map(account => {
        const inventorySubledgerValue = Number(valuationByAccount.get(account) || 0);
        const glBalance = Number(tbByAccount.get(account) || 0);
        const variance = glBalance - inventorySubledgerValue;
        return {
          account,
          inventorySubledgerValue,
          glBalance,
          variance,
          reconciliationStatus: Math.abs(variance) <= 0.01 ? 'Balanced' : 'Out of Balance'
        };
      });
      return {
        rows,
        columns: [
          { key: 'account', label: 'Inventory GL Account' },
          { key: 'inventorySubledgerValue', label: 'Inventory Subledger', money: true },
          { key: 'glBalance', label: 'GL Balance', money: true },
          { key: 'variance', label: 'Variance (GL - Inventory)', money: true },
          { key: 'reconciliationStatus', label: 'Status' }
        ],
        summary: `Inventory ${money(sumBy(rows, 'inventorySubledgerValue'))} · GL ${money(sumBy(rows, 'glBalance'))} · Variance ${money(sumBy(rows, 'variance'))}`
      };
    }

    return { rows: [], columns: [], summary: '' };
  }

  async function renderInventoryReport(path) {
    const config = INVENTORY_REPORTS[path];
    if (!config) return false;
    const view = $('#view');
    if (!view) return false;
    view.dataset.erpAccountingRoute = path;
    setTitle(config.title);
    renderInventorySidebar(true);
    view.innerHTML = `<div class='iv2-page-head'><div><h3>${esc(config.title)}</h3><p>Accounting-ready Inventory report with the same searchable, sortable, filterable grid behavior used in AR and AP.</p></div></div><section class='iv2-card'><p>Loading report…</p></section>`;
    try {
      const data = await inventoryReportData(config.kind);
      if (location.pathname !== path) return true;
      const id = `inventoryReport_${safeKey(config.kind)}`;
      view.innerHTML = `<div class='iv2-page-head'><div><h3>${esc(config.title)}</h3><p>${esc(data.summary || '')}</p></div></div>
        <section class='iv2-card'>
          ${enhancedGridHtml({ id, rows: data.rows, columns: data.columns })}
        </section>`;
      bindEnhancedGrid({ id, rows: data.rows, columns: data.columns });
    } catch (error) {
      view.innerHTML = `<section class='iv2-card error'><h3>Unable to load ${esc(config.title)}</h3><p>${esc(error.message)}</p><button id='retryInventoryAccountingReport'>Retry</button></section>`;
      $('#retryInventoryAccountingReport', view).onclick = () => renderInventoryReport(path);
    }
    return true;
  }

  function apTypeLabel(type) {
    if (type === 'Credit Adjustment') return 'Credit Memo';
    if (type === 'Debit Adjustment') return 'Debit Memo';
    return type || 'Bill';
  }

  async function renderApDocumentsList() {
    const path = '/ap/bills';
    if (location.pathname !== path) return false;
    const view = $('#view');
    if (!view) return false;
    view.dataset.erpAccountingRoute = path;
    setTitle('Bills, Memos & Prepayments');
    view.innerHTML = `<div class='header-row'><h3>Bills, Credit Memos, Debit Memos & Prepayments</h3><a href='/ap/bills/new'><button>New AP Document</button></a></div><div class='panel'>Loading AP documents…</div>`;
    try {
      const all = await api('/api/ap/documents');
      if (location.pathname !== path) return true;
      const rows = all
        .filter(doc => ['Bill', 'Debit Adjustment', 'Credit Adjustment', 'Prepayment'].includes(doc.type))
        .map(doc => ({
          ...doc,
          displayType: apTypeLabel(doc.type),
          approvalDisplay: doc.type === 'Prepayment' ? (doc.paymentApprovalStatus || doc.approvalStatus || 'Pending Payment Approval') : (doc.approvalStatus || ''),
          journalDisplay: doc.journalEntryNumber || doc.jeNumber || ''
        }));
      const columns = [
        { key: 'id', label: 'Reference Number', render: row => `<a class='link' href='/ap/bills/${encodeURIComponent(row.id)}'>${esc(row.id)}</a>` },
        { key: 'displayType', label: 'Type' },
        { key: 'vendorName', label: 'Vendor', render: row => `<a class='link' href='/ap/bills/${encodeURIComponent(row.id)}'>${esc(row.vendorName || '')}</a>` },
        { key: 'vendorRef', label: 'Vendor Reference' },
        { key: 'date', label: 'Date' },
        { key: 'dueDate', label: 'Due Date' },
        { key: 'status', label: 'Status' },
        { key: 'approvalDisplay', label: 'Approval Status' },
        { key: 'amount', label: 'Amount', money: true },
        { key: 'balance', label: 'Balance', money: true },
        { key: 'journalDisplay', label: 'Journal Entry', render: row => row.journalDisplay ? `<a class='link' href='/finance/journal/${encodeURIComponent(row.journalDisplay)}'>${esc(row.journalDisplay)}</a>` : '' }
      ];
      const id = 'apDocumentsAccountingGrid';
      view.innerHTML = `<div class='header-row'><h3>Bills, Credit Memos, Debit Memos & Prepayments</h3><a href='/ap/bills/new'><button>New AP Document</button></a></div>
        ${enhancedGridHtml({ id, rows, columns })}`;
      bindEnhancedGrid({ id, rows, columns });
    } catch (error) {
      view.innerHTML = `<section class='panel'><h3>Unable to load AP documents</h3><p>${esc(error.message)}</p></section>`;
    }
    return true;
  }

  function base64EncodeUtf8(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function base64DecodeUtf8(value) {
    try {
      const binary = atob(value);
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return '';
    }
  }

  function cashPurchaseMeta(entry) {
    const description = String(entry.description || '');
    const marker = '||META:';
    const index = description.lastIndexOf(marker);
    if (index < 0) return {};
    try { return JSON.parse(base64DecodeUtf8(description.slice(index + marker.length))); } catch { return {}; }
  }

  async function renderCashPurchasesList() {
    if (location.pathname !== '/ap/cash-purchases') return false;
    const view = $('#view');
    if (!view) return false;
    view.dataset.erpAccountingRoute = location.pathname;
    setTitle('Cash Purchases');
    view.innerHTML = `<div class='header-row'><h3>Cash Purchases</h3><a href='/ap/cash-purchases/new'><button>New Cash Purchase</button></a></div><div class='panel'>Loading cash purchases…</div>`;
    try {
      const journals = await api('/api/finance/journal-transactions');
      const rows = journals.filter(journal => String(journal.description || '').startsWith('[AP CASH PURCHASE]')).map(journal => {
        const meta = cashPurchaseMeta(journal);
        const debitLine = (journal.lines || []).find(line => Number(line.debit || 0) > 0) || {};
        const creditLine = (journal.lines || []).find(line => Number(line.credit || 0) > 0) || {};
        return {
          jeNumber: journal.jeNumber,
          date: journal.transactionDate || journal.postDate || '',
          status: journal.status || '',
          vendorId: meta.vendorId || '',
          vendorName: meta.vendorName || '',
          vendorRef: meta.vendorRef || '',
          paymentMethod: meta.paymentMethod || '',
          description: meta.description || '',
          offsetAccount: debitLine.account || '',
          cashAccount: creditLine.account || '',
          amount: Number(debitLine.debit || creditLine.credit || 0)
        };
      }).reverse();
      const columns = [
        { key: 'jeNumber', label: 'Reference / JE', render: row => `<a class='link' href='/finance/journal/${encodeURIComponent(row.jeNumber)}'>${esc(row.jeNumber)}</a>` },
        { key: 'date', label: 'Date' },
        { key: 'vendorId', label: 'Vendor Number' },
        { key: 'vendorName', label: 'Vendor Name' },
        { key: 'vendorRef', label: 'Vendor Reference' },
        { key: 'paymentMethod', label: 'Payment Method' },
        { key: 'description', label: 'Description' },
        { key: 'offsetAccount', label: 'Expense / Asset Account' },
        { key: 'cashAccount', label: 'Cash Account' },
        { key: 'amount', label: 'Amount', money: true },
        { key: 'status', label: 'Status' }
      ];
      const id = 'apCashPurchasesGrid';
      view.innerHTML = `<div class='header-row'><div><h3>Cash Purchases</h3><p>Direct vendor payments that do not require a bill. Posting debits the selected expense/asset account and credits cash.</p></div><a href='/ap/cash-purchases/new'><button>New Cash Purchase</button></a></div>
        ${enhancedGridHtml({ id, rows, columns })}`;
      bindEnhancedGrid({ id, rows, columns });
    } catch (error) {
      view.innerHTML = `<section class='panel'><h3>Unable to load cash purchases</h3><p>${esc(error.message)}</p></section>`;
    }
    return true;
  }

  async function renderCashPurchaseForm() {
    if (location.pathname !== '/ap/cash-purchases/new') return false;
    const view = $('#view');
    if (!view) return false;
    view.dataset.erpAccountingRoute = location.pathname;
    setTitle('New Cash Purchase');
    view.innerHTML = `<section class='panel'><h3>New Cash Purchase</h3><p>Loading vendors and accounts…</p></section>`;
    try {
      const [vendors, chart, branches] = await Promise.all([
        api('/api/ap/vendors'),
        api('/api/finance/chart-of-accounts'),
        api('/api/finance/branches').catch(() => [])
      ]);
      const activeVendors = vendors.filter(vendor => vendor.status !== 'Inactive');
      const activeAccounts = chart.filter(account => account.active !== false && account.allowManualJournalEntry !== false);
      const cashAccounts = activeAccounts.filter(account => /cash|bank|checking|operating account/i.test(`${account.accountNumber || ''} ${account.accountTitle || ''}`));
      const offsetAccounts = activeAccounts.filter(account => !/accounts payable|a\/p control/i.test(`${account.accountNumber || ''} ${account.accountTitle || ''}`));
      const defaultCash = cashAccounts.find(account => String(account.accountNumber) === '1079') || cashAccounts[0] || activeAccounts[0];
      const defaultOffset = offsetAccounts.find(account => /^6/.test(String(account.accountNumber || ''))) || offsetAccounts.find(account => /^5/.test(String(account.accountNumber || ''))) || offsetAccounts[0];
      view.innerHTML = `<div class='erp-toolbar sticky'><button id='cashPurchaseBack'>Back</button><button id='cashPurchaseSave'>Save</button><button id='cashPurchasePost'>Save & Post</button></div>
        <section class='erp-workspace'>
          <div class='header-row'><div><h3>New Cash Purchase</h3><p>Use this when cash/ACH/check/credit card was paid directly and there is no AP bill to apply.</p></div></div>
          <div class='erp-header-grid'>
            <label>Date<input id='cashPurchaseDate' type='date' value='${today()}'></label>
            <label>Vendor<input id='cashPurchaseVendor' list='cashPurchaseVendorList' autocomplete='off' placeholder='Type vendor number or name'><datalist id='cashPurchaseVendorList'>${activeVendors.map(vendor => `<option value='${esc(vendor.id)} — ${esc(vendor.name)}'></option>`).join('')}</datalist></label>
            <label>Vendor Reference<input id='cashPurchaseVendorRef' placeholder='Receipt, confirmation, check #, etc.'></label>
            <label>Payment Method<select id='cashPurchaseMethod'><option>ACH/Wire</option><option>Check</option><option>Credit Card</option><option>Cash</option><option>Other</option></select></label>
            <label>Branch<select id='cashPurchaseBranch'>${(branches.length ? branches : [{ code: '100', name: 'Main' }]).map(branch => `<option value='${esc(branch.code || branch.id || '100')}'>${esc(branch.code || branch.id || '100')} - ${esc(branch.name || branch.description || '')}</option>`).join('')}</select></label>
            <label>Cash Account<input id='cashPurchaseCash' list='cashPurchaseCashList' value='${esc(defaultCash ? `${defaultCash.accountNumber} - ${defaultCash.accountTitle}` : '')}' autocomplete='off'><datalist id='cashPurchaseCashList'>${cashAccounts.map(account => `<option value='${esc(account.accountNumber)} - ${esc(account.accountTitle)}'></option>`).join('')}</datalist></label>
            <label>Expense / Asset Account<input id='cashPurchaseOffset' list='cashPurchaseOffsetList' value='${esc(defaultOffset ? `${defaultOffset.accountNumber} - ${defaultOffset.accountTitle}` : '')}' autocomplete='off'><datalist id='cashPurchaseOffsetList'>${offsetAccounts.map(account => `<option value='${esc(account.accountNumber)} - ${esc(account.accountTitle)}'></option>`).join('')}</datalist></label>
            <label>Amount<input id='cashPurchaseAmount' type='number' min='0.01' step='0.01' value='0.00'></label>
            <label class='span2'>Description<input id='cashPurchaseDescription' placeholder='What was purchased'></label>
          </div>
          <section class='panel'><h4>Accounting</h4><p><b>Debit:</b> selected Expense / Asset account &nbsp; <b>Credit:</b> selected Cash account. No AP liability or bill is created.</p></section>
        </section>`;

      const parseAccount = value => String(value || '').trim().split(/\s+-\s+/)[0].trim();
      const parseVendor = value => {
        const id = String(value || '').split(' — ')[0].trim();
        return activeVendors.find(vendor => vendor.id === id);
      };

      async function save(post) {
        const vendor = parseVendor($('#cashPurchaseVendor').value);
        const amount = Number($('#cashPurchaseAmount').value || 0);
        const cashAccount = parseAccount($('#cashPurchaseCash').value);
        const offsetAccount = parseAccount($('#cashPurchaseOffset').value);
        if (!vendor) return notify('Vendor required', 'Select a valid active vendor.', true);
        if (!(amount > 0)) return notify('Amount required', 'Enter an amount greater than zero.', true);
        if (!activeAccounts.some(account => String(account.accountNumber) === cashAccount)) return notify('Cash account required', 'Select a valid cash account.', true);
        if (!activeAccounts.some(account => String(account.accountNumber) === offsetAccount)) return notify('Expense / asset account required', 'Select a valid expense or asset account.', true);
        if (cashAccount === offsetAccount) return notify('Different accounts required', 'Cash and expense/asset accounts cannot be the same.', true);
        const meta = {
          vendorId: vendor.id,
          vendorName: vendor.name,
          vendorRef: $('#cashPurchaseVendorRef').value.trim(),
          paymentMethod: $('#cashPurchaseMethod').value,
          description: $('#cashPurchaseDescription').value.trim()
        };
        const readable = `[AP CASH PURCHASE] ${vendor.id} - ${vendor.name}${meta.vendorRef ? ` | Ref ${meta.vendorRef}` : ''}${meta.description ? ` | ${meta.description}` : ''}`;
        const description = `${readable} ||META:${base64EncodeUtf8(JSON.stringify(meta))}`;
        const date = $('#cashPurchaseDate').value;
        const branch = $('#cashPurchaseBranch').value || '100';
        try {
          const journal = await api('/api/finance/journal-transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transactionDate: date,
              postDate: date,
              description,
              lines: [
                { account: offsetAccount, debit: amount, credit: 0, branch, lineDescription: `Cash purchase - ${vendor.name} - ${meta.description || meta.vendorRef || 'Direct purchase'}` },
                { account: cashAccount, debit: 0, credit: amount, branch, lineDescription: `Cash purchase payment - ${vendor.name}` }
              ]
            })
          });
          if (post) {
            await api('/api/finance/journal-transactions/post', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jeNumber: journal.jeNumber })
            });
          }
          notify(post ? 'Cash purchase posted' : 'Cash purchase saved', `${journal.jeNumber} was ${post ? 'posted' : 'saved'}.`);
          history.pushState({}, '', '/ap/cash-purchases');
          await renderCashPurchasesList();
        } catch (error) {
          notify('Unable to save cash purchase', error.message, true);
        }
      }

      $('#cashPurchaseBack').onclick = () => {
        history.pushState({}, '', '/ap/cash-purchases');
        renderCashPurchasesList();
      };
      $('#cashPurchaseSave').onclick = () => save(false);
      $('#cashPurchasePost').onclick = () => save(true);
    } catch (error) {
      view.innerHTML = `<section class='panel'><h3>Unable to open Cash Purchase</h3><p>${esc(error.message)}</p></section>`;
    }
    return true;
  }

  function patchApBillForm() {
    if (!location.pathname.startsWith('/ap/bills/')) return;
    const typeSelect = $('#bt');
    if (!typeSelect || typeSelect.dataset.prepaymentEnabled === 'true') return;
    typeSelect.dataset.prepaymentEnabled = 'true';
    const options = [...typeSelect.options];
    const debit = options.find(option => option.value === 'Debit Adjustment' || option.textContent.trim() === 'Debit Adjustment');
    const credit = options.find(option => option.value === 'Credit Adjustment' || option.textContent.trim() === 'Credit Adjustment');
    if (debit) { debit.value = 'Debit Adjustment'; debit.textContent = 'Debit Memo'; }
    if (credit) { credit.value = 'Credit Adjustment'; credit.textContent = 'Credit Memo'; }
    if (!options.some(option => option.value === 'Prepayment')) {
      const option = document.createElement('option');
      option.value = 'Prepayment';
      option.textContent = 'Prepayment';
      typeSelect.appendChild(option);
    }
    const workspace = typeSelect.closest('.erp-workspace');
    if (workspace && !$('#apPrepaymentHelp', workspace)) {
      const help = document.createElement('div');
      help.id = 'apPrepaymentHelp';
      help.className = 'panel hidden';
      help.innerHTML = `<h4>Prepayment</h4><p>Use Prepayment for a vendor deposit/payment made before a bill exists. Posting uses Vendor Deposit (debit) and Cash (credit) and follows the payment approval workflow.</p>`;
      const header = typeSelect.closest('.ap-pay-grid') || typeSelect.closest('.erp-header-grid');
      header?.insertAdjacentElement('afterend', help);
      const sync = () => {
        help.classList.toggle('hidden', typeSelect.value !== 'Prepayment');
        if (typeSelect.value === 'Prepayment') {
          const title = $('#title');
          if (title && /Bill/i.test(title.textContent || '')) title.textContent = title.textContent.replace(/^Bill/i, 'Prepayment');
        }
      };
      typeSelect.addEventListener('change', sync);
      sync();
    }
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function patchedFetch(input, init = {}) {
    const response = await originalFetch(input, init);
    try {
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
      if (
        method === 'GET' &&
        /^\/api\/ap\/documents\/[^/]+\/attachments$/.test(url.pathname) &&
        response.status === 404
      ) {
        const clone = response.clone();
        const payload = await clone.json().catch(() => ({}));
        if (/AP Bill not found/i.test(payload.error || '')) {
          return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }
    } catch {}
    return response;
  };

  function upgradeInventoryTables() {
    if (!location.pathname.startsWith('/inventory') || INVENTORY_REPORTS[location.pathname]) return;
    const root = $('#inventoryV2Root');
    if (!root) return;
    $$('.iv2-table-wrap', root).forEach((wrap, index) => {
      if (wrap.dataset.erpGridUpgraded === 'true') return;
      const table = $('table.iv2-table', wrap);
      if (!table) return;
      if ($('input,select,textarea,button', table)) return;
      const headers = $$('thead th', table);
      if (!headers.length) return;
      const bodyRows = $$('tbody tr', table).filter(row => !row.querySelector('.empty'));
      const columns = headers.map((header, columnIndex) => {
        const key = `column${columnIndex}`;
        return {
          key,
          label: header.textContent.trim() || `Column ${columnIndex + 1}`,
          render: row => row[key]?.html ?? esc(row[key]?.text ?? ''),
          value: row => row[key]?.text ?? ''
        };
      });
      const rows = bodyRows.map(row => {
        const cells = $$('td', row);
        const data = {};
        columns.forEach((column, columnIndex) => {
          const cell = cells[columnIndex];
          data[column.key] = { text: cell?.textContent?.trim() || '', html: cell?.innerHTML || '' };
        });
        return data;
      });
      const id = `inventory_${safeKey(location.pathname)}_${index}`;
      wrap.dataset.erpGridUpgraded = 'true';
      wrap.innerHTML = enhancedGridHtml({ id, rows, columns });
      bindEnhancedGrid({ id, rows, columns });
      root.querySelector('.iv2-search')?.classList.add('hidden');
    });
  }

  async function renderControlledRoute() {
    const path = location.pathname;
    if (INVENTORY_REPORTS[path]) return renderInventoryReport(path);
    if (path === '/ap/bills') return renderApDocumentsList();
    if (path === '/ap/cash-purchases') return renderCashPurchasesList();
    if (path === '/ap/cash-purchases/new') return renderCashPurchaseForm();
    return false;
  }

  function navigateControlled(path) {
    history.pushState({}, '', path);
    setTimeout(() => renderControlledRoute(), 0);
  }

  document.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest('a[href]');
    if (!anchor) return;
    let url;
    try { url = new URL(anchor.getAttribute('href'), location.origin); } catch { return; }
    if (url.origin !== location.origin) return;
    if (!CONTROLLED_ROUTES.has(url.pathname)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    navigateControlled(url.pathname + url.search);
  }, true);

  window.addEventListener('popstate', () => {
    setTimeout(async () => {
      if (CONTROLLED_ROUTES.has(location.pathname)) await renderControlledRoute();
      else {
        if (location.pathname.startsWith('/inventory')) {
          renderInventorySidebar(true);
          setTimeout(upgradeInventoryTables, 0);
        }
        patchApBillForm();
      }
    }, 0);
  });

  document.addEventListener('inventory-v2-runtime-loaded', () => {
    setTimeout(() => {
      renderInventorySidebar(true);
      upgradeInventoryTables();
    }, 0);
  });

  let observerQueued = false;
  const observer = new MutationObserver(() => {
    if (observerQueued) return;
    observerQueued = true;
    queueMicrotask(async () => {
      observerQueued = false;
      if (CONTROLLED_ROUTES.has(location.pathname)) {
        const view = $('#view');
        if (view?.dataset.erpAccountingRoute !== location.pathname) await renderControlledRoute();
      }
      if (location.pathname.startsWith('/inventory')) {
        renderInventorySidebar();
        upgradeInventoryTables();
      }
      patchApBillForm();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  setTimeout(async () => {
    if (CONTROLLED_ROUTES.has(location.pathname)) await renderControlledRoute();
    if (location.pathname.startsWith('/inventory')) {
      renderInventorySidebar(true);
      upgradeInventoryTables();
    }
    patchApBillForm();
  }, 0);
})();