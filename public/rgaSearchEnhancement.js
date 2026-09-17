(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const money = value => Number(value || 0).toLocaleString(undefined, { style:'currency', currency:'USD' });

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...options, headers, credentials:'same-origin' });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error:text }; }
    if (!response.ok) throw new Error(payload.error || payload.message || text || `Request failed (${response.status})`);
    return payload;
  }

  const customerDisplay = customer => `${customer.id} — ${customer.name}`;
  const invoiceDisplay = invoice => `${invoice.id} — ${invoice.invoiceDate || ''} — ${money(invoice.amount)} — ${invoice.status}`;

  function exactMatch(items, value, display) {
    const needle = String(value || '').trim().toLowerCase();
    if (!needle) return null;
    return items.find(item => String(item.id || '').toLowerCase() === needle || String(item.name || '').toLowerCase() === needle || display(item).toLowerCase() === needle) || null;
  }

  function labelByPrefix(header, prefix) {
    return [...header.querySelectorAll(':scope > label')].find(label => label.textContent.trim().startsWith(prefix));
  }

  function setHeaderValue(header, prefix, value) {
    const input = labelByPrefix(header, prefix)?.querySelector('input');
    if (input) input.value = value;
  }

  function removeOriginalPaidNotice(root) {
    [...root.querySelectorAll('.rga-note.rga-warning')].forEach(note => {
      if (/paid\/closed|open customer credit/i.test(note.textContent || '')) note.remove();
    });
  }

  async function enhanceNewRga() {
    if (location.pathname !== '/sales-orders/rga/new') return;
    const root = $('[data-rga-root]');
    if (!root || root.dataset.customerInvoiceLookup === '1') return;
    const header = $('.rga-header', root);
    const tableSection = $('.rga-table-wrap', root);
    const saveButton = $('#rgaSave', root);
    if (!header || !tableSection || !saveButton) return;
    root.dataset.customerInvoiceLookup = '1';

    const [customers, invoices] = await Promise.all([
      api('/api/ar/customers'),
      api('/api/rga/eligible-invoices')
    ]);

    const params = new URLSearchParams(location.search);
    const requestedInvoiceId = params.get('invoiceId') || '';
    let selectedInvoice = invoices.find(invoice => invoice.id === requestedInvoiceId) || null;
    let selectedCustomer = selectedInvoice ? customers.find(customer => customer.id === selectedInvoice.customerId) || null : null;

    const originalInvoiceLabel = labelByPrefix(header, 'Original Invoice');
    const originalCustomerLabel = labelByPrefix(header, 'Customer');
    if (!originalInvoiceLabel || !originalCustomerLabel) return;

    const customerLabel = document.createElement('label');
    customerLabel.className = 'required';
    customerLabel.innerHTML = `Customer<input id='rgaCustomerLookup' list='rgaCustomerSuggestions' autocomplete='off' placeholder='Type customer number or name'><datalist id='rgaCustomerSuggestions'>${customers.map(customer => `<option value='${esc(customerDisplay(customer))}'></option>`).join('')}</datalist>`;

    const invoiceLabel = document.createElement('label');
    invoiceLabel.className = 'required';
    invoiceLabel.innerHTML = `Original Invoice<input id='rgaInvoiceLookup' list='rgaInvoiceSuggestions' autocomplete='off' placeholder='Select a customer first' disabled><datalist id='rgaInvoiceSuggestions'></datalist>`;

    originalCustomerLabel.replaceWith(customerLabel);
    originalInvoiceLabel.replaceWith(invoiceLabel);
    header.insertBefore(customerLabel, header.firstChild);
    customerLabel.insertAdjacentElement('afterend', invoiceLabel);
    removeOriginalPaidNotice(root);

    const oldSave = saveButton;
    const newSave = oldSave.cloneNode(true);
    oldSave.replaceWith(newSave);

    const customerInput = $('#rgaCustomerLookup', root);
    const invoiceInput = $('#rgaInvoiceLookup', root);
    const invoiceSuggestions = $('#rgaInvoiceSuggestions', root);
    const estimate = $('#rgaEstimate', root);
    const tbody = tableSection.querySelector('tbody');

    const invoicesForCustomer = () => selectedCustomer ? invoices.filter(invoice => invoice.customerId === selectedCustomer.id) : [];

    const updateInvoiceSuggestions = () => {
      const filtered = invoicesForCustomer();
      invoiceSuggestions.innerHTML = filtered.map(invoice => `<option value='${esc(invoiceDisplay(invoice))}'></option>`).join('');
      invoiceInput.disabled = !selectedCustomer;
      invoiceInput.placeholder = selectedCustomer ? 'Type invoice number, date, amount, or status' : 'Select a customer first';
    };

    const renderLines = () => {
      const lines = selectedInvoice?.returnableLines || [];
      setHeaderValue(header, 'Invoice Status', selectedInvoice?.status || '');
      setHeaderValue(header, 'Current Invoice Balance', selectedInvoice ? money(selectedInvoice.balance) : money(0));

      let notice = $('#rgaCustomerInvoiceNotice', root);
      if (!notice) {
        notice = document.createElement('div');
        notice.id = 'rgaCustomerInvoiceNotice';
        tableSection.insertAdjacentElement('beforebegin', notice);
      }
      if (!selectedInvoice) {
        notice.className = 'rga-note';
        notice.textContent = selectedCustomer ? 'Select an invoice for this customer.' : 'Select a customer first, then choose one of that customer’s sales invoices.';
      } else if (selectedInvoice.paid) {
        notice.className = 'rga-note rga-warning';
        notice.textContent = 'This invoice is fully paid/closed. The return is still allowed. After receipt, the credit memo will remain as an open customer credit unless it is refunded or applied to another invoice.';
      } else {
        notice.className = 'rga-note rga-success';
        notice.textContent = `Selected invoice ${selectedInvoice.id}. Current balance: ${money(selectedInvoice.balance)}.`;
      }

      tbody.innerHTML = selectedInvoice ? lines.map(line => `<tr data-line='${line.invoiceLineIndex}'><td>${esc(line.itemCode)}</td><td>${esc(line.description)}</td><td>${line.invoiceQty}</td><td>${line.alreadyReturnedQty}</td><td>${line.availableToReturnQty}</td><td><input class='rga-return-qty' type='number' min='0' max='${line.availableToReturnQty}' step='0.01' value='0' ${Number(line.availableToReturnQty) <= 0 ? 'disabled' : ''}></td><td>${money(line.unitPrice)}</td><td class='rga-line-credit'>${money(0)}</td></tr>`).join('') : `<tr><td colspan='8'>${selectedCustomer ? 'Select an invoice to load invoice lines.' : 'Select a customer to begin.'}</td></tr>`;

      if (estimate) estimate.textContent = money(0);
      newSave.disabled = !selectedInvoice || !lines.some(line => Number(line.availableToReturnQty || 0) > 0);

      const recalc = () => {
        let total = 0;
        root.querySelectorAll('tr[data-line]').forEach(row => {
          const line = lines.find(candidate => String(candidate.invoiceLineIndex) === row.dataset.line);
          const qty = Number(row.querySelector('.rga-return-qty')?.value || 0);
          const gross = qty * Number(line?.unitPrice || 0);
          const discount = gross * Number(line?.discountPct || 0) / 100;
          const tax = qty * Number(line?.taxPerUnit || 0);
          const credit = gross - discount + tax;
          total += credit;
          const cell = row.querySelector('.rga-line-credit');
          if (cell) cell.textContent = money(credit);
        });
        if (estimate) estimate.textContent = money(total);
      };
      root.querySelectorAll('.rga-return-qty').forEach(input => input.addEventListener('input', recalc));
    };

    const selectCustomer = customer => {
      selectedCustomer = customer;
      selectedInvoice = selectedInvoice?.customerId === customer?.id ? selectedInvoice : null;
      customerInput.value = customer ? customerDisplay(customer) : '';
      invoiceInput.value = selectedInvoice ? invoiceDisplay(selectedInvoice) : '';
      updateInvoiceSuggestions();
      renderLines();
    };

    const selectInvoice = invoice => {
      selectedInvoice = invoice;
      if (invoice && (!selectedCustomer || selectedCustomer.id !== invoice.customerId)) {
        selectedCustomer = customers.find(customer => customer.id === invoice.customerId) || null;
        customerInput.value = selectedCustomer ? customerDisplay(selectedCustomer) : '';
        updateInvoiceSuggestions();
      }
      invoiceInput.value = invoice ? invoiceDisplay(invoice) : '';
      renderLines();
    };

    customerInput.addEventListener('input', () => {
      const customer = exactMatch(customers, customerInput.value, customerDisplay);
      if (customer) return selectCustomer(customer);
      selectedCustomer = null;
      selectedInvoice = null;
      invoiceInput.value = '';
      updateInvoiceSuggestions();
      renderLines();
    });
    customerInput.addEventListener('change', () => {
      const customer = exactMatch(customers, customerInput.value, customerDisplay);
      selectCustomer(customer);
    });

    invoiceInput.addEventListener('input', () => {
      const invoice = exactMatch(invoicesForCustomer(), invoiceInput.value, invoiceDisplay);
      if (invoice) selectInvoice(invoice);
      else {
        selectedInvoice = null;
        renderLines();
      }
    });
    invoiceInput.addEventListener('change', () => {
      const invoice = exactMatch(invoicesForCustomer(), invoiceInput.value, invoiceDisplay);
      selectInvoice(invoice);
    });

    newSave.addEventListener('click', async () => {
      if (!selectedCustomer) return alert('Select a customer first.');
      if (!selectedInvoice) return alert('Select an invoice for the customer.');
      try {
        const requestedLines = [...root.querySelectorAll('tr[data-line]')].map(row => ({
          invoiceLineIndex: Number(row.dataset.line),
          returnQty: Number(row.querySelector('.rga-return-qty')?.value || 0)
        }));
        const created = await api('/api/rga', {
          method:'POST',
          body:JSON.stringify({
            invoiceId:selectedInvoice.id,
            reason:$('#rgaReason', root)?.value || 'Customer Return',
            requestedDate:$('#rgaRequestedDate', root)?.value || new Date().toISOString().slice(0,10),
            notes:$('#rgaNotes', root)?.value || '',
            lines:requestedLines
          })
        });
        history.pushState({}, '', '/sales-orders/rga/' + encodeURIComponent(created.id));
        window.dispatchEvent(new PopStateEvent('popstate'));
      } catch (error) {
        alert(error.message);
      }
    });

    updateInvoiceSuggestions();
    if (selectedCustomer) selectCustomer(selectedCustomer);
    if (selectedInvoice) selectInvoice(selectedInvoice);
    if (!selectedCustomer) renderLines();
  }

  let timer = 0;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => enhanceNewRga().catch(error => console.error('RGA searchable selector enhancement failed', error)), 30);
  };

  const observer = new MutationObserver(schedule);
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList:true, subtree:true });
    schedule();
  });
  window.addEventListener('popstate', schedule);
})();
