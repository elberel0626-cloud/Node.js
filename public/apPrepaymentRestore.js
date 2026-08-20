(() => {
  'use strict';

  async function restorePrepaymentType() {
    if (!location.pathname.startsWith('/ap/bills/')) return;
    const rawId = location.pathname.split('/').pop() || '';
    if (!rawId || ['new', '__new__'].includes(rawId)) return;
    const select = document.querySelector('#bt');
    if (!select) return;
    const documentId = decodeURIComponent(rawId);
    if (select.dataset.apTypeRestoredFor === documentId) return;
    select.dataset.apTypeRestoredFor = documentId;

    if (![...select.options].some(option => option.value === 'Prepayment')) {
      const option = document.createElement('option');
      option.value = 'Prepayment';
      option.textContent = 'Prepayment';
      select.appendChild(option);
    }

    try {
      const response = await window.fetch(`/api/ap/documents/${encodeURIComponent(documentId)}`);
      if (!response.ok) return;
      const documentData = await response.json();
      if (!['Bill', 'Debit Adjustment', 'Credit Adjustment', 'Prepayment'].includes(documentData?.type)) return;
      if (!select.isConnected || decodeURIComponent(location.pathname.split('/').pop() || '') !== documentId) return;
      select.value = documentData.type;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    } catch {
      // The base AP screen will display its own API error if the document cannot be loaded.
    }
  }

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      restorePrepaymentType();
    });
  };

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  schedule();
})();