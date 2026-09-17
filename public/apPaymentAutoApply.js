(() => {
  'use strict';

  const isNewPayment = () => location.pathname === '/ap/payments/new' || location.pathname === '/ap/payments/__new__';
  const moneyNumber = value => {
    const normalized = String(value ?? '').replace(/[^0-9.-]/g, '');
    const number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  };

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

  function bindDocumentRows() {
    if (!isNewPayment()) return;
    const grid = document.getElementById('docsGrid');
    if (!grid) return;

    grid.querySelectorAll('.pickDoc').forEach(check => {
      if (check.dataset.apPaymentAutoApplyBound === '1') return;
      check.dataset.apPaymentAutoApplyBound = '1';
      check.addEventListener('change', () => {
        const row = check.closest('tr');
        const amount = row?.querySelector('.amtPaid');
        if (!amount) return;
        amount.value = check.checked ? moneyNumber(row.querySelector('.openBal')?.textContent).toFixed(2) : '0.00';
        amount.dispatchEvent(new Event('input', { bubbles: true }));
        queueMicrotask(recalculatePaymentTotal);
      });
    });

    grid.querySelectorAll('.amtPaid').forEach(amount => {
      if (amount.dataset.apPaymentAutoTotalBound === '1') return;
      amount.dataset.apPaymentAutoTotalBound = '1';
      amount.addEventListener('input', () => queueMicrotask(recalculatePaymentTotal));
    });
  }

  let queued = false;
  function scheduleBind() {
    if (!isNewPayment() || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      bindDocumentRows();
    });
  }

  document.addEventListener('change', event => {
    if (!isNewPayment()) return;
    if (event.target?.matches?.('#pVendorNumber,#pVendorName')) setTimeout(scheduleBind, 0);
  }, true);

  window.addEventListener('popstate', () => setTimeout(scheduleBind, 0));
  new MutationObserver(scheduleBind).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(scheduleBind, 0);
})();
