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

  // The AP Bill route still references several controls that were removed from
  // the current markup. Returning detached elements for only those missing
  // controls prevents the route from stopping before its real event handlers
  // (including vendor lookup and save actions) are attached.
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

  // The current AP Bill markup uses billDetails, purchaseOrder, billLines and
  // billNotes, while the old click handler still tries to hide obsolete panel
  // IDs. Handle these tabs in capture phase so only the selected panel shows.
  document.addEventListener('click', event => {
    const tab = event.target?.closest?.('.erp-tabs .tab[data-tab]');
    if (!tab || !isApBillRoute()) return;

    const workspace = tab.closest('.erp-workspace');
    if (!workspace || !workspace.querySelector('#billDetails') || !workspace.querySelector('#billLines')) return;

    const panelIds = ['billDetails', 'purchaseOrder', 'billLines', 'billNotes'];
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
