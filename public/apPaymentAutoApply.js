(() => {
  'use strict';

  const isNewPayment = () => location.pathname === '/ap/payments/new' || location.pathname === '/ap/payments/__new__';
  const billDetailId = () => {
    const match = location.pathname.match(/^\/ap\/bills\/([^/]+)$/);
    if (!match || ['new', '__new__'].includes(match[1])) return '';
    return decodeURIComponent(match[1]);
  };
  const requestedBillId = () => isNewPayment() ? (new URLSearchParams(location.search).get('billId') || '') : '';
  const moneyNumber = value => {
    const normalized = String(value ?? '').replace(/[^0-9.-]/g, '');
    const number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  };

  async function api(path) {
    const response = await fetch(path, { credentials: 'same-origin' });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
    if (!response.ok) throw new Error(body.error || body.message || text || `Request failed (${response.status})`);
    return body;
  }

  function recalculatePaymentTotal() {
    if (!isNewPayment()) return;
    const paymentAmount = document.getElementById('pAmount');
    if (!paymentAmount) return;

    const total = [...document.querySelectorAll('#docsGrid .pickDoc:checked')].reduce((sum, check) => {
      const amount = document.querySelector(`#docsGrid .amtPaid[data-id="${CSS.escape(check.dataset.id || '')}"]`);
      return sum + Number(amount?.value || 0);
    }, 0);

    const next = total.toFixed(2);
    if (String(paymentAmount.value) !== next) {
      paymentAmount.value = next;
      paymentAmount.dispatchEvent(new Event('input', { bubbles: true }));
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
    if (!billId) return;
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

  // Capture the checkbox change before app.js runs its legacy handler. The legacy
  // handler limits applications to the pre-existing Payment Amount (often $0),
  // which is the opposite of the desired AP workflow. Here, selected bill balances
  // drive both Applied Amount and Payment Amount.
  document.addEventListener('change', event => {
    const target = event.target;

    if (isNewPayment() && target?.matches?.('#docsGrid .pickDoc')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyCheckedBill(target);
      return;
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

  // If a user overrides an Applied Amount manually, keep Payment Amount equal to
  // the sum of the currently checked applications.
  document.addEventListener('input', event => {
    if (!isNewPayment() || !event.target?.matches?.('#docsGrid .amtPaid')) return;
    queueMicrotask(recalculatePaymentTotal);
  }, true);

  let queued = false;
  function scheduleEnhancements() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      ensurePayBillAction();
      hydrateRequestedBill();
    });
  }

  window.addEventListener('popstate', () => setTimeout(scheduleEnhancements, 0));
  new MutationObserver(scheduleEnhancements).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(scheduleEnhancements, 0);
})();
