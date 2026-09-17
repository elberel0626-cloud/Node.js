(() => {
  'use strict';

  const TYPES = new Set(['Payment', 'Prepayment', 'Cash Payment']);
  const originalFetch = window.fetch.bind(window);
  const documentCache = new Map();
  let coaPromise = null;
  let branchesPromise = null;
  let poRequestToken = 0;
  let cashState = { key:'', lines:[] };

  const paymentListRoute = () => location.pathname === '/ap/payments';
  const paymentDetailMatch = () => location.pathname.match(/^\/ap\/payments\/([^/]+)$/);
  const isNewPayment = () => ['/ap/payments/new', '/ap/payments/__new__'].includes(location.pathname);
  const routeKey = () => `${location.pathname}${location.search}`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = value => Number(value || 0).toLocaleString(undefined, { style:'currency', currency:'USD' });
  const roundMoney = value => Number(Number(value || 0).toFixed(2));

  function requestedType() {
    if (!isNewPayment()) return '';
    const raw = new URLSearchParams(location.search).get('type') || '';
    if (raw === 'Prepayment') return 'Prepayment';
    if (['CashPayment', 'Cash Payment'].includes(raw)) return 'Cash Payment';
    return 'Payment';
  }

  function activeType() {
    return requestedType() || document.getElementById('view')?.dataset.apPaymentDocumentType || 'Payment';
  }

  function requestUrl(input) {
    try { return new URL(String(input instanceof Request ? input.url : input || ''), location.origin); }
    catch { return null; }
  }

  function errorResponse(message) {
    return new Response(JSON.stringify({ error:message }), { status:400, headers:{ 'Content-Type':'application/json' } });
  }

  async function parseResponse(response) {
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error:text }; }
    if (!response.ok) throw new Error(data.error || data.message || text || `Request failed (${response.status})`);
    return data;
  }

  async function api(path, options = {}) {
    return parseResponse(await fetch(path, { credentials:'same-origin', ...options }));
  }

  function currentVendorId() {
    const hidden = String(document.getElementById('pVendorSearch')?.value || '').trim();
    const number = String(document.getElementById('pVendorNumber')?.value || '').trim();
    return (hidden || number).split(/\s+-\s+|\s+—\s+/)[0].trim();
  }

  function parseAccount(value) {
    return String(value || '').trim().split(/\s+-\s+/)[0].trim();
  }

  function setHeaderAmount(total, applied = null, unapplied = null) {
    const amount = document.getElementById('pAmount');
    const formatted = roundMoney(total).toFixed(2);
    if (amount && String(amount.value) !== formatted) {
      amount.value = formatted;
      amount.dispatchEvent(new Event('input', { bubbles:true }));
    }
    if (applied !== null && document.getElementById('pApplied')) document.getElementById('pApplied').value = roundMoney(applied).toFixed(2);
    if (unapplied !== null && document.getElementById('pUnap')) document.getElementById('pUnap').value = roundMoney(unapplied).toFixed(2);
  }

  function collectPrepaymentApplications() {
    const rows = [...document.querySelectorAll('#docsGrid tr[data-prepayment-po]')];
    const applications = [];
    for (const row of rows) {
      const check = row.querySelector('.prepay-po-check');
      const amountInput = row.querySelector('.prepay-po-amount');
      if (!check?.checked) continue;
      const amount = roundMoney(amountInput?.value);
      if (amount <= 0) throw new Error(`Enter an applied amount for PO ${check.dataset.poNumber || check.dataset.poId}.`);
      applications.push({ poId:check.dataset.poId || '', poNumber:check.dataset.poNumber || check.dataset.poId || '', amount });
    }
    if (!applications.length) throw new Error('Select at least one open Purchase Order and enter the amount to apply.');
    return applications;
  }

  function collectCashLines() {
    const entered = (cashState.lines || []).filter(line => line.account || line.description || Number(line.amount || 0));
    if (!entered.length) throw new Error('Enter at least one cash payment line.');
    return entered.map((line, index) => {
      const account = parseAccount(line.account);
      const amount = roundMoney(line.amount);
      if (!account) throw new Error(`GL Account is required on line ${index + 1}.`);
      if (amount <= 0) throw new Error(`Amount on line ${index + 1} must be greater than $0.00.`);
      return {
        glAccount:account,
        expenseAccount:account,
        account,
        accountDescription:line.accountDescription || '',
        description:String(line.description || '').trim(),
        lineDescription:String(line.description || '').trim(),
        branch:line.branch || document.getElementById('pBranch')?.value || '100',
        amount,
        qty:1,
        unitCost:amount,
        extendedCost:amount,
        lineTotal:amount
      };
    });
  }

  window.fetch = async (input, options = {}) => {
    const url = requestUrl(input);
    const method = String(options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    if (url && method === 'GET' && paymentListRoute() && url.pathname === '/api/ap/documents' && url.searchParams.get('type') === 'Payment') {
      const allUrl = new URL(url.toString());
      allUrl.searchParams.delete('type');
      const response = await originalFetch(allUrl.toString(), options);
      if (!response.ok) return response;
      const rows = await response.json();
      const filtered = Array.isArray(rows) ? rows.filter(row => TYPES.has(row.type)) : rows;
      const headers = new Headers(response.headers);
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify(filtered), { status:response.status, statusText:response.statusText, headers });
    }

    if (url && ['POST', 'PUT'].includes(method) && url.pathname.startsWith('/api/ap/documents') && location.pathname.startsWith('/ap/payments/') && typeof options.body === 'string') {
      try {
        const body = JSON.parse(options.body);
        const type = activeType();
        body.type = type;
        if (type === 'Prepayment') {
          const applications = collectPrepaymentApplications();
          body.poApplications = applications;
          body.poId = applications.length === 1 ? applications[0].poId : '';
          body.poNumber = applications.length === 1 ? applications[0].poNumber : '';
          body.applications = [];
          body.amount = roundMoney(applications.reduce((sum, row) => sum + row.amount, 0));
        } else if (type === 'Cash Payment') {
          const lines = collectCashLines();
          body.lines = lines;
          body.glAccount = '';
          body.applications = [];
          body.amount = roundMoney(lines.reduce((sum, line) => sum + line.amount, 0));
          body.balance = 0;
        }
        options = { ...options, body:JSON.stringify(body) };
      } catch (error) {
        return errorResponse(error.message);
      }
    }
    return originalFetch(input, options);
  };

  function ensurePaymentButtons() {
    if (!paymentListRoute()) return;
    const header = [...document.querySelectorAll('#view .header-row')].find(row => /Checks and Payments/i.test(row.textContent || ''));
    if (!header) return;
    const actions = header.querySelector('div') || header;
    if (!header.querySelector("a[href='/ap/payments/new?type=Prepayment']")) {
      const link = document.createElement('a');
      link.href = '/ap/payments/new?type=Prepayment';
      link.innerHTML = '<button type="button">New Prepayment</button>';
      actions.appendChild(link);
    }
    if (!header.querySelector("a[href='/ap/payments/new?type=CashPayment']")) {
      const link = document.createElement('a');
      link.href = '/ap/payments/new?type=CashPayment';
      link.innerHTML = '<button type="button">Cash Payment</button>';
      actions.appendChild(link);
    }
  }

  function typeInput() {
    return [...document.querySelectorAll('#view label')].find(label => String(label.childNodes[0]?.textContent || label.textContent || '').trim().startsWith('Type'))?.querySelector('input');
  }

  async function loadDocumentForRoute() {
    const match = paymentDetailMatch();
    if (!match || ['new', '__new__'].includes(match[1])) return null;
    const id = decodeURIComponent(match[1]);
    if (!documentCache.has(id)) documentCache.set(id, api(`/api/ap/documents/${encodeURIComponent(id)}`));
    return documentCache.get(id);
  }

  function prepareDocumentsTab(label, buttonLabel) {
    const tab = document.querySelector("#view .tab[data-tab='docs']");
    if (tab && tab.textContent !== label) tab.textContent = label;
    const grid = document.getElementById('docsGrid');
    if (grid) grid.classList.remove('hidden');
    const button = document.getElementById('loadDocs');
    if (button) {
      button.classList.remove('hidden');
      button.textContent = buttonLabel;
    }
  }

  function existingPoApplications(documentData) {
    if (Array.isArray(documentData?.poApplications) && documentData.poApplications.length) return documentData.poApplications;
    if (documentData?.poId || documentData?.poNumber) return [{ poId:documentData.poId || documentData.poNumber, poNumber:documentData.poNumber || documentData.poId, amount:Number(documentData.amount || 0) }];
    return [];
  }

  function recalcPrepaymentGrid() {
    if (activeType() !== 'Prepayment' || !isNewPayment()) return;
    const rows = [...document.querySelectorAll('#docsGrid tr[data-prepayment-po]')];
    let total = 0;
    rows.forEach(row => {
      const check = row.querySelector('.prepay-po-check');
      const input = row.querySelector('.prepay-po-amount');
      const amount = roundMoney(input?.value);
      if (amount > 0 && check && !check.checked) check.checked = true;
      if (check?.checked) total = roundMoney(total + Math.max(0, amount));
      const open = Number(row.dataset.openBalance || 0);
      const remaining = row.querySelector('.prepay-po-remaining');
      if (remaining) remaining.textContent = money(Math.max(0, open - (check?.checked ? amount : 0)));
    });
    setHeaderAmount(total, total, 0);
    renderPrepaymentFinancialDetails(null);
  }

  function renderPrepaymentFinancialDetails(documentData) {
    const fin = document.getElementById('fin');
    if (!fin) return;
    const apps = documentData ? existingPoApplications(documentData) : (() => {
      try { return collectPrepaymentApplications(); } catch { return []; }
    })();
    const je = documentData?.jeNumber || documentData?.journalEntryNumber || '';
    const allocations = apps.length ? apps.map(row => `<tr><td>${esc(row.poNumber || row.poId)}</td><td>${money(row.amount)}</td></tr>`).join('') : `<tr><td colspan='2'>No PO selected</td></tr>`;
    fin.innerHTML = `<table><tr><td>Debit Account</td><td>1960 - Vendor Deposit</td></tr><tr><td>Credit Account</td><td>${esc(document.getElementById('pCash')?.value || '')}</td></tr><tr><td>Journal Entry Reference</td><td>${esc(je)}</td></tr></table><h4>PO Allocation</h4><table><thead><tr><th>PO</th><th>Applied Amount</th></tr></thead><tbody>${allocations}</tbody></table>`;
  }

  async function renderPrepaymentPos(documentData = null, force = false) {
    if (activeType() !== 'Prepayment') return;
    const grid = document.getElementById('docsGrid');
    if (!grid) return;
    const vendorId = currentVendorId();
    const token = ++poRequestToken;
    const applications = existingPoApplications(documentData);
    const linkedIds = new Set(applications.flatMap(row => [String(row.poId || ''), String(row.poNumber || '')]).filter(Boolean));
    const key = `${vendorId}|${[...linkedIds].sort().join(',')}|${documentData?.id || 'NEW'}`;
    if (!force && grid.dataset.prepaymentKey === key && grid.querySelector('[data-prepayment-po]')) return;
    grid.dataset.prepaymentKey = key;
    if (!vendorId) {
      grid.innerHTML = `<div class='panel'><h4>Purchase Orders to Apply</h4><p>Select a vendor to load its open purchase orders.</p></div>`;
      if (isNewPayment()) setHeaderAmount(0, 0, 0);
      return;
    }
    grid.innerHTML = `<div class='panel'><p>Loading open purchase orders…</p></div>`;
    try {
      const rows = await api('/api/purchase-orders');
      if (token !== poRequestToken || activeType() !== 'Prepayment') return;
      const appMap = new Map();
      applications.forEach(row => { appMap.set(String(row.poId || row.poNumber), row); appMap.set(String(row.poNumber || row.poId), row); });
      const eligible = (Array.isArray(rows) ? rows : []).filter(po => po.vendorId === vendorId && ((['Open','Partially Received','Received'].includes(po.status) && Number(po.openPoBalance || 0) > 0) || linkedIds.has(String(po.id)) || linkedIds.has(String(po.poNumber))));
      const locked = Boolean(documentData?.id && documentData.id !== '<NEW>');
      grid.innerHTML = `<div class='panel'><p>Select the PO and enter the amount of this payment to apply. The posted prepayment remains in <b>1960 - Vendor Deposit</b> until the PO receipt consumes it.</p></div><div class='table-wrap'><table><thead><tr><th>Apply</th><th>PO Number</th><th>Date</th><th>Status</th><th>PO Total</th><th>Received</th><th>Open PO Balance</th><th>Already Prepaid</th><th>Available to Prepay</th><th>Applied Amount</th><th>Remaining PO Balance</th></tr></thead><tbody>${eligible.map(po => {
        const existing = appMap.get(String(po.id)) || appMap.get(String(po.poNumber));
        const existingAmount = Number(existing?.amount || 0);
        const otherPrepaid = Math.max(0, Number(po.prepaymentTotal || 0) - (locked ? existingAmount : 0));
        const available = Math.max(0, Number(po.openPoBalance || 0) - otherPrepaid);
        const checked = Boolean(existing);
        return `<tr data-prepayment-po='1' data-open-balance='${Number(po.openPoBalance || 0)}'><td><input class='prepay-po-check' type='checkbox' data-po-id='${esc(po.id)}' data-po-number='${esc(po.poNumber || po.id)}' ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''}></td><td><a class='link' href='/purchase-orders/orders/${encodeURIComponent(po.poNumber || po.id)}'>${esc(po.poNumber || po.id)}</a></td><td>${esc(po.orderDate || '')}</td><td>${esc(po.status || '')}</td><td>${money(po.poTotal)}</td><td>${money(po.receivedAmount)}</td><td>${money(po.openPoBalance)}</td><td>${money(po.prepaymentTotal)}</td><td>${money(available)}</td><td><input class='prepay-po-amount' type='number' min='0' step='0.01' max='${available.toFixed(2)}' value='${existingAmount.toFixed(2)}' ${locked ? 'readonly' : ''}></td><td class='prepay-po-remaining'>${money(Math.max(0, Number(po.openPoBalance || 0) - existingAmount))}</td></tr>`;
      }).join('') || `<tr><td colspan='11'>No open purchase orders are available for this vendor.</td></tr>`}</tbody></table></div>`;
      if (!locked) {
        grid.querySelectorAll('.prepay-po-check').forEach(check => check.addEventListener('change', () => {
          const input = check.closest('tr')?.querySelector('.prepay-po-amount');
          if (!check.checked && input) input.value = '0.00';
          recalcPrepaymentGrid();
        }));
        grid.querySelectorAll('.prepay-po-amount').forEach(input => input.addEventListener('input', recalcPrepaymentGrid));
        recalcPrepaymentGrid();
      }
      renderPrepaymentFinancialDetails(documentData);
    } catch (error) {
      grid.innerHTML = `<div class='panel'><p>${esc(error.message)}</p></div>`;
    }
  }

  async function ensurePrepaymentPanel(documentData = null) {
    prepareDocumentsTab('POs to Apply', 'Refresh POs');
    const amount = document.getElementById('pAmount');
    if (amount) amount.readOnly = true;
    const button = document.getElementById('loadDocs');
    if (button) button.onclick = () => renderPrepaymentPos(documentData, true);
    await renderPrepaymentPos(documentData);
  }

  async function chartOfAccounts() {
    if (!coaPromise) coaPromise = api('/api/finance/chart-of-accounts');
    return coaPromise;
  }

  async function branches() {
    if (!branchesPromise) branchesPromise = api('/api/finance/branches');
    return branchesPromise;
  }

  function normalizeCashLines(documentData, defaultBranch) {
    const source = Array.isArray(documentData?.lines) && documentData.lines.length ? documentData.lines : [];
    if (!source.length) return [{ account:'', accountDescription:'', description:'', branch:defaultBranch || '100', amount:0 }];
    return source.map(line => ({
      account:parseAccount(line.glAccount || line.expenseAccount || line.account || ''),
      accountDescription:line.accountDescription || '',
      description:line.description || line.lineDescription || '',
      branch:line.branch || defaultBranch || '100',
      amount:Number(line.amount ?? line.lineTotal ?? line.extendedCost ?? 0)
    }));
  }

  function renderCashFinancialDetails(documentData = null) {
    const fin = document.getElementById('fin');
    if (!fin) return;
    const activeLines = (cashState.lines || []).filter(line => Number(line.amount || 0) > 0);
    const debitRows = activeLines.length ? activeLines.map(line => `<tr><td>Debit</td><td>${esc(line.account)}</td><td>${esc(line.accountDescription || '')}</td><td>${esc(line.description || '')}</td><td>${money(line.amount)}</td></tr>`).join('') : `<tr><td colspan='5'>No GL lines entered</td></tr>`;
    const total = activeLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
    fin.innerHTML = `<table><thead><tr><th>Side</th><th>Account</th><th>Account Description</th><th>Line Description</th><th>Amount</th></tr></thead><tbody>${debitRows}<tr><td>Credit</td><td>${esc(document.getElementById('pCash')?.value || '')}</td><td>Cash</td><td>Cash Payment</td><td>${money(total)}</td></tr></tbody></table><p><b>Journal Entry Reference:</b> ${esc(documentData?.jeNumber || documentData?.journalEntryNumber || '')}</p>`;
  }

  function recalcCashHeader(documentData = null) {
    const total = roundMoney((cashState.lines || []).reduce((sum, line) => sum + Math.max(0, Number(line.amount || 0)), 0));
    if (isNewPayment()) setHeaderAmount(total, 0, 0);
    renderCashFinancialDetails(documentData);
  }

  async function renderCashLines(documentData = null, force = false) {
    if (activeType() !== 'Cash Payment') return;
    const grid = document.getElementById('docsGrid');
    if (!grid) return;
    const key = `${routeKey()}|${documentData?.id || 'NEW'}`;
    const defaultBranch = document.getElementById('pBranch')?.value || '100';
    if (cashState.key !== key) cashState = { key, lines:normalizeCashLines(documentData, defaultBranch) };
    if (!force && grid.dataset.cashLinesKey === key && grid.querySelector('[data-cash-payment-lines]')) return;

    const [accounts, branchRows] = await Promise.all([chartOfAccounts(), branches()]);
    if (activeType() !== 'Cash Payment') return;
    const accountRows = (Array.isArray(accounts) ? accounts : []).filter(account => account.active !== false);
    const branchOptions = (Array.isArray(branchRows) ? branchRows : []).map(branch => `<option value='${esc(branch.code)}'>${esc(branch.code)}${branch.name ? ` - ${esc(branch.name)}` : ''}</option>`).join('');
    const locked = Boolean(documentData?.id && documentData.id !== '<NEW>');
    const accountLabel = code => {
      const account = accountRows.find(row => String(row.accountNumber || row.code) === String(code || ''));
      return account ? `${account.accountNumber || account.code} - ${account.accountTitle || account.name || ''}` : String(code || '');
    };

    grid.dataset.cashLinesKey = key;
    grid.innerHTML = `<div data-cash-payment-lines='1'><datalist id='cashPaymentAccountOptions'>${accountRows.map(account => `<option value='${esc(`${account.accountNumber || account.code} - ${account.accountTitle || account.name || ''}`)}'></option>`).join('')}</datalist><div class='table-wrap'><table><thead><tr><th>Line</th><th>GL Account</th><th>Account Description</th><th>Line Description</th><th>Branch</th><th>Amount</th><th></th></tr></thead><tbody>${cashState.lines.map((line, index) => `<tr data-cash-line='${index}'><td>${index + 1}</td><td><input class='cash-line-account' list='cashPaymentAccountOptions' value='${esc(accountLabel(line.account))}' ${locked ? 'readonly' : ''}></td><td class='cash-line-account-description'>${esc(line.accountDescription || accountRows.find(row => String(row.accountNumber || row.code) === String(line.account))?.accountTitle || '')}</td><td><input class='cash-line-description' value='${esc(line.description)}' ${locked ? 'readonly' : ''}></td><td><select class='cash-line-branch' ${locked ? 'disabled' : ''}>${branchOptions.replace(`value='${esc(line.branch)}'`, `value='${esc(line.branch)}' selected`)}</select></td><td><input class='cash-line-amount' type='number' min='0' step='0.01' value='${Number(line.amount || 0).toFixed(2)}' ${locked ? 'readonly' : ''}></td><td>${locked ? '' : `<button type='button' class='cash-line-remove'>Remove</button>`}</td></tr>`).join('')}</tbody></table></div></div>`;

    if (!locked) {
      grid.querySelectorAll('tr[data-cash-line]').forEach(row => {
        const index = Number(row.dataset.cashLine);
        const accountInput = row.querySelector('.cash-line-account');
        const accountDescription = row.querySelector('.cash-line-account-description');
        const descriptionInput = row.querySelector('.cash-line-description');
        const branchInput = row.querySelector('.cash-line-branch');
        const amountInput = row.querySelector('.cash-line-amount');
        accountInput.addEventListener('input', () => {
          const accountCode = parseAccount(accountInput.value);
          const account = accountRows.find(item => String(item.accountNumber || item.code) === accountCode);
          cashState.lines[index].account = accountCode;
          cashState.lines[index].accountDescription = account?.accountTitle || account?.name || '';
          accountDescription.textContent = cashState.lines[index].accountDescription;
          renderCashFinancialDetails(documentData);
        });
        descriptionInput.addEventListener('input', () => { cashState.lines[index].description = descriptionInput.value; renderCashFinancialDetails(documentData); });
        branchInput.addEventListener('change', () => { cashState.lines[index].branch = branchInput.value; });
        amountInput.addEventListener('input', () => { cashState.lines[index].amount = Number(amountInput.value || 0); recalcCashHeader(documentData); });
        row.querySelector('.cash-line-remove')?.addEventListener('click', () => {
          cashState.lines.splice(index, 1);
          if (!cashState.lines.length) cashState.lines.push({ account:'', accountDescription:'', description:'', branch:defaultBranch, amount:0 });
          grid.dataset.cashLinesKey = '';
          renderCashLines(documentData, true);
          recalcCashHeader(documentData);
        });
      });
    }
    if (!locked) recalcCashHeader(documentData);
    else renderCashFinancialDetails(documentData);
  }

  async function ensureCashPaymentPanel(documentData = null) {
    prepareDocumentsTab('Line Items', 'Add Line');
    const amount = document.getElementById('pAmount');
    if (amount) amount.readOnly = true;
    await renderCashLines(documentData);
    const button = document.getElementById('loadDocs');
    if (button) button.onclick = () => {
      if (documentData?.id && documentData.id !== '<NEW>') return;
      const branch = document.getElementById('pBranch')?.value || '100';
      cashState.lines.push({ account:'', accountDescription:'', description:'', branch, amount:0 });
      const grid = document.getElementById('docsGrid');
      if (grid) grid.dataset.cashLinesKey = '';
      renderCashLines(documentData, true);
    };
  }

  function ensurePrepaymentApproval(documentData) {
    const existing = document.getElementById('pApprovePrepayment');
    const post = document.getElementById('pPost');
    if (!post) return;
    if (documentData?.posted) { post.disabled = true; existing?.remove(); return; }
    if (documentData?.paymentApprovalStatus === 'Pending Payment Approval') {
      post.disabled = true;
      if (existing || !documentData?.id || documentData.id === '<NEW>') return;
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'pApprovePrepayment';
      button.textContent = 'Approve Prepayment';
      button.onclick = async () => {
        if (!confirm('Approve this vendor prepayment for posting?')) return;
        button.disabled = true;
        try {
          await api(`/api/ap/documents/${encodeURIComponent(documentData.id)}/approval-action`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'approve', comments:'Approved for vendor prepayment posting.' }) });
          documentCache.delete(documentData.id);
          location.reload();
        } catch (error) { alert(error.message); button.disabled = false; }
      };
      post.parentElement?.insertBefore(button, post);
    } else {
      existing?.remove();
      post.disabled = false;
    }
  }

  async function enhancePaymentDetail() {
    const match = paymentDetailMatch();
    if (!match || !document.getElementById('pAmount')) return;
    const isNew = ['new', '__new__'].includes(match[1]);
    let data = null;
    let type = requestedType();
    if (!isNew) {
      try { data = await loadDocumentForRoute(); }
      catch (error) { console.error('Unable to load AP payment type', error); return; }
      type = TYPES.has(data?.type) ? data.type : 'Payment';
    }
    type ||= 'Payment';
    const view = document.getElementById('view');
    view.dataset.apPaymentDocumentType = type;
    const input = typeInput();
    if (input) input.value = type === 'Payment' ? (document.getElementById('pMethod')?.value === 'Check' ? 'Check' : 'Payment') : type;
    const title = document.getElementById('title');
    if (title && type !== 'Payment') title.textContent = `${type} ${isNew ? '<NEW>' : data?.id || ''} - ${data?.vendorName || ''}`;
    if (type === 'Prepayment') {
      await ensurePrepaymentPanel(data);
      ensurePrepaymentApproval(data || { paymentApprovalStatus:'Pending Payment Approval', posted:false });
    } else if (type === 'Cash Payment') {
      await ensureCashPaymentPanel(data);
      document.getElementById('pApprovePrepayment')?.remove();
      if (data?.posted && document.getElementById('pPost')) document.getElementById('pPost').disabled = true;
    }
  }

  function rewriteVendorDocumentLinks() {
    document.querySelectorAll('#vendorDocsGrid tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (!cells.length) return;
      const type = [...cells].map(cell => cell.textContent.trim()).find(text => ['Prepayment','Cash Payment'].includes(text));
      if (!type) return;
      const link = row.querySelector("a[href^='/ap/bills/']");
      if (link) link.href = link.getAttribute('href').replace('/ap/bills/', '/ap/payments/');
    });
  }

  document.addEventListener('input', event => {
    if (!isNewPayment() || activeType() !== 'Prepayment') return;
    if (['pVendorNumber','pVendorName'].includes(event.target?.id)) setTimeout(() => renderPrepaymentPos(null, true), 140);
  }, true);
  document.addEventListener('change', event => {
    if (isNewPayment() && activeType() === 'Prepayment' && ['pVendorNumber','pVendorName','pVendorSearch'].includes(event.target?.id)) setTimeout(() => renderPrepaymentPos(null, true), 140);
    if (activeType() === 'Cash Payment' && event.target?.id === 'pCash') renderCashFinancialDetails(null);
  }, true);
  document.addEventListener('click', event => {
    if (isNewPayment() && activeType() === 'Prepayment' && event.target?.closest?.('.erp-lookup-row')) setTimeout(() => renderPrepaymentPos(null, true), 180);
  }, true);

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(async () => {
      queued = false;
      ensurePaymentButtons();
      rewriteVendorDocumentLinks();
      await enhancePaymentDetail();
    });
  }

  window.addEventListener('popstate', () => setTimeout(schedule, 0));
  new MutationObserver(schedule).observe(document.documentElement, { childList:true, subtree:true });
  setTimeout(schedule, 0);
})();
