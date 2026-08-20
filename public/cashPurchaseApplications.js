(() => {
  'use strict';

  const PREFIX = '/ap/cash-purchases';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = value => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  const today = () => new Date().toISOString().slice(0, 10);

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await window.fetch(path, { ...options, headers, credentials: 'same-origin' });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
    if (!response.ok) throw new Error(body.error || body.message || text || `Request failed (${response.status})`);
    return body;
  }

  function setTitle(value) {
    const title = $('#title');
    if (title) title.textContent = value;
  }

  function notify(message, error = false) {
    $('#cashPurchaseApplicationToast')?.remove();
    const el = document.createElement('div');
    el.id = 'cashPurchaseApplicationToast';
    el.className = `iv2-toast${error ? ' error' : ''}`;
    el.innerHTML = `<strong>${error ? 'Cash Purchase' : 'Saved'}</strong><span>${esc(message)}</span><button type='button' aria-label='Close'>×</button>`;
    document.body.appendChild(el);
    $('button', el).onclick = () => el.remove();
    setTimeout(() => el.remove(), 5000);
  }

  function injectStyles() {
    if ($('#cashPurchaseApplicationStyles')) return;
    const style = document.createElement('style');
    style.id = 'cashPurchaseApplicationStyles';
    style.textContent = `
      .cp-tabs{display:flex;gap:6px;border-bottom:1px solid var(--border,#d7dce2);margin-top:18px;flex-wrap:wrap}
      .cp-tabs button{border:0;border-bottom:3px solid transparent;background:transparent;padding:10px 14px;border-radius:0}
      .cp-tabs button.active{border-bottom-color:currentColor;font-weight:700}
      .cp-pane{padding-top:14px}.cp-pane.hidden{display:none}
      .cp-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin:12px 0}
      .cp-summary>div{border:1px solid var(--border,#d7dce2);border-radius:7px;padding:9px 11px;background:var(--panel-bg,#fff)}
      .cp-summary small{display:block;opacity:.7}.cp-summary strong{display:block;margin-top:3px;font-size:1.05rem}
      .cp-table-wrap{overflow:auto;border:1px solid var(--border,#d7dce2);border-radius:7px}
      .cp-table-wrap table{min-width:1050px;width:100%;border-collapse:collapse}
      .cp-table-wrap th,.cp-table-wrap td{padding:7px 8px;border-bottom:1px solid var(--border,#e4e7eb);white-space:nowrap;text-align:left}
      .cp-table-wrap td.num,.cp-table-wrap th.num{text-align:right}
      .cp-table-wrap input[type=number]{width:120px}
      .cp-note{padding:10px 12px;border-left:3px solid currentColor;background:rgba(127,127,127,.08);margin:10px 0}
      .cp-credit{font-weight:600}.cp-financial-projection{margin-top:12px}
      .cp-list-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0 12px}.cp-list-tools input{min-width:280px}
      .cp-status{font-weight:600}.cp-direct{font-weight:700}
      @media(max-width:800px){.cp-table-wrap table{min-width:900px}.cp-list-tools input{min-width:180px;flex:1}}
    `;
    document.head.appendChild(style);
  }

  function isCashPurchasePath(path = location.pathname) {
    return path === PREFIX || path === `${PREFIX}/new` || path.startsWith(`${PREFIX}/`);
  }

  function markView(path) {
    const view = $('#view');
    if (!view) return null;
    view.dataset.erpAccountingRoute = path;
    view.dataset.cashPurchaseApplicationsRoute = path;
    return view;
  }

  function navigate(path) {
    history.pushState({}, '', path);
    setTimeout(() => renderRoute(true), 0);
  }

  function accountCode(value) {
    return String(value || '').trim().split(/\s+(?:—|-)\s+|\s+/)[0] || '';
  }

  function vendorId(value) {
    return String(value || '').trim().split(/\s+(?:—|-)\s+/)[0] || '';
  }

  function applicationTotals(state, targetById = new Map()) {
    let invoiceApplied = 0;
    let creditApplied = 0;
    for (const application of state.applications || []) {
      const amount = Number(application.amount || 0);
      if (amount <= 0) continue;
      const type = application.documentType || targetById.get(application.documentId)?.type || '';
      if (type === 'Credit Adjustment') creditApplied += amount;
      else invoiceApplied += amount;
    }
    const netApplied = Number((invoiceApplied - creditApplied).toFixed(2));
    const directPurchaseAmount = Number((Number(state.amount || 0) - netApplied).toFixed(2));
    return { invoiceApplied, creditApplied, netApplied, directPurchaseAmount };
  }

  function projectedFinancialRows(state, targetById = new Map()) {
    const totals = applicationTotals(state, targetById);
    const rows = [];
    if (totals.netApplied > 0) rows.push({ account: '2020', description: 'Accounts Payable — documents applied', debit: totals.netApplied, credit: 0 });
    if (totals.directPurchaseAmount > 0) rows.push({ account: state.expenseAccount || '', description: 'Direct cash purchase — Expense / Asset', debit: totals.directPurchaseAmount, credit: 0 });
    rows.push({ account: state.cashAccount || '', description: 'Cash / Bank', debit: 0, credit: Number(state.amount || 0) });
    return rows;
  }

  async function renderList() {
    injectStyles();
    const view = markView(PREFIX);
    if (!view) return;
    setTitle('Cash Purchases');
    let rows = [];
    try {
      rows = await api('/api/ap/documents?type=Cash%20Purchase');
    } catch (error) {
      view.innerHTML = `<section class='panel'><h3>Cash Purchases</h3><p>${esc(error.message)}</p></section>`;
      return;
    }
    const renderRows = filter => {
      const q = String(filter || '').trim().toLowerCase();
      const list = rows.filter(row => !q || [row.id, row.vendorName, row.vendorRef, row.method, row.description, row.status, row.journalEntryNumber].some(value => String(value || '').toLowerCase().includes(q)));
      const tbody = $('#cashPurchaseListRows');
      if (!tbody) return;
      tbody.innerHTML = list.map(row => `<tr>
        <td><a class='link cp-detail-link' href='${PREFIX}/${encodeURIComponent(row.id)}'>${esc(row.id)}</a></td>
        <td>${esc(row.vendorName || '')}</td>
        <td>${esc(row.date || '')}</td>
        <td>${esc(row.vendorRef || row.paymentRef || '')}</td>
        <td>${esc(row.method || '')}</td>
        <td class='num'>${money(row.amount)}</td>
        <td class='num'>${money(row.invoiceAppliedAmount || 0)}</td>
        <td class='num'>${money(row.creditAppliedAmount || 0)}</td>
        <td class='num cp-direct'>${money(row.directPurchaseAmount ?? row.unappliedBalance ?? row.amount)}</td>
        <td class='cp-status'>${esc(row.status || '')}</td>
        <td>${row.journalEntryNumber ? `<a class='link' href='/finance/journal/${encodeURIComponent(row.journalEntryNumber)}'>${esc(row.journalEntryNumber)}</a>` : ''}</td>
      </tr>`).join('') || `<tr><td colspan='11'>No cash purchases found.</td></tr>`;
    };
    view.innerHTML = `<div data-cash-purchase-apps='list'>
      <div class='header-row'><div><h3>Cash Purchases</h3><p>Direct vendor payments can be posted with no application, or applied to AP invoices and credit memos.</p></div><button type='button' id='newCashPurchase'>New Cash Purchase</button></div>
      <div class='cp-list-tools'><input id='cashPurchaseListSearch' placeholder='Search cash purchases'><button type='button' id='cashPurchaseRefresh'>Refresh</button></div>
      <div class='cp-table-wrap'><table><thead><tr><th>Reference</th><th>Vendor</th><th>Date</th><th>Vendor Ref</th><th>Method</th><th class='num'>Amount</th><th class='num'>Invoice Applied</th><th class='num'>Credit Memo Applied</th><th class='num'>Direct Purchase</th><th>Status</th><th>Journal</th></tr></thead><tbody id='cashPurchaseListRows'></tbody></table></div>
    </div>`;
    renderRows('');
    $('#cashPurchaseListSearch').oninput = event => renderRows(event.target.value);
    $('#newCashPurchase').onclick = () => navigate(`${PREFIX}/new`);
    $('#cashPurchaseRefresh').onclick = () => renderList();
  }

  async function renderForm(documentId = '') {
    injectStyles();
    const isNew = !documentId;
    const path = isNew ? `${PREFIX}/new` : `${PREFIX}/${encodeURIComponent(documentId)}`;
    const view = markView(path);
    if (!view) return;
    setTitle(isNew ? 'New Cash Purchase' : `Cash Purchase ${documentId}`);
    view.innerHTML = `<section class='panel'><p>Loading cash purchase…</p></section>`;

    try {
      const [vendors, chart, branches, existing] = await Promise.all([
        api('/api/ap/vendors'),
        api('/api/finance/chart-of-accounts'),
        api('/api/finance/branches'),
        isNew ? Promise.resolve(null) : api(`/api/ap/documents/${encodeURIComponent(documentId)}`)
      ]);
      if (existing && existing.type !== 'Cash Purchase') throw new Error('This AP document is not a Cash Purchase.');

      const activeVendors = vendors.filter(vendor => vendor.status !== 'Inactive');
      const activeAccounts = chart.filter(account => account.active !== false);
      const cashAccounts = activeAccounts.filter(account => /cash|bank|checking|operating account/i.test(`${account.accountNumber || ''} ${account.accountTitle || ''}`));
      const offsetAccounts = activeAccounts.filter(account => !/accounts payable|a\/p control|cash|bank|checking/i.test(`${account.accountNumber || ''} ${account.accountTitle || ''}`));
      const defaultCash = cashAccounts.find(account => String(account.accountNumber) === '1084') || cashAccounts.find(account => String(account.accountNumber) === '1079') || cashAccounts[0] || activeAccounts[0];
      const defaultOffset = offsetAccounts.find(account => /^6/.test(String(account.accountNumber || ''))) || offsetAccounts.find(account => /^5/.test(String(account.accountNumber || ''))) || offsetAccounts[0];
      const defaultBranch = branches.find(branch => String(branch.code) === '100') || branches[0];
      const state = existing ? {
        ...existing,
        applications: (existing.applications || []).map(application => ({
          documentId: application.documentId || application.billId,
          amount: Number(application.amount || 0),
          documentType: application.documentType || ''
        }))
      } : {
        id: '', type: 'Cash Purchase', status: 'Saved', posted: false, date: today(), vendorId: '', vendorName: '', vendorRef: '', method: 'ACH/Wire',
        branch: defaultBranch?.code || '100', cashAccount: defaultCash?.accountNumber || '', expenseAccount: defaultOffset?.accountNumber || '', amount: 0, description: '', applications: [], history: []
      };
      const readonly = !!state.posted || ['Open', 'Closed', 'Voided'].includes(state.status);
      let vendorDocuments = [];
      let targetById = new Map();

      const vendorText = state.vendorId ? `${state.vendorId} — ${state.vendorName || activeVendors.find(v => v.id === state.vendorId)?.name || ''}` : '';
      const accountText = (code, list) => {
        const account = list.find(item => String(item.accountNumber) === String(code));
        return account ? `${account.accountNumber} — ${account.accountTitle}` : String(code || '');
      };
      const branchOptions = branches.map(branch => `<option value='${esc(branch.code)}' ${String(branch.code) === String(state.branch) ? 'selected' : ''}>${esc(branch.code)}${branch.name ? ` — ${esc(branch.name)}` : ''}</option>`).join('');
      const vendorOptions = activeVendors.map(vendor => `<option value='${esc(vendor.id)} — ${esc(vendor.name)}'></option>`).join('');
      const cashOptions = cashAccounts.map(account => `<option value='${esc(account.accountNumber)} — ${esc(account.accountTitle)}'></option>`).join('');
      const offsetOptions = offsetAccounts.map(account => `<option value='${esc(account.accountNumber)} — ${esc(account.accountTitle)}'></option>`).join('');

      view.innerHTML = `<div data-cash-purchase-apps='form'>
        <div class='erp-toolbar sticky'>
          <button type='button' id='cpBack'>Back</button>
          <button type='button' id='cpSave' ${readonly ? 'disabled' : ''}>Save</button>
          <button type='button' id='cpSavePost' ${readonly ? 'disabled' : ''}>Save & Post</button>
          ${!isNew && !readonly ? `<button type='button' id='cpDelete'>Delete</button>` : ''}
          ${!isNew && state.posted && state.status !== 'Voided' ? `<button type='button' id='cpVoid'>Void</button>` : ''}
        </div>
        <section class='erp-workspace'>
          <div class='header-row'><div><h3>${isNew ? 'New Cash Purchase' : esc(state.id)}</h3><p>Pay a vendor directly, with or without applying the cash against AP documents.</p></div><div><b>Status:</b> ${esc(state.status || 'Saved')}</div></div>
          <div class='erp-header-grid'>
            <label>Reference Number<input value='${esc(isNew ? '<NEW>' : state.id)}' readonly></label>
            <label>Date<input id='cpDate' type='date' value='${esc(state.date || today())}' ${readonly ? 'readonly' : ''}></label>
            <label>Vendor<input id='cpVendor' list='cpVendorList' autocomplete='off' value='${esc(vendorText)}' ${readonly ? 'readonly' : ''}><datalist id='cpVendorList'>${vendorOptions}</datalist></label>
            <label>Vendor Reference<input id='cpVendorRef' value='${esc(state.vendorRef || state.paymentRef || '')}' ${readonly ? 'readonly' : ''}></label>
            <label>Payment Method<select id='cpMethod' ${readonly ? 'disabled' : ''}>${['ACH/Wire','Check','Credit Card','Cash','Other'].map(method => `<option ${method === state.method ? 'selected' : ''}>${method}</option>`).join('')}</select></label>
            <label>Branch<select id='cpBranch' ${readonly ? 'disabled' : ''}>${branchOptions}</select></label>
            <label>Cash Account<input id='cpCash' list='cpCashList' value='${esc(accountText(state.cashAccount || defaultCash?.accountNumber, cashAccounts))}' ${readonly ? 'readonly' : ''}><datalist id='cpCashList'>${cashOptions}</datalist></label>
            <label>Expense / Asset Account<input id='cpExpense' list='cpExpenseList' value='${esc(accountText(state.expenseAccount || defaultOffset?.accountNumber, offsetAccounts))}' ${readonly ? 'readonly' : ''}><datalist id='cpExpenseList'>${offsetOptions}</datalist></label>
            <label>Cash Purchase Amount<input id='cpAmount' type='number' min='0.01' step='0.01' value='${Number(state.amount || 0).toFixed(2)}' ${readonly ? 'readonly' : ''}></label>
            <label class='span2'>Description<input id='cpDescription' value='${esc(state.description || '')}' placeholder='What was purchased / why payment was made' ${readonly ? 'readonly' : ''}></label>
          </div>
          <div class='cp-tabs'>
            <button type='button' class='active' data-cp-tab='documents'>Documents to Apply</button>
            <button type='button' data-cp-tab='history'>Application History</button>
            <button type='button' data-cp-tab='financial'>Financial Details</button>
          </div>
          <div id='cpDocuments' class='cp-pane'></div>
          <div id='cpHistory' class='cp-pane hidden'></div>
          <div id='cpFinancial' class='cp-pane hidden'></div>
        </section>
      </div>`;

      function selectedVendor() {
        const id = vendorId($('#cpVendor').value);
        return activeVendors.find(vendor => vendor.id === id) || null;
      }

      function readHeader() {
        const vendor = selectedVendor();
        state.vendorId = vendor?.id || '';
        state.vendorName = vendor?.name || '';
        state.date = $('#cpDate').value;
        state.vendorRef = $('#cpVendorRef').value.trim();
        state.method = $('#cpMethod').value;
        state.branch = $('#cpBranch').value;
        state.cashAccount = accountCode($('#cpCash').value);
        state.expenseAccount = accountCode($('#cpExpense').value);
        state.amount = Number($('#cpAmount').value || 0);
        state.description = $('#cpDescription').value.trim();
      }

      async function loadVendorDocuments(resetApplications = false) {
        readHeader();
        if (resetApplications) state.applications = [];
        if (!state.vendorId) {
          vendorDocuments = [];
          targetById = new Map();
          renderDocuments();
          return;
        }
        const all = await api(`/api/ap/documents?vendorId=${encodeURIComponent(state.vendorId)}`);
        const referenced = new Set((state.applications || []).map(application => application.documentId));
        vendorDocuments = all.filter(document => document.id !== state.id && (
          (['Bill','Credit Adjustment'].includes(document.type) && document.posted && document.status === 'Open' && Number(document.balance || 0) > 0) || referenced.has(document.id)
        ));
        targetById = new Map(vendorDocuments.map(document => [document.id, document]));
        state.applications.forEach(application => {
          if (!application.documentType) application.documentType = targetById.get(application.documentId)?.type || '';
        });
        renderDocuments();
        renderFinancial();
      }

      function updateApplication(document, checked, amountValue) {
        const existingIndex = state.applications.findIndex(application => application.documentId === document.id);
        if (!checked) {
          if (existingIndex >= 0) state.applications.splice(existingIndex, 1);
          return;
        }
        const amount = Math.max(0, Number(amountValue || 0));
        const next = { documentId: document.id, amount, documentType: document.type };
        if (existingIndex >= 0) state.applications[existingIndex] = next;
        else state.applications.push(next);
      }

      function renderDocuments() {
        readHeader();
        const totals = applicationTotals(state, targetById);
        const rows = vendorDocuments.map(document => {
          const application = state.applications.find(item => item.documentId === document.id);
          const selected = !!application;
          const applied = Number(application?.amount || 0);
          const originalOpen = Number(document.balance || 0) + (state.posted && selected ? applied : 0);
          const remaining = Math.max(0, originalOpen - applied);
          const label = document.type === 'Credit Adjustment' ? 'Credit Memo' : 'Invoice';
          return `<tr data-doc='${esc(document.id)}'>
            <td><input type='checkbox' class='cpApplyCheck' data-id='${esc(document.id)}' ${selected ? 'checked' : ''} ${readonly ? 'disabled' : ''}></td>
            <td class='${document.type === 'Credit Adjustment' ? 'cp-credit' : ''}'>${label}</td>
            <td><a class='link' href='/ap/bills/${encodeURIComponent(document.id)}'>${esc(document.id)}</a></td>
            <td>${esc(document.vendorRef || document.invoiceNumber || '')}</td>
            <td>${esc(document.date || '')}</td>
            <td>${esc(document.dueDate || '')}</td>
            <td class='num'>${money(document.amount)}</td>
            <td class='num'>${money(originalOpen)}</td>
            <td class='num'><input type='number' class='cpApplyAmount' data-id='${esc(document.id)}' min='0' step='0.01' max='${originalOpen}' value='${applied.toFixed(2)}' ${!selected || readonly ? 'disabled' : ''}></td>
            <td class='num'>${money(remaining)}</td>
            <td>${document.type === 'Credit Adjustment' ? 'Reduces cash required' : 'Uses cash payment'}</td>
          </tr>`;
        }).join('');
        $('#cpDocuments').innerHTML = `
          <div class='cp-note'><b>Applications are optional.</b> Leave all documents unchecked to post the full amount directly to the selected Expense / Asset account. A credit memo reduces the net cash applied to AP and must be paired with enough invoice application.</div>
          <div class='cp-summary'>
            <div><small>Cash Purchase Amount</small><strong>${money(state.amount)}</strong></div>
            <div><small>Invoices Applied</small><strong>${money(totals.invoiceApplied)}</strong></div>
            <div><small>Credit Memos Applied</small><strong>${money(totals.creditApplied)}</strong></div>
            <div><small>Net Applied to AP</small><strong>${money(totals.netApplied)}</strong></div>
            <div><small>Direct Purchase Amount</small><strong>${money(totals.directPurchaseAmount)}</strong></div>
          </div>
          <div class='cp-table-wrap'><table><thead><tr><th></th><th>Document Type</th><th>Reference Number</th><th>Vendor Invoice #</th><th>Date</th><th>Due Date</th><th class='num'>Original Amount</th><th class='num'>Open Balance</th><th class='num'>Applied Amount</th><th class='num'>Remaining Balance</th><th>Effect</th></tr></thead><tbody>${rows || `<tr><td colspan='11'>${state.vendorId ? 'No open AP invoices or credit memos are available for this vendor.' : 'Select a vendor to load documents.'}</td></tr>`}</tbody></table></div>`;
        $$('.cpApplyCheck', $('#cpDocuments')).forEach(check => {
          check.onchange = () => {
            const document = targetById.get(check.dataset.id);
            if (!document) return;
            const amountInput = $(`.cpApplyAmount[data-id="${CSS.escape(check.dataset.id)}"]`, $('#cpDocuments'));
            if (check.checked) {
              const current = Number(amountInput.value || 0);
              const open = Number(document.balance || 0);
              amountInput.disabled = false;
              amountInput.value = (current > 0 ? current : open).toFixed(2);
              updateApplication(document, true, amountInput.value);
            } else {
              amountInput.disabled = true;
              amountInput.value = '0.00';
              updateApplication(document, false, 0);
            }
            renderDocuments();
            renderFinancial();
          };
        });
        $$('.cpApplyAmount', $('#cpDocuments')).forEach(input => {
          input.oninput = () => {
            const document = targetById.get(input.dataset.id);
            if (!document) return;
            const max = Number(input.max || document.balance || 0);
            if (Number(input.value || 0) > max) input.value = String(max);
            updateApplication(document, true, input.value);
            const totalsNow = applicationTotals(state, targetById);
            const summary = $$('.cp-summary strong', $('#cpDocuments'));
            if (summary.length >= 5) {
              summary[0].textContent = money(state.amount);
              summary[1].textContent = money(totalsNow.invoiceApplied);
              summary[2].textContent = money(totalsNow.creditApplied);
              summary[3].textContent = money(totalsNow.netApplied);
              summary[4].textContent = money(totalsNow.directPurchaseAmount);
            }
            renderFinancial();
          };
        });
      }

      function renderHistory() {
        const history = state.history || [];
        $('#cpHistory').innerHTML = `<div class='cp-table-wrap'><table><thead><tr><th>Application Reference</th><th>Applied Document</th><th>Document Type</th><th>Date</th><th class='num'>Applied Amount</th><th>Reversal Entry</th><th>User</th></tr></thead><tbody>${history.map(item => `<tr><td>${esc(item.reference || '')}</td><td>${item.appliedDocument ? `<a class='link' href='/ap/bills/${encodeURIComponent(item.appliedDocument)}'>${esc(item.appliedDocument)}</a>` : ''}</td><td>${esc(item.documentType === 'Credit Adjustment' ? 'Credit Memo' : item.documentType === 'Bill' ? 'Invoice' : item.documentType || '')}</td><td>${esc(item.date || '')}</td><td class='num'>${money(item.amount)}</td><td>${item.reversalEntry ? `<a class='link' href='/finance/journal/${encodeURIComponent(item.reversalEntry)}'>${esc(item.reversalEntry)}</a>` : ''}</td><td>${esc(item.user || '')}</td></tr>`).join('') || `<tr><td colspan='7'>${state.posted ? 'No application history.' : 'Applications are recorded when the cash purchase is posted.'}</td></tr>`}</tbody></table></div>`;
      }

      async function renderFinancial() {
        readHeader();
        const projected = projectedFinancialRows(state, targetById);
        let actualRows = [];
        let journalNumber = state.journalEntryNumber || state.jeNumber || '';
        if (state.posted && journalNumber) {
          try {
            const journal = await api(`/api/finance/journal-transactions/${encodeURIComponent(journalNumber)}`);
            actualRows = journal.lines || [];
          } catch {
            actualRows = [];
          }
        }
        const rows = actualRows.length ? actualRows : projected;
        const debit = rows.reduce((sum, row) => sum + Number(row.debit || 0), 0);
        const credit = rows.reduce((sum, row) => sum + Number(row.credit || 0), 0);
        $('#cpFinancial').innerHTML = `
          <div class='cp-summary'>
            <div><small>Posting Status</small><strong>${state.posted ? 'Posted' : 'Projected'}</strong></div>
            <div><small>Total Debit</small><strong>${money(debit)}</strong></div>
            <div><small>Total Credit</small><strong>${money(credit)}</strong></div>
            <div><small>Journal Entry</small><strong>${journalNumber ? `<a class='link' href='/finance/journal/${encodeURIComponent(journalNumber)}'>${esc(journalNumber)}</a>` : 'Not Posted'}</strong></div>
          </div>
          <div class='cp-note'>Applied invoice/credit-memo portion posts to Accounts Payable. The remaining direct-purchase portion posts to the selected Expense / Asset account. The full cash-purchase amount credits the selected Cash / Bank account.</div>
          <div class='cp-table-wrap cp-financial-projection'><table><thead><tr><th>Account</th><th>Description</th><th class='num'>Debit</th><th class='num'>Credit</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.account || '')}</td><td>${esc(row.lineDescription || row.description || '')}</td><td class='num'>${money(row.debit)}</td><td class='num'>${money(row.credit)}</td></tr>`).join('')}</tbody></table></div>`;
      }

      function validate() {
        readHeader();
        const vendor = selectedVendor();
        if (!vendor) throw new Error('Select a valid active vendor.');
        if (!state.date) throw new Error('Date is required.');
        if (!(state.amount > 0)) throw new Error('Cash Purchase Amount must be greater than $0.00.');
        if (!state.cashAccount || !activeAccounts.some(account => String(account.accountNumber) === String(state.cashAccount))) throw new Error('Select a valid Cash / Bank account.');
        const totals = applicationTotals(state, targetById);
        if (totals.netApplied < -0.005) throw new Error('Credit memo applications cannot exceed invoice applications.');
        if (totals.netApplied - state.amount > 0.005) throw new Error('Net amount applied to AP cannot exceed the Cash Purchase Amount.');
        if (totals.directPurchaseAmount > 0.005 && (!state.expenseAccount || !activeAccounts.some(account => String(account.accountNumber) === String(state.expenseAccount)))) throw new Error('Select an Expense / Asset account for the direct purchase amount.');
        for (const application of state.applications) {
          const target = targetById.get(application.documentId);
          if (!target) throw new Error(`Applied document ${application.documentId} is no longer available.`);
          if (Number(application.amount || 0) <= 0) throw new Error(`Applied amount for ${application.documentId} must be greater than zero.`);
          const available = Number(target.balance || 0) + (state.posted ? Number(application.amount || 0) : 0);
          if (Number(application.amount || 0) - available > 0.005) throw new Error(`Applied amount exceeds the open balance for ${application.documentId}.`);
        }
        return totals;
      }

      function payload() {
        const totals = validate();
        return {
          type: 'Cash Purchase',
          vendorId: state.vendorId,
          date: state.date,
          postDate: state.date,
          branch: state.branch,
          method: state.method,
          paymentRef: state.vendorRef,
          vendorRef: state.vendorRef,
          cashAccount: state.cashAccount,
          expenseAccount: state.expenseAccount,
          amount: state.amount,
          balance: totals.directPurchaseAmount,
          description: state.description,
          applications: state.applications.map(application => ({ documentId: application.documentId, amount: Number(application.amount || 0), documentType: application.documentType }))
        };
      }

      let processing = false;
      async function saveAndMaybePost(post) {
        if (processing || readonly) return;
        processing = true;
        const buttons = [$('#cpSave'), $('#cpSavePost')].filter(Boolean);
        buttons.forEach(button => button.disabled = true);
        try {
          const data = payload();
          const saved = isNew
            ? await api('/api/ap/documents', { method: 'POST', body: JSON.stringify(data) })
            : await api(`/api/ap/documents/${encodeURIComponent(state.id)}`, { method: 'PUT', body: JSON.stringify(data) });
          let result = saved;
          if (post) result = await api('/api/ap/documents/post', { method: 'POST', body: JSON.stringify({ id: saved.id || state.id }) });
          notify(post ? `Cash Purchase ${result.id || saved.id} posted successfully.` : `Cash Purchase ${saved.id || state.id} saved successfully.`);
          navigate(`${PREFIX}/${encodeURIComponent(result.id || saved.id || state.id)}`);
        } catch (error) {
          notify(error.message, true);
        } finally {
          processing = false;
          buttons.forEach(button => { if (button.isConnected) button.disabled = false; });
        }
      }

      $('#cpBack').onclick = () => navigate(PREFIX);
      $('#cpSave').onclick = () => saveAndMaybePost(false);
      $('#cpSavePost').onclick = () => saveAndMaybePost(true);
      if ($('#cpDelete')) $('#cpDelete').onclick = async () => {
        if (!confirm(`Delete Cash Purchase ${state.id}?`)) return;
        try {
          await api(`/api/ap/documents/${encodeURIComponent(state.id)}`, { method: 'DELETE' });
          navigate(PREFIX);
        } catch (error) { notify(error.message, true); }
      };
      if ($('#cpVoid')) $('#cpVoid').onclick = async () => {
        if (!confirm(`Void Cash Purchase ${state.id} and reverse its applications?`)) return;
        try {
          await api('/api/ap/documents/void', { method: 'POST', body: JSON.stringify({ id: state.id }) });
          notify(`Cash Purchase ${state.id} voided.`);
          renderForm(state.id);
        } catch (error) { notify(error.message, true); }
      };

      $$('.cp-tabs [data-cp-tab]').forEach(button => {
        button.onclick = () => {
          $$('.cp-tabs [data-cp-tab]').forEach(item => item.classList.toggle('active', item === button));
          $('#cpDocuments').classList.toggle('hidden', button.dataset.cpTab !== 'documents');
          $('#cpHistory').classList.toggle('hidden', button.dataset.cpTab !== 'history');
          $('#cpFinancial').classList.toggle('hidden', button.dataset.cpTab !== 'financial');
          if (button.dataset.cpTab === 'history') renderHistory();
          if (button.dataset.cpTab === 'financial') renderFinancial();
        };
      });

      if (!readonly) {
        $('#cpVendor').onchange = () => loadVendorDocuments(true).catch(error => notify(error.message, true));
        $('#cpVendor').onblur = () => loadVendorDocuments(true).catch(error => notify(error.message, true));
        $('#cpAmount').oninput = () => { readHeader(); renderDocuments(); renderFinancial(); };
        ['#cpCash','#cpExpense','#cpDescription','#cpMethod','#cpBranch','#cpDate','#cpVendorRef'].forEach(selector => {
          const element = $(selector);
          if (element) element.onchange = () => { readHeader(); renderFinancial(); };
        });
      }

      renderHistory();
      await loadVendorDocuments(false);
      await renderFinancial();
    } catch (error) {
      view.innerHTML = `<section class='panel'><h3>Cash Purchase</h3><p>${esc(error.message)}</p><button type='button' id='cpErrorBack'>Back</button></section>`;
      $('#cpErrorBack').onclick = () => navigate(PREFIX);
    }
  }

  async function renderRoute(force = false) {
    const path = location.pathname;
    if (!isCashPurchasePath(path)) return false;
    const view = $('#view');
    if (!view) return false;
    if (!force && view.dataset.cashPurchaseApplicationsRoute === path && $('[data-cash-purchase-apps]', view)) return true;
    if (path === PREFIX) await renderList();
    else if (path === `${PREFIX}/new`) await renderForm('');
    else await renderForm(decodeURIComponent(path.slice(`${PREFIX}/`.length)));
    return true;
  }

  document.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest('a[href]');
    if (!anchor) return;
    let url;
    try { url = new URL(anchor.getAttribute('href'), location.origin); } catch { return; }
    if (url.origin !== location.origin || !isCashPurchasePath(url.pathname)) return;
    if (url.pathname === PREFIX || url.pathname === `${PREFIX}/new`) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    navigate(url.pathname + url.search);
  }, true);

  window.addEventListener('popstate', () => setTimeout(() => renderRoute(true), 0));

  let queued = false;
  new MutationObserver(() => {
    if (queued || !isCashPurchasePath()) return;
    const view = $('#view');
    if (view?.dataset.cashPurchaseApplicationsRoute === location.pathname && $('[data-cash-purchase-apps]', view)) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      renderRoute(true).catch(error => notify(error.message, true));
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  setTimeout(() => renderRoute(true).catch(error => notify(error.message, true)), 0);
})();
