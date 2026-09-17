(() => {
  'use strict';

  const currentDocumentId = () => {
    if (!location.pathname.startsWith('/ap/bills/')) return '';
    const rawId = location.pathname.split('/').pop() || '';
    if (!rawId || ['new', '__new__'].includes(rawId)) return '';
    return decodeURIComponent(rawId);
  };

  const paymentApprovalInput = () => [...document.querySelectorAll('#view label')]
    .find(label => String(label.textContent || '').trim().startsWith('Payment Approval Status'))
    ?.querySelector('input');

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!response.ok) throw new Error(data.error || data.message || text || `Request failed (${response.status})`);
    return data;
  }

  function removeApprovalButton() {
    document.getElementById('approveApPrepayment')?.remove();
  }

  function mountApprovalButton(documentId, documentData) {
    const approvalStatus = documentData.paymentApprovalStatus || 'Pending Payment Approval';
    const approvalInput = paymentApprovalInput();
    if (approvalInput) approvalInput.value = approvalStatus;

    if (documentData.type !== 'Prepayment' || approvalStatus !== 'Pending Payment Approval' || documentData.posted) {
      removeApprovalButton();
      return;
    }

    const toolbar = document.querySelector('#view .erp-toolbar');
    const postButton = document.getElementById('bPost');
    if (!toolbar || !postButton || document.getElementById('approveApPrepayment')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'approveApPrepayment';
    button.textContent = 'Approve Prepayment';
    button.title = 'Approve this vendor prepayment so it can be posted.';
    button.onclick = async () => {
      if (!confirm('Approve this vendor prepayment for posting?')) return;
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = 'Approving...';
      try {
        await request(`/api/ap/documents/${encodeURIComponent(documentId)}/approval-action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'approve', comments: 'Approved for vendor prepayment posting.' })
        });
        location.reload();
      } catch (error) {
        alert(error.message);
        button.disabled = false;
        button.textContent = originalText;
      }
    };
    toolbar.insertBefore(button, postButton);
  }

  async function restorePrepaymentType() {
    const documentId = currentDocumentId();
    if (!documentId) {
      removeApprovalButton();
      return;
    }

    const select = document.querySelector('#bt');
    if (!select) return;
    if (select.dataset.apTypeRestoringFor === documentId) return;
    if (select.dataset.apTypeRestoredFor === documentId && select.dataset.apApprovalStatus) return;
    select.dataset.apTypeRestoringFor = documentId;

    if (![...select.options].some(option => option.value === 'Prepayment')) {
      const option = document.createElement('option');
      option.value = 'Prepayment';
      option.textContent = 'Prepayment';
      select.appendChild(option);
    }

    try {
      const documentData = await request(`/api/ap/documents/${encodeURIComponent(documentId)}`);
      if (!['Bill', 'Debit Adjustment', 'Credit Adjustment', 'Prepayment'].includes(documentData?.type)) return;
      if (!select.isConnected || currentDocumentId() !== documentId) return;
      select.dataset.apTypeRestoredFor = documentId;
      select.value = documentData.type;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      mountApprovalButton(documentId, documentData);
      select.dataset.apApprovalStatus = documentData.paymentApprovalStatus || 'Pending Payment Approval';
    } catch (error) {
      console.error('Unable to restore AP prepayment workflow', error);
    } finally {
      if (select.isConnected) select.dataset.apTypeRestoringFor = '';
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

  window.addEventListener('popstate', schedule);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
