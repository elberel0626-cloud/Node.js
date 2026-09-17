(() => {
  'use strict';

  const reviewRoute = () => location.pathname.match(/^\/ap\/incoming-documents\/([^/]+)\/review$/);
  const allowedTypes = new Set(['Bill', 'Credit Adjustment']);
  const documentPromises = new Map();

  async function request(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!response.ok) throw new Error(data.error || data.message || text || `Request failed (${response.status})`);
    return data;
  }

  function currentSelection() {
    const value = document.getElementById('reviewApDocumentType')?.value || 'Bill';
    return allowedTypes.has(value) ? value : 'Bill';
  }

  function updateCreateButton(documentData = {}) {
    const button = document.getElementById('createBill');
    if (!button) return;
    const converted = Boolean(documentData.billId) || ['Converted', 'Posted'].includes(String(documentData.status || ''));
    if (converted) {
      button.disabled = true;
      button.dataset.incomingConverted = '1';
      button.textContent = documentData.billId ? `Already Converted — ${documentData.billId}` : 'Already Converted';
      button.title = 'This incoming document is already linked to an AP document and cannot create another one.';
      return;
    }
    if (button.dataset.processing === '1') return;
    button.disabled = false;
    button.dataset.incomingConverted = '';
    const type = currentSelection();
    button.textContent = type === 'Credit Adjustment' ? 'Create AP Credit Memo' : 'Create AP Bill';
    button.title = type === 'Credit Adjustment' ? 'Create an AP Credit Memo from this reviewed document.' : 'Create an AP Bill from this reviewed document.';
  }

  function getIncomingDocument(documentId) {
    if (!documentPromises.has(documentId)) documentPromises.set(documentId, request(`/api/ap/incoming-documents/${encodeURIComponent(documentId)}`));
    return documentPromises.get(documentId);
  }

  async function enhanceDocumentTypeSelector() {
    const route = reviewRoute();
    if (!route) return;
    const form = document.getElementById('invoiceReviewForm');
    const grid = form?.querySelector('.erp-header-grid');
    if (!form || !grid) return;

    const documentId = decodeURIComponent(route[1]);
    let label = document.getElementById('reviewApDocumentType')?.closest('label');
    if (!label) {
      label = document.createElement('label');
      label.dataset.incomingDocumentType = '1';
      label.innerHTML = "AP Document Type<select id='reviewApDocumentType'><option value='Bill'>Bill</option><option value='Credit Adjustment'>Credit Memo</option></select><small>Select whether this incoming document creates an AP Bill or AP Credit Memo.</small>";
      grid.insertBefore(label, grid.firstChild);
      const select = label.querySelector('#reviewApDocumentType');
      select.addEventListener('change', () => {
        select.dataset.userChanged = '1';
        updateCreateButton({});
        const dirtyMarker = form.querySelector("[data-field='description']") || form.querySelector('[data-field]');
        dirtyMarker?.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    const select = document.getElementById('reviewApDocumentType');
    if (!select || select.dataset.loadedFor === documentId) return;
    select.dataset.loadedFor = documentId;
    try {
      const incoming = await getIncomingDocument(documentId);
      if (!select.isConnected || reviewRoute()?.[1] !== route[1]) return;
      const savedType = allowedTypes.has(incoming?.draftBill?.type) ? incoming.draftBill.type : 'Bill';
      if (select.dataset.userChanged !== '1') select.value = savedType;
      const converted = Boolean(incoming?.billId) || ['Converted', 'Posted'].includes(String(incoming?.status || ''));
      select.disabled = converted;
      if (converted) label.title = 'Document type is locked because this incoming document is already converted.';
      updateCreateButton(incoming);
    } catch (error) {
      console.error('Unable to load incoming AP document type', error);
    }
  }

  const priorFetch = window.fetch.bind(window);
  window.fetch = async (input, options = {}) => {
    try {
      const route = reviewRoute();
      const method = String(options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const url = String(input instanceof Request ? input.url : input || '');
      if (route && method === 'PUT' && url.includes(`/api/ap/incoming-documents/${encodeURIComponent(decodeURIComponent(route[1]))}`) && typeof options.body === 'string') {
        const payload = JSON.parse(options.body);
        payload.draftBill = { ...(payload.draftBill || {}), type: currentSelection() };
        options = { ...options, body: JSON.stringify(payload) };
      }
    } catch (error) {
      console.error('Unable to persist incoming AP document type', error);
    }
    return priorFetch(input, options);
  };

  document.addEventListener('click', async event => {
    const button = event.target.closest('#createBill');
    const route = reviewRoute();
    if (!button || !route) return;
    if (button.dataset.incomingConverted === '1') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    try {
      const documentId = decodeURIComponent(route[1]);
      documentPromises.delete(documentId);
      const incoming = await getIncomingDocument(documentId);
      if (incoming?.billId || ['Converted', 'Posted'].includes(String(incoming?.status || ''))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        updateCreateButton(incoming);
      }
    } catch (error) {
      console.error('Unable to verify incoming document conversion state', error);
    }
  }, true);

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; enhanceDocumentTypeSelector(); });
  };

  window.addEventListener('popstate', schedule);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
