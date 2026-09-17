(() => {
  'use strict';

  const RGA_BASES = ['/sales-orders/rga', '/ar/rga', '/inventory/customer-returns'];
  const isRgaPath = path => RGA_BASES.some(base => path === base || path.startsWith(base + '/'));

  function wakeRgaRenderer() {
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
    const next = url.pathname + url.search + url.hash;
    if (next !== location.pathname + location.search + location.hash) history.pushState({}, '', next);
    syncActiveNavigation(url.pathname);
    wakeRgaRenderer();
  }, true);

  window.addEventListener('popstate', event => {
    if (!isRgaPath(location.pathname)) return;
    event.stopImmediatePropagation();
    syncActiveNavigation(location.pathname);
    wakeRgaRenderer();
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    if (!isRgaPath(location.pathname)) return;
    syncActiveNavigation(location.pathname);
    wakeRgaRenderer();
  });
})();
