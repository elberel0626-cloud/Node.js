// AP Bill compatibility and repair layer.
// Loaded before app.js so the AP Bill route can finish initializing.

// app.js currently passes this identifier before declaring a local version.
// A global binding prevents the route from throwing ReferenceError, which was
// stopping vendor search, tabs, and the rest of the AP Bill event handlers.
var setVendorActions = function setVendorActions() {
  const vendorId = String(document.querySelector('#bvend')?.value || '').trim();
  const enabled = Boolean(vendorId);
  ['bAddPo', 'bAddReceipt', 'bAddReceiptLine', 'bPoAdd', 'bPoReceiptAdd', 'bPoReceiptLineAdd']
    .forEach(id => {
      const control = document.getElementById(id);
      if (control) control.disabled = !enabled;
    });
};

(() => {
  const isApBillRoute = () => /^\/ap\/(?:bills|approvals)\/[^/]+$/.test(location.pathname);
  const originalQuerySelector = Document.prototype.querySelector;
  const detachedStubs = new Map();
  const stubTags = new Map([
    ['#appGrid', 'div'],
    ['#bApprove', 'button'],
    ['#bReject', 'button'],
    ['#bInfo', 'button'],
    ['#bDelegate', 'button'],
    ['#bReassign', 'button']
  ]);

  Document.prototype.querySelector = function patchedQuerySelector(selector) {
    const match = originalQuerySelector.call(this, selector);
    if (match || this !== document || !isApBillRoute() || !stubTags.has(selector)) {
      return match;
    }

    if (!detachedStubs.has(selector)) {
      const stub = document.createElement(stubTags.get(selector));
      stub.hidden = true;
      stub.setAttribute('aria-hidden', 'true');
      detachedStubs.set(selector, stub);
    }
    return detachedStubs.get(selector);
  };

  function disableBrowserSuggestions(root = document) {
    if (!isApBillRoute()) return;

    root.querySelectorAll?.('.erp-workspace input:not([type="hidden"]), .erp-workspace textarea')
      .forEach((field, index) => {
        field.setAttribute('autocomplete', 'off');
        field.setAttribute('autocorrect', 'off');
        field.setAttribute('autocapitalize', 'off');
        field.setAttribute('spellcheck', 'false');
        field.setAttribute('data-lpignore', 'true');

        // A stable form-history name can cause Chrome/Edge to show old typed
        // values. Use a route-specific non-business name instead.
        if (!field.dataset.originalName) {
          field.dataset.originalName = field.getAttribute('name') || '';
        }
        field.setAttribute('name', `ap_bill_field_${field.id || index}_${Date.now()}`);
      });

    ['bVendorNumber', 'bVendorName'].forEach(id => {
      const field = document.getElementById(id);
      if (!field) return;
      field.setAttribute('autocomplete', 'new-password');
      field.setAttribute('aria-autocomplete', 'list');
    });
  }

  // Observe SPA renders because the AP Bill form is inserted after page load.
  const observer = new MutationObserver(() => {
    if (!isApBillRoute()) return;
    disableBrowserSuggestions();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('focusin', event => {
    if (!isApBillRoute()) return;
    const field = event.target;
    if (field?.matches?.('.erp-workspace input, .erp-workspace textarea')) {
      disableBrowserSuggestions(field.closest('.erp-workspace') || document);
    }
  });

  // Correct AP Bill tab behavior. The current app.js handler still hides old
  // panel IDs instead of the current bill panel IDs.
  document.addEventListener('click', event => {
    const tab = event.target?.closest?.('.erp-tabs .tab[data-tab]');
    if (!tab || !isApBillRoute()) return;

    const workspace = tab.closest('.erp-workspace');
    if (!workspace || !workspace.querySelector('#billDetails') || !workspace.querySelector('#billLines')) return;

    const panelIds = ['billDetails', 'purchaseOrder', 'billLines', 'billNotes', 'billApprovals'];
    const targetId = tab.dataset.tab;
    const target = panelIds.includes(targetId) ? workspace.querySelector(`#${targetId}`) : null;
    if (!target) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    workspace.querySelectorAll('.erp-tabs .tab[data-tab]').forEach(button => {
      button.classList.toggle('active', button === tab);
    });

    panelIds.forEach(id => workspace.querySelector(`#${id}`)?.classList.add('hidden'));
    target.classList.remove('hidden');
  }, true);
})();
