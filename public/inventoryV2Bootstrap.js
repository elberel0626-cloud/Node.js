(() => {
  'use strict';

  const state = window.__inventoryV2Bootstrap = {
    requested: false,
    loaded: false,
    failed: false,
    error: '',
    startedAt: Date.now()
  };

  function appendScript(src, datasetKey, onload, onerror) {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    if (datasetKey) script.dataset[datasetKey] = 'true';
    script.onload = onload || null;
    script.onerror = onerror || null;
    document.body.appendChild(script);
  }

  function loadInventoryV2Runtime() {
    appendScript(
      '/inventoryV2.js?v=inventory-v2-20260917-customer-returns-native-1',
      'inventoryV2Runtime',
      () => {
        state.loaded = true;
        state.loadedAt = Date.now();
        document.dispatchEvent(new CustomEvent('inventory-v2-runtime-loaded'));
      },
      () => {
        state.failed = true;
        state.error = 'inventoryV2.js failed to load';
        console.error('[Inventory V2] runtime script failed to load');
      }
    );
  }

  function loadInventoryV2() {
    if (state.requested) return;
    state.requested = true;

    // Customer Return Receipts owns /inventory/customer-returns and must register
    // before Inventory V2 so navigation from Issues/Receipts never falls through
    // to the legacy ERP router first.
    appendScript(
      '/inventoryCustomerReturnsNative.js?v=inventory-customer-returns-20260917-1',
      'inventoryCustomerReturnsNative',
      loadInventoryV2Runtime,
      () => {
        console.error('[Inventory V2] customer return route failed to load');
        loadInventoryV2Runtime();
      }
    );
  }

  const start = () => setTimeout(loadInventoryV2, 0);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
