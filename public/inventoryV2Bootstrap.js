(() => {
  'use strict';

  const state = window.__inventoryV2Bootstrap = {
    requested: false,
    loaded: false,
    failed: false,
    error: '',
    startedAt: Date.now()
  };

  function loadInventoryV2() {
    if (state.requested) return;
    state.requested = true;
    const script = document.createElement('script');
    script.src = '/inventoryV2.js?v=inventory-v2-20260819-router-fix-1';
    script.async = false;
    script.dataset.inventoryV2Runtime = 'true';
    script.onload = () => {
      state.loaded = true;
      state.loadedAt = Date.now();
      document.dispatchEvent(new CustomEvent('inventory-v2-runtime-loaded'));
    };
    script.onerror = () => {
      state.failed = true;
      state.error = 'inventoryV2.js failed to load';
      console.error('[Inventory V2] runtime script failed to load');
    };
    document.body.appendChild(script);
  }

  const start = () => setTimeout(loadInventoryV2, 0);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
