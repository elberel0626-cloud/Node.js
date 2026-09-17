(() => {
  'use strict';

  const RGA_BASES = ['/sales-orders/rga', '/ar/rga', '/inventory/customer-returns'];
  const INVENTORY_RETURNS = '/inventory/customer-returns';
  const isRgaPath = path => RGA_BASES.some(base => path === base || path.startsWith(base + '/'));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const money = value => Number(value || 0).toLocaleString(undefined, { style:'currency', currency:'USD' });

  // rgaWorkflow.js is loaded immediately after this file. Its MutationObserver
  // should continue working on Sales/AR RGA screens, but it must stay dormant
  // while Inventory owns the customer-return receipt screen. Wrapping the first
  // observer created after this guard isolates that legacy observer without
  // interfering with Inventory V2's own observer.
  const NativeMutationObserver = window.MutationObserver;
  let guardedObserverSequence = 0;
  class RgaRouteAwareMutationObserver extends NativeMutationObserver {
    constructor(callback) {
      const sequence = ++guardedObserverSequence;
      super((records, observer) => {
        if (sequence === 1 && location.pathname === INVENTORY_RETURNS) return;
        callback(records, observer);
      });
    }
  }
  window.MutationObserver = RgaRouteAwareMutationObserver;
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (window.MutationObserver === RgaRouteAwareMutationObserver) window.MutationObserver = NativeMutationObserver;
    }, 50);
  }, { once:true });

  async function api(path) {
    const response = await fetch(path, { credentials:'same-origin' });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { error:text }; }
    if (!response.ok) throw new Error(body.error || body.message || text || `Request failed (${response.status})`);
    return body;
  }

  function wakeRgaRenderer(force = false) {
    if (force) document.querySelectorAll('[data-rga-root]').forEach(node => node.removeAttribute('data-rga-root'));
    const body = document.body;
    if (!body) return;
    const marker = document.createElement('span');
    marker.hidden = true;
    marker.dataset.rgaRouteWake = String(Date.now());
    body.appendChild(marker);
    queueMicrotask(() => marker.remove());
  }

  function syncActiveNavigation(path) {
    document.querySelectorAll('#ar-nav a[href]').forEach(link => {
      const href = link.getAttribute('href') || '';
      link.classList.toggle('active', href === path || (isRgaPath(path) && RGA_BASES.some(base => href === base && path.startsWith(base))));
    });
    if (path.startsWith('/inventory')) {
      document.querySelectorAll('#module-nav a').forEach(link => link.classList.toggle('active', link.getAttribute('href') === '/inventory'));
    }
  }

  function ensureInventoryReturnLink() {
    const nav = document.getElementById('ar-nav');
    if (!nav || nav.querySelector(`a[href='${INVENTORY_RETURNS}']`)) return;
    const receipts = nav.querySelector("a[href='/inventory/receipts']");
    if (!receipts) return;
    const link = document.createElement('a');
    link.href = INVENTORY_RETURNS;
    link.textContent = 'Customer Return Receipts';
    link.classList.toggle('active', location.pathname === INVENTORY_RETURNS);
    receipts.insertAdjacentElement('afterend', link);
  }

  async function renderInventoryReturns() {
    if (location.pathname !== INVENTORY_RETURNS) return;
    const view = document.getElementById('view');
    const title = document.getElementById('title');
    if (!view) return;
    ensureInventoryReturnLink();
    syncActiveNavigation(INVENTORY_RETURNS);
    if (title) title.textContent = 'Customer Return Receipts';

    try {
      const rows = await api('/api/rga');
      if (location.pathname !== INVENTORY_RETURNS) return;
      const open = rows.filter(row => ['Awaiting Return','Partially Received'].includes(row.status)).length;
      const received = rows.filter(row => ['Received','Credit Pending','Credited','Closed'].includes(row.status)).length;
      const partial = rows.filter(row => row.status === 'Partially Received').length;
      const returnedQty = rows.reduce((sum, row) => sum + Number(row.receivedQty || 0), 0);

      view.innerHTML = `<div data-rga-root data-inventory-customer-returns='1' class='rga-workspace'>
        <div class='header-row'>
          <div><h3>Customer Return Receipts</h3><p class='rga-muted'>Receive and review products authorized through customer RGA transactions.</p></div>
          <div class='rga-toolbar'><a href='/sales-orders/rga/new'><button type='button'>New RGA</button></a><button type='button' id='inventoryRgaRefresh'>Refresh</button></div>
        </div>
        <div class='rga-kpis'>
          <div class='rga-kpi'>Awaiting Return<b>${open}</b></div>
          <div class='rga-kpi'>Partially Received<b>${partial}</b></div>
          <div class='rga-kpi'>Received / Completed<b>${received}</b></div>
          <div class='rga-kpi'>Total Qty Received<b>${returnedQty}</b></div>
        </div>
        <section class='rga-section rga-table-wrap'>
          <table class='rga-table'><thead><tr><th>RGA</th><th>Status</th><th>Customer</th><th>Original Invoice</th><th>Authorized Qty</th><th>Received Qty</th><th>Remaining Qty</th><th>Expected Credit</th><th>Credit Memo</th><th>Reason</th></tr></thead><tbody>
            ${rows.map(row => {
              const authorized = Number(row.authorizedQty || 0);
              const receivedQty = Number(row.receivedQty || 0);
              return `<tr><td><a href='/sales-orders/rga/${encodeURIComponent(row.id)}'>${esc(row.id)}</a></td><td><span class='rga-status'>${esc(row.status || '')}</span></td><td>${esc(row.customerName || '')}</td><td>${row.invoiceId ? `<a href='/ar/doc/${encodeURIComponent(row.invoiceId)}'>${esc(row.invoiceId)}</a>` : ''}</td><td>${authorized}</td><td>${receivedQty}</td><td>${Math.max(0, authorized - receivedQty)}</td><td>${money(row.totalCredit || 0)}</td><td>${row.creditMemo?.id ? `<a href='/ar/doc/${encodeURIComponent(row.creditMemo.id)}'>${esc(row.creditMemo.id)}</a>` : ''}</td><td>${esc(row.reason || '')}</td></tr>`;
            }).join('') || `<tr><td colspan='10'>No customer returns yet.</td></tr>`}
          </tbody></table>
        </section>
      </div>`;
      const refresh = document.getElementById('inventoryRgaRefresh');
      if (refresh) refresh.onclick = renderInventoryReturns;
    } catch (error) {
      if (location.pathname !== INVENTORY_RETURNS) return;
      view.innerHTML = `<div data-rga-root data-inventory-customer-returns='1' class='rga-note rga-error'><b>Unable to load customer return receipts.</b><br>${esc(error.message)}<br><button type='button' id='inventoryRgaRetry'>Retry</button></div>`;
      const retry = document.getElementById('inventoryRgaRetry');
      if (retry) retry.onclick = renderInventoryReturns;
    }
  }

  function handleRgaNavigation(url) {
    const next = url.pathname + url.search + url.hash;
    if (next !== location.pathname + location.search + location.hash) history.pushState({}, '', next);
    syncActiveNavigation(url.pathname);
    if (url.pathname === INVENTORY_RETURNS) renderInventoryReturns();
    else wakeRgaRenderer(true);
  }

  document.addEventListener('click', event => {
    const link = event.target?.closest?.('a[href]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = link.getAttribute('href') || '';
    if (!href.startsWith('/')) return;
    let url;
    try { url = new URL(href, location.origin); } catch { return; }
    if (url.origin !== location.origin || !isRgaPath(url.pathname)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    handleRgaNavigation(url);
  }, true);

  window.addEventListener('popstate', event => {
    if (!isRgaPath(location.pathname)) return;
    event.stopImmediatePropagation();
    syncActiveNavigation(location.pathname);
    if (location.pathname === INVENTORY_RETURNS) renderInventoryReturns();
    else wakeRgaRenderer(true);
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    ensureInventoryReturnLink();
    if (!isRgaPath(location.pathname)) return;
    syncActiveNavigation(location.pathname);
    if (location.pathname === INVENTORY_RETURNS) {
      renderInventoryReturns();
      // The legacy workflow schedules one startup render before its observer is
      // fully suppressed. Reassert Inventory ownership once after that timer.
      setTimeout(() => {
        if (location.pathname === INVENTORY_RETURNS) renderInventoryReturns();
      }, 40);
    } else {
      wakeRgaRenderer(true);
    }
  });
})();
