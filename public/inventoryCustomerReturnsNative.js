(() => {
  'use strict';

  const ROUTE = '/inventory/customer-returns';
  const ROOT_ID = 'inventoryCustomerReturnsNative';
  let renderSequence = 0;
  let repairTimer = 0;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const money = value => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  const isRoute = () => location.pathname === ROUTE;

  async function api(path) {
    const response = await fetch(path, { credentials: 'same-origin' });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
    if (!response.ok) throw new Error(body.error || body.message || text || `Request failed (${response.status})`);
    return body;
  }

  function ensureSidebarLink() {
    if (!location.pathname.startsWith('/inventory')) return;
    const nav = document.getElementById('ar-nav');
    if (!nav) return;
    let link = nav.querySelector(`a[href='${ROUTE}']`);
    if (!link) {
      const receipts = nav.querySelector("a[href='/inventory/receipts']");
      if (!receipts) return;
      link = document.createElement('a');
      link.href = ROUTE;
      link.textContent = 'Customer Return Receipts';
      receipts.insertAdjacentElement('afterend', link);
    }
    nav.querySelectorAll('a[href]').forEach(anchor => {
      anchor.classList.toggle('active', isRoute() && anchor.getAttribute('href') === ROUTE);
    });
  }

  function syncInventoryModule() {
    if (!isRoute()) return;
    document.querySelectorAll('#module-nav a[href]').forEach(anchor => {
      anchor.classList.toggle('active', anchor.getAttribute('href') === '/inventory');
    });
    const title = document.getElementById('title');
    if (title) title.textContent = 'Customer Return Receipts';
  }

  function navigate(path) {
    if (path === location.pathname + location.search) return;
    history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  async function render(force = false) {
    if (!isRoute()) return;
    ensureSidebarLink();
    syncInventoryModule();
    const view = document.getElementById('view');
    if (!view) return;
    if (!force && view.querySelector(`#${ROOT_ID}`)) return;

    const sequence = ++renderSequence;
    view.dataset.inventoryV2Path = ROUTE;
    view.innerHTML = `<div id='${ROOT_ID}'>
      <div class='iv2-page-head'><div><h3>Customer Return Receipts</h3><p>Receive and review products authorized through customer RGA transactions.</p></div></div>
      <section class='iv2-card'><p>Loading customer returns…</p></section>
    </div>`;

    try {
      const rows = await api('/api/rga');
      if (!isRoute() || sequence !== renderSequence) return;
      const awaiting = rows.filter(row => ['Awaiting Return', 'Partially Received'].includes(row.status)).length;
      const partial = rows.filter(row => row.status === 'Partially Received').length;
      const completed = rows.filter(row => ['Received', 'Credit Pending', 'Credited', 'Closed'].includes(row.status)).length;
      const receivedQty = rows.reduce((sum, row) => sum + Number(row.receivedQty || 0), 0);

      view.innerHTML = `<div id='${ROOT_ID}'>
        <div class='iv2-page-head'><div><h3>Customer Return Receipts</h3><p>Receive and review products authorized through customer RGA transactions.</p></div><div><button type='button' id='iv2NewRga' class='primary'>New RGA</button> <button type='button' id='iv2RefreshReturns'>Refresh</button></div></div>
        <div class='iv2-kpis'>
          <a><strong>${awaiting}</strong><span>Awaiting Return</span></a>
          <a><strong>${partial}</strong><span>Partially Received</span></a>
          <a><strong>${completed}</strong><span>Received / Completed</span></a>
          <a><strong>${receivedQty}</strong><span>Total Qty Received</span></a>
        </div>
        <section class='iv2-card'><h4>Customer Return Receipts</h4><div class='iv2-table-wrap'><table class='iv2-table'>
          <thead><tr><th>RGA</th><th>Status</th><th>Customer</th><th>Original Invoice</th><th>Authorized Qty</th><th>Received Qty</th><th>Remaining Qty</th><th>Expected Credit</th><th>Credit Memo</th><th>Reason</th></tr></thead>
          <tbody>${rows.map(row => {
            const authorized = Number(row.authorizedQty || 0);
            const received = Number(row.receivedQty || 0);
            const memoId = row.creditMemo?.id || '';
            return `<tr>
              <td><a href='/sales-orders/rga/${encodeURIComponent(row.id)}'>${esc(row.id)}</a></td>
              <td>${esc(row.status || '')}</td>
              <td>${esc(row.customerName || '')}</td>
              <td>${row.invoiceId ? `<a href='/ar/doc/${encodeURIComponent(row.invoiceId)}'>${esc(row.invoiceId)}</a>` : ''}</td>
              <td class='num'>${authorized}</td><td class='num'>${received}</td><td class='num'>${Math.max(0, authorized - received)}</td>
              <td class='num'>${money(row.totalCredit || 0)}</td>
              <td>${memoId ? `<a href='/ar/doc/${encodeURIComponent(memoId)}'>${esc(memoId)}</a>` : ''}</td>
              <td>${esc(row.reason || '')}</td>
            </tr>`;
          }).join('') || `<tr><td colspan='10' class='empty'>No customer returns yet.</td></tr>`}</tbody>
        </table></div></section>
      </div>`;

      document.getElementById('iv2NewRga')?.addEventListener('click', () => navigate('/sales-orders/rga/new'));
      document.getElementById('iv2RefreshReturns')?.addEventListener('click', () => render(true));
    } catch (error) {
      if (!isRoute() || sequence !== renderSequence) return;
      view.innerHTML = `<div id='${ROOT_ID}'><section class='iv2-card error'><h3>Customer Return Receipts could not load</h3><p>${esc(error.message)}</p><button type='button' id='iv2RetryReturns'>Retry</button></section></div>`;
      document.getElementById('iv2RetryReturns')?.addEventListener('click', () => render(true));
    }
  }

  function repair() {
    clearTimeout(repairTimer);
    repairTimer = setTimeout(() => {
      ensureSidebarLink();
      if (!isRoute()) return;
      syncInventoryModule();
      const view = document.getElementById('view');
      if (view && !view.querySelector(`#${ROOT_ID}`)) render(true);
    }, 0);
  }

  document.addEventListener('click', event => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    let url;
    try { url = new URL(anchor.getAttribute('href'), location.origin); } catch { return; }
    if (url.origin !== location.origin || url.pathname !== ROUTE) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const next = url.pathname + url.search;
    if (next !== location.pathname + location.search) history.pushState({}, '', next);
    render(true);
  }, true);

  window.addEventListener('popstate', event => {
    if (!isRoute()) return;
    event.stopImmediatePropagation();
    render(true);
  }, true);

  function start() {
    ensureSidebarLink();
    if (isRoute()) render(true);
    new MutationObserver(repair).observe(document.documentElement, { childList: true, subtree: true });
    repair();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
