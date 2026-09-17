(() => {
  'use strict';

  const isNewPayment = () => location.pathname === '/ap/payments/new' || location.pathname === '/ap/payments/__new__';
  const isPrepaymentMode = () => isNewPayment() && new URLSearchParams(location.search).get('prepayment') === '1';
  const billDetailId = () => {
    const match = location.pathname.match(/^\/ap\/bills\/([^/]+)$/);
    if (!match || ['new', '__new__'].includes(match[1])) return '';
    return decodeURIComponent(match[1]);
  };
  const paymentDetailId = () => {
    const match = location.pathname.match(/^\/ap\/payments\/([^/]+)$/);
    if (!match || ['new', '__new__'].includes(match[1])) return '';
    return decodeURIComponent(match[1]);
  };
  const requestedBillId = () => isNewPayment() ? (new URLSearchParams(location.search).get('billId') || '') : '';
  const moneyNumber = value => {
    const normalized = String(value ?? '').replace(/[^0-9.-]/g, '');
    const number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  };

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
    if (!response.ok) throw new Error(body.error || body.message || text || `Request failed (${response.status})`);
    return body;
  }

  const rowDocumentType = row => String(row?.children?.[1]?.textContent || '').trim();
  const isCreditRow = row => /credit adjustment|credit memo/i.test(rowDocumentType(row));
  let settingPaymentAmount = false;
  let manualRebalancing = false;

  function selectedApplicationTotals() {
    let positive = 0, credits = 0;
    document.querySelectorAll('#docsGrid .pickDoc:checked').forEach(check => {
      const row = check.closest('tr');
      const amount = Number(row?.querySelector('.amtPaid')?.value || 0);
      if (isCreditRow(row)) credits += amount;
      else positive += amount;
    });
    return { positive, credits, cash: Math.max(0, positive - credits) };
  }

  function recalculatePaymentTotal() {
    if (!isNewPayment() || isPrepaymentMode() || manualRebalancing) return;
    const paymentAmount = document.getElementById('pAmount');
    if (!paymentAmount) return;
    const next = selectedApplicationTotals().cash.toFixed(2);
    if (String(paymentAmount.value) !== next) {
      settingPaymentAmount = true;
      paymentAmount.value = next;
      paymentAmount.dispatchEvent(new Event('input', { bubbles: true }));
      settingPaymentAmount = false;
    }
  }

  function applyCheckedBill(check) {
    const row = check.closest('tr');
    const amount = row?.querySelector('.amtPaid');
    if (!amount) return;
    const openBalance = moneyNumber(row.querySelector('.openBal')?.textContent);
    amount.value = check.checked ? openBalance.toFixed(2) : '0.00';
    amount.dispatchEvent(new Event('input', { bubbles: true }));
    recalculatePaymentTotal();
  }

  // If Payment Amount is manually changed, redistribute the amount across the
  // checked payable documents. Selected vendor credits add to the application
  // capacity because they reduce the cash required to settle the bills.
  function rebalanceApplicationsToPaymentAmount() {
    if (!isNewPayment() || isPrepaymentMode()) return;
    const payment = Math.max(0, Number(document.getElementById('pAmount')?.value || 0));
    const checked = [...document.querySelectorAll('#docsGrid .pickDoc:checked')];
    const creditRows = checked.map(check => check.closest('tr')).filter(isCreditRow);
    const creditAllowance = creditRows.reduce((sum, row) => sum + Number(row?.querySelector('.amtPaid')?.value || 0), 0);
    let remaining = payment + creditAllowance;

    manualRebalancing = true;
    try {
      checked.forEach(check => {
        const row = check.closest('tr');
        const amount = row?.querySelector('.amtPaid');
        if (!amount || isCreditRow(row)) return;
        const openBalance = moneyNumber(row.querySelector('.openBal')?.textContent);
        const applied = Math.min(openBalance, Math.max(0, remaining));
        amount.value = applied.toFixed(2);
        remaining -= applied;
        amount.dispatchEvent(new Event('input', { bubbles: true }));
      });
    } finally {
      manualRebalancing = false;
    }
  }

  function ensurePayBillAction() {
    const id = billDetailId();
    if (!id) return;
    const actions = document.getElementById('bActions');
    if (!actions || actions.querySelector("option[value='pay-bill']")) return;
    const option = document.createElement('option');
    option.value = 'pay-bill';
    option.textContent = 'Pay Bill';
    actions.appendChild(option);
  }

  async function openBillPayment(id) {
    try {
      const bill = await api(`/api/ap/documents/${encodeURIComponent(id)}`);
      if (bill.type !== 'Bill' || !bill.posted || bill.status !== 'Open' || Number(bill.balance || 0) <= 0) {
        alert('Only a posted, open AP Bill with a remaining balance can be paid.');
        return;
      }
      location.assign(`/ap/payments/new?billId=${encodeURIComponent(id)}`);
    } catch (error) {
      alert(error.message);
    }
  }

  function ensureNewPrepaymentButton() {
    if (location.pathname !== '/ap/payments') return;
    const header = document.querySelector('#view .header-row');
    if (!header || document.getElementById('newApPrepayment')) return;
    const paymentLink = header.querySelector("a[href='/ap/payments/new']");
    const link = document.createElement('a');
    link.href = '/ap/payments/new?prepayment=1';
    link.id = 'newApPrepayment';
    link.innerHTML = '<button type="button">New Prepayment</button>';
    if (paymentLink) paymentLink.insertAdjacentElement('afterend', link); else header.appendChild(link);
  }

  async function renderPrepaymentList() {
    if (location.pathname !== '/ap/payments') return;
    const view = document.getElementById('view');
    if (!view || document.getElementById('apPrepaymentList')) return;
    try {
      const rows = await api('/api/ap/documents?type=Prepayment');
      const section = document.createElement('section');
      section.id = 'apPrepaymentList';
      section.className = 'panel';
      section.innerHTML = `<h3>Vendor Prepayments</h3><div class='table-wrap'><table><tr><th>Reference</th><th>Vendor</th><th>Date</th><th>Payment Method</th><th>Amount</th><th>Available Balance</th><th>Approval</th><th>Status</th></tr>${rows.map(row => `<tr><td><a class='link' href='/ap/payments/${encodeURIComponent(row.id)}'>${row.id}</a></td><td>${row.vendorName || ''}</td><td>${row.date || ''}</td><td>${row.method || ''}</td><td>${Number(row.amount || 0).toFixed(2)}</td><td>${Number(row.balance ?? row.unappliedBalance ?? 0).toFixed(2)}</td><td>${row.paymentApprovalStatus || 'Pending Payment Approval'}</td><td>${row.status || ''}</td></tr>`).join('') || '<tr><td colspan="8">No vendor prepayments.</td></tr>'}</table></div>`;
      view.appendChild(section);
    } catch (error) {
      console.error('Unable to load AP prepayments', error);
    }
  }

  async function populatePrepaymentPos() {
    if (!isPrepaymentMode()) return;
    const select = document.getElementById('prepayPo');
    const vendorId = String(document.getElementById('pVendorSearch')?.value || '').trim();
    if (!select) return;
    select.innerHTML = '<option value="">No PO / General Vendor Deposit</option>';
    if (!vendorId) return;
    try {
      const rows = await api('/api/purchase-orders/lookup?vendorNumber=' + encodeURIComponent(vendorId));
      rows.forEach(po => {
        const option = document.createElement('option');
        option.value = po.poId || po.poNumber;
        option.dataset.poNumber = po.poNumber || po.poId || '';
        option.textContent = `${po.poNumber || po.poId} — ${Number(po.total || 0).toFixed(2)} — ${po.status || ''}`;
        select.appendChild(option);
      });
    } catch (error) {
      console.error('Unable to load purchase orders for prepayment', error);
    }
  }

  function configurePrepaymentEntry() {
    if (!isPrepaymentMode()) return;
    const grid = document.querySelector('#view .ap-pay-grid');
    if (!grid || grid.dataset.prepaymentConfigured === '1') return;
    grid.dataset.prepaymentConfigured = '1';
    const title = document.getElementById('title');
    if (title) title.textContent = 'Prepayment <NEW>';
    const typeInput = grid.querySelector('label:first-child input');
    if (typeInput) typeInput.value = 'Prepayment';
    document.querySelector(".erp-tabs [data-tab='docs']")?.closest('.erp-tabs')?.classList.add('hidden');
    document.getElementById('docs')?.classList.add('hidden');
    document.getElementById('hist')?.classList.add('hidden');
    const applied = document.getElementById('pApplied');
    if (applied) applied.value = '0.00';
    const unapplied = document.getElementById('pUnap');
    if (unapplied) unapplied.value = Number(document.getElementById('pAmount')?.value || 0).toFixed(2);
    if (!document.getElementById('prepayPo')) {
      const label = document.createElement('label');
      label.innerHTML = "Purchase Order (optional)<select id='prepayPo'><option value=''>No PO / General Vendor Deposit</option></select>";
      grid.appendChild(label);
    }
    populatePrepaymentPos();
  }

  async function savePrepayment(closeAfter) {
    const vendorId = String(document.getElementById('pVendorSearch')?.value || '').trim();
    const amount = Number(document.getElementById('pAmount')?.value || 0);
    if (!vendorId) return alert('Select a vendor before saving the prepayment.');
    if (!(amount > 0)) return alert('Prepayment amount must be greater than $0.00.');
    const poSelect = document.getElementById('prepayPo');
    const poOption = poSelect?.selectedOptions?.[0];
    const payload = {
      type: 'Prepayment',
      vendorId,
      date: document.getElementById('pDate')?.value,
      method: document.getElementById('pMethod')?.value,
      checkNumber: document.getElementById('pPayRef')?.value || '',
      paymentRef: document.getElementById('pPayRef')?.value || '',
      amount,
      branch: document.getElementById('pBranch')?.value || 'MAIN',
      cashAccount: String(document.getElementById('pCash')?.value || '').split(' - ')[0],
      currency: document.getElementById('pCurr')?.value || 'USD',
      description: document.getElementById('pDesc')?.value || '',
      applications: [],
      sourcePoId: poSelect?.value || '',
      sourcePoNumber: poOption?.dataset?.poNumber || ''
    };
    try {
      const saved = await api('/api/ap/documents', { method: 'POST', body: JSON.stringify(payload) });
      if (closeAfter) location.assign('/ap/payments');
      else location.assign('/ap/payments/' + encodeURIComponent(saved.id));
    } catch (error) {
      alert(error.message);
    }
  }

  let prepaymentDetailLoading = '';
  async function configurePrepaymentDetail() {
    const id = paymentDetailId();
    if (!id || prepaymentDetailLoading === id) return;
    const grid = document.querySelector('#view .ap-pay-grid');
    if (!grid || grid.dataset.prepaymentDetailChecked === id) return;
    prepaymentDetailLoading = id;
    try {
      const doc = await api('/api/ap/documents/' + encodeURIComponent(id));
      grid.dataset.prepaymentDetailChecked = id;
      if (doc.type !== 'Prepayment') return;
      const title = document.getElementById('title');
      if (title) title.textContent = `Prepayment ${doc.id} - ${doc.vendorName || 'Vendor'}`;
      const typeInput = grid.querySelector('label:first-child input');
      if (typeInput) typeInput.value = 'Prepayment';
      document.querySelector(".erp-tabs [data-tab='docs']")?.closest('.erp-tabs')?.classList.add('hidden');
      document.getElementById('docs')?.classList.add('hidden');
      if (!document.getElementById('prepayApprovalStatus')) {
        const label = document.createElement('label');
        label.innerHTML = `Payment Approval Status<input id='prepayApprovalStatus' readonly value='${doc.paymentApprovalStatus || 'Pending Payment Approval'}'>`;
        grid.appendChild(label);
      }
      const toolbar = document.querySelector('#view .erp-toolbar');
      if (toolbar && doc.paymentApprovalStatus === 'Pending Payment Approval' && !document.getElementById('approvePrepayment')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'approvePrepayment';
        button.textContent = 'Approve Prepayment';
        button.addEventListener('click', async () => {
          try {
            await api(`/api/ap/documents/${encodeURIComponent(id)}/approval-action`, { method: 'POST', body: JSON.stringify({ action: 'approve', comments: 'Approved for vendor prepayment.' }) });
            location.reload();
          } catch (error) { alert(error.message); }
        });
        const post = document.getElementById('pPost');
        if (post) toolbar.insertBefore(button, post); else toolbar.appendChild(button);
      }
    } catch (error) {
      console.error('Unable to configure AP prepayment detail', error);
    } finally {
      prepaymentDetailLoading = '';
    }
  }

  const waitFor = async (finder, attempts = 80, delay = 50) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const value = finder();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    return null;
  };

  let hydrating = '';
  let hydrated = '';
  async function hydrateRequestedBill() {
    const billId = requestedBillId();
    if (!billId || isPrepaymentMode()) return;
    const key = `${location.pathname}${location.search}`;
    if (hydrated === key || hydrating === key) return;
    if (!document.getElementById('pVendorNumber') || !document.getElementById('docsGrid')) return;

    hydrating = key;
    try {
      const bill = await api(`/api/ap/documents/${encodeURIComponent(billId)}`);
      if (bill.type !== 'Bill' || !bill.posted || bill.status !== 'Open' || Number(bill.balance || 0) <= 0) {
        hydrated = key;
        alert('This AP Bill is no longer open and payable.');
        return;
      }

      const vendorNumber = document.getElementById('pVendorNumber');
      const vendorSearch = document.getElementById('pVendorSearch');
      if (String(vendorSearch?.value || '') !== String(bill.vendorId || '')) {
        vendorNumber.value = bill.vendorId || '';
        vendorNumber.dispatchEvent(new Event('input', { bubbles: true }));
        const suggestion = await waitFor(() => [...document.querySelectorAll('.party-suggestions:not(.hidden) .erp-lookup-row')]
          .find(row => row.querySelector('.erp-lookup-id')?.textContent?.trim() === String(bill.vendorId || '')));
        if (!suggestion) throw new Error(`Vendor ${bill.vendorId || ''} could not be selected for this payment.`);
        suggestion.click();
      }

      const check = await waitFor(() => document.querySelector(`#docsGrid .pickDoc[data-id="${CSS.escape(billId)}"]`));
      if (!check) throw new Error(`Bill ${billId} is not available in the vendor's open documents.`);
      if (!check.checked) {
        check.checked = true;
        check.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        applyCheckedBill(check);
      }
      hydrated = key;
    } catch (error) {
      hydrated = key;
      console.error('Unable to prepare AP bill payment', error);
      alert(error.message);
    } finally {
      hydrating = '';
    }
  }

  document.addEventListener('change', event => {
    const target = event.target;

    if (isNewPayment() && !isPrepaymentMode() && target?.matches?.('#docsGrid .pickDoc')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyCheckedBill(target);
      return;
    }

    if (isPrepaymentMode() && target?.matches?.('#pVendorNumber,#pVendorName,#pVendorSearch')) {
      setTimeout(populatePrepaymentPos, 0);
    }

    if (target?.id === 'bActions' && target.value === 'pay-bill') {
      const id = billDetailId();
      if (!id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      target.value = '';
      openBillPayment(id);
    }
  }, true);

  document.addEventListener('input', event => {
    if (!isNewPayment()) return;
    if (event.target?.id === 'pAmount') {
      if (isPrepaymentMode()) {
        const unapplied = document.getElementById('pUnap');
        if (unapplied) unapplied.value = Number(event.target.value || 0).toFixed(2);
        return;
      }
      if (!settingPaymentAmount) queueMicrotask(rebalanceApplicationsToPaymentAmount);
      return;
    }
    if (!isPrepaymentMode() && event.target?.matches?.('#docsGrid .amtPaid') && !manualRebalancing) {
      queueMicrotask(recalculatePaymentTotal);
    }
  }, true);

  document.addEventListener('click', event => {
    if (!isPrepaymentMode()) return;
    const button = event.target?.closest?.('#pSave,#pSaveClose');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    savePrepayment(button.id === 'pSaveClose');
  }, true);

  let queued = false;
  function scheduleEnhancements() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      ensurePayBillAction();
      ensureNewPrepaymentButton();
      renderPrepaymentList();
      configurePrepaymentEntry();
      configurePrepaymentDetail();
      hydrateRequestedBill();
    });
  }

  window.addEventListener('popstate', () => setTimeout(scheduleEnhancements, 0));
  new MutationObserver(scheduleEnhancements).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(scheduleEnhancements, 0);
})();
