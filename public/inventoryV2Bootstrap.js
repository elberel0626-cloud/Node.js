(() => {
  'use strict';

  const state = window.__inventoryV2Bootstrap = {
    requested: false,
    loaded: false,
    failed: false,
    error: '',
    startedAt: Date.now()
  };

  function normalizeInventoryNavigation() {
    if (!location.pathname.startsWith('/inventory')) return;
    const nav = document.getElementById('ar-nav');
    if (!nav) return;
    const groups = [...nav.querySelectorAll('.nav-group')];
    const manage = groups.find(group => group.querySelector('.nav-group-title')?.textContent.trim() === 'Manage');
    if (!manage) return;
    const inventoryItems = [...nav.querySelectorAll('a[href]')].find(anchor => {
      try { return new URL(anchor.getAttribute('href'), location.origin).pathname === '/inventory/items'; }
      catch { return false; }
    });
    if (!inventoryItems || inventoryItems.closest('.nav-group') === manage) return;
    const title = manage.querySelector('.nav-group-title');
    if (title) title.insertAdjacentElement('afterend', inventoryItems);
    else manage.prepend(inventoryItems);
  }

  function watchInventoryNavigation() {
    normalizeInventoryNavigation();
    const nav = document.getElementById('ar-nav');
    if (!nav || nav.dataset.inventoryV2NavObserver === '1') return;
    nav.dataset.inventoryV2NavObserver = '1';
    const observer = new MutationObserver(() => queueMicrotask(normalizeInventoryNavigation));
    observer.observe(nav, { childList: true, subtree: true });
  }

  function loadInventoryV2() {
    if (state.requested) return;
    state.requested = true;
    const script = document.createElement('script');
    script.src = '/inventoryV2.js?v=inventory-v2-20260821-nav-compat-2';
    script.async = false;
    script.dataset.inventoryV2Runtime = 'true';
    script.onload = () => {
      state.loaded = true;
      state.loadedAt = Date.now();
      watchInventoryNavigation();
      document.dispatchEvent(new CustomEvent('inventory-v2-runtime-loaded'));
    };
    script.onerror = () => {
      state.failed = true;
      state.error = 'inventoryV2.js failed to load';
      console.error('[Inventory V2] runtime script failed to load');
    };
    document.body.appendChild(script);
  }

  const start = () => {
    watchInventoryNavigation();
    setTimeout(loadInventoryV2, 0);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
