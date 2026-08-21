(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = value => Number(value || 0).toFixed(2);
  let accountPromise = null;
  let accounts = [];
  let accountByCode = new Map();
  let currentDocument = null;
  let enhancedForm = null;

  function install() {
    const appFetch = globalThis.fetch.bind(globalThis);

    const loadAccounts = async () => {
      if (!accountPromise) {
        accountPromise = appFetch('/api/finance/chart-of-accounts', { credentials: 'same-origin' })
          .then(async response => {
            if (!response.ok) throw new Error(`Unable to load GL accounts (${response.status})`);
            const rows = await response.json();
            accounts = rows.map(row => ({
              code: String(row.accountNumber ?? row.code ?? '').trim(),
              name: String(row.accountTitle ?? row.name ?? '').trim(),
              active: row.active !== false
            })).filter(row => row.active && row.code);
            accountByCode = new Map(accounts.map(row => [row.code.toLowerCase(), row]));
            return accounts;
          })
          .catch(error => { accountPromise = null; throw error; });
      }
      return accountPromise;
    };

    const paymentForm = () => document.getElementById('paymentForm');
    const paymentStatus = () => {
      const form = paymentForm();
      if (!form) return '';
      const label = [...form.querySelectorAll('label')].find(node => node.textContent.trim().startsWith('Status'));
      return String(label?.querySelector('input')?.value || '').trim();
    };
    const isReadOnly = () => ['Open','Closed','Voided'].includes(paymentStatus());
    const cashAccount = () => String(document.getElementById('paymentCashAccount')?.value || '').trim().split(/\s+/)[0];
    const totalAvailable = () => Number(document.getElementById('paymentAmount')?.value || 0) + Number(document.getElementById('financeChargeAmount')?.value || 0) + Number(document.getElementById('writeOffAmount')?.value || 0);
    const arOrderApplied = () => [...document.querySelectorAll('#paymentForm .doc-amt,#paymentForm .so-amt')].reduce((sum, input) => sum + Number(input.value || 0), 0);
    const glApplied = () => [...document.querySelectorAll('#paymentGlApplicationsTbl .payment-gl-amount')].reduce((sum, input) => sum + Number(input.value || 0), 0);

    const collectGlApplications = () => [...document.querySelectorAll('#paymentGlApplicationsTbl tbody tr[data-gl-row]')].map(row => ({
      account: String(row.querySelector('.payment-gl-account')?.value || '').trim().split(/\s+/)[0],
      amount: Number(row.querySelector('.payment-gl-amount')?.value || 0),
      description: String(row.querySelector('.payment-gl-description')?.value || '').trim()
    })).filter(row => row.account || row.amount || row.description);

    const setSummary = ({ arAmount, glAmount, remaining }) => {
      const ar = document.getElementById('paymentGlArAmount');
      const gl = document.getElementById('paymentGlAppliedAmount');
      const rem = document.getElementById('paymentGlRemainingAmount');
      if (ar) ar.textContent = money(arAmount);
      if (gl) gl.textContent = money(glAmount);
      if (rem) rem.textContent = money(remaining);
    };

    const syncTotals = () => {
      const glAmount = glApplied();
      if (isReadOnly() && currentDocument) {
        const historicalAr = (currentDocument.applications || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
        setSummary({ arAmount: historicalAr, glAmount, remaining: Number(currentDocument.unappliedBalance || 0) });
        return;
      }
      const arAmount = arOrderApplied();
      const remaining = totalAvailable() - arAmount - glAmount;
      setSummary({ arAmount, glAmount, remaining });
      const applied = document.getElementById('appliedAmount');
      const available = document.getElementById('availableBal');
      if (applied) applied.value = money(arAmount + glAmount);
      if (available) available.value = money(remaining);
      const summary = document.getElementById('paymentGlValidation');
      if (summary) {
        summary.textContent = remaining < -0.005 ? 'Total AR, sales order, and GL applications exceed the available payment amount.' : '';
        summary.classList.toggle('err', remaining < -0.005);
      }
    };

    const validateGlApplications = () => {
      const rows = [...document.querySelectorAll('#paymentGlApplicationsTbl tbody tr[data-gl-row]')];
      let message = '';
      rows.forEach((row, index) => {
        const accountInput = row.querySelector('.payment-gl-account');
        const amountInput = row.querySelector('.payment-gl-amount');
        const description = row.querySelector('.payment-gl-description');
        const code = String(accountInput?.value || '').trim().split(/\s+/)[0];
        const amount = Number(amountInput?.value || 0);
        const touched = Boolean(code || amount || String(description?.value || '').trim());
        const account = accountByCode.get(code.toLowerCase());
        let accountError = '';
        let amountError = '';
        if (touched && !code) accountError = `GL account is required on line ${index + 1}.`;
        else if (code && !account) accountError = `Select a valid active GL account on line ${index + 1}.`;
        else if (code && cashAccount() && code === cashAccount()) accountError = 'The Apply to GL account cannot be the same as the payment cash account.';
        if (touched && (!Number.isFinite(amount) || amount <= 0)) amountError = `GL amount must be greater than $0.00 on line ${index + 1}.`;
        accountInput?.setCustomValidity(accountError);
        amountInput?.setCustomValidity(amountError);
        if (!message) message = accountError || amountError;
      });
      if (!message && arOrderApplied() + glApplied() > totalAvailable() + 0.005) message = 'Total AR, sales order, and GL applications cannot exceed the available payment amount.';
      return message;
    };

    const errorResponse = message => new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });

    globalThis.fetch = async (input, options = {}) => {
      const method = String(options.method || input?.method || 'GET').toUpperCase();
      let pathname = '';
      try { pathname = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname; } catch {}
      const isPaymentSave = paymentForm() && typeof options.body === 'string' && ((method === 'POST' && pathname === '/api/ar/documents') || (method === 'PUT' && /^\/api\/ar\/documents\/[^/]+$/.test(pathname)));
      if (isPaymentSave) {
        try {
          const payload = JSON.parse(options.body);
          if (payload.type === 'Payment') {
            try { await loadAccounts(); } catch (error) { return errorResponse(error.message || 'Unable to load GL accounts.'); }
            const validationError = validateGlApplications();
            if (validationError) {
              const invalid = document.querySelector('#paymentGlApplicationsTbl :invalid');
              invalid?.reportValidity();
              return errorResponse(validationError);
            }
            payload.glApplications = collectGlApplications().filter(row => row.account && row.amount > 0);
            options = { ...options, body: JSON.stringify(payload) };
          }
        } catch {}
      }
      return appFetch(input, options);
    };

    const addLookup = input => {
      if (!input || input.dataset.paymentGlLookup === '1' || input.readOnly) return;
      input.dataset.paymentGlLookup = '1';
      input.classList.add('search-input');
      input.autocomplete = 'off';
      input.spellcheck = false;
      const row = input.closest('tr');
      const nameCell = row?.querySelector('.payment-gl-account-name');
      const panel = document.createElement('div');
      panel.className = 'erp-lookup-panel hidden payment-gl-account-suggestions';
      const list = document.createElement('div');
      list.className = 'erp-lookup-list';
      panel.appendChild(list);
      document.body.appendChild(panel);
      let shown = [];
      let active = -1;
      let choosing = false;

      const exact = () => accountByCode.get(String(input.value || '').trim().toLowerCase()) || null;
      const place = () => {
        if (!input.isConnected) return panel.remove();
        const rect = input.getBoundingClientRect();
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.bottom + 2}px`;
        panel.style.width = `${Math.max(rect.width, 420)}px`;
      };
      const close = () => { panel.classList.add('hidden'); active = -1; };
      const showName = account => {
        if (nameCell) nameCell.textContent = account?.name || '';
        input.title = account ? `${account.code} — ${account.name}` : '';
      };
      const pick = account => {
        choosing = true;
        input.value = account.code;
        input.dataset.selectedGlAccount = account.code;
        input.setCustomValidity('');
        showName(account);
        close();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        choosing = false;
      };
      const render = async query => {
        let rows;
        try { rows = await loadAccounts(); } catch { return; }
        if (!input.isConnected) return panel.remove();
        const q = String(query || '').trim().toLowerCase();
        shown = (q ? rows.filter(account => account.code.toLowerCase().includes(q) || account.name.toLowerCase().includes(q)) : rows).slice(0, 60);
        list.innerHTML = shown.length
          ? shown.map((account, index) => `<button type='button' class='erp-lookup-row ${index === active ? 'active' : ''}' data-index='${index}'><span class='erp-lookup-id'>${escapeHtml(account.code)}</span><span aria-hidden='true'> — </span><span class='erp-lookup-name'>${escapeHtml(account.name)}</span></button>`).join('')
          : "<div class='erp-lookup-empty'>No matching active GL accounts found</div>";
        list.querySelectorAll('button').forEach((button, index) => {
          button.onpointerdown = event => event.preventDefault();
          button.onclick = () => pick(shown[index]);
        });
        panel.classList.remove('hidden');
        place();
      };

      input.addEventListener('focus', () => render(exact() ? '' : input.value));
      input.addEventListener('input', () => {
        if (choosing) return;
        active = -1;
        input.dataset.selectedGlAccount = '';
        const account = exact();
        showName(account);
        input.setCustomValidity('');
        render(input.value);
        syncTotals();
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (panel.classList.contains('hidden')) render(input.value);
          active = event.key === 'ArrowDown' ? Math.min(active + 1, shown.length - 1) : Math.max(active - 1, 0);
          list.querySelectorAll('button').forEach((node, index) => node.classList.toggle('active', index === active));
        } else if (event.key === 'Enter' && active >= 0 && shown[active]) {
          event.preventDefault();
          pick(shown[active]);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      });
      input.addEventListener('blur', () => setTimeout(() => {
        const account = exact();
        const value = String(input.value || '').trim();
        input.setCustomValidity(value && !account ? 'Select a valid active GL account from the account list.' : '');
        showName(account);
        close();
      }, 120));
      window.addEventListener('resize', place);
      window.addEventListener('scroll', place, true);
      loadAccounts().then(() => showName(exact())).catch(() => {});
    };

    const rowHtml = (entry = {}, readonly = false) => {
      const account = String(entry.account || entry.accountNumber || entry.glAccount || '').trim();
      const accountName = String(entry.accountTitle || entry.accountName || '').trim();
      return `<tr data-gl-row='1'><td><input class='payment-gl-account search-input' value='${escapeHtml(account)}' ${readonly ? 'readonly' : ''}></td><td class='payment-gl-account-name'>${escapeHtml(accountName)}</td><td><input class='payment-gl-amount' type='number' min='0' step='0.01' value='${money(entry.amount)}' ${readonly ? 'readonly' : ''}></td><td><input class='payment-gl-description' value='${escapeHtml(entry.description || '')}' ${readonly ? 'readonly' : ''}></td><td>${readonly ? '' : "<button type='button' class='payment-gl-remove'>Remove</button>"}</td></tr>`;
    };

    const bindRows = () => {
      document.querySelectorAll('#paymentGlApplicationsTbl .payment-gl-account').forEach(addLookup);
      document.querySelectorAll('#paymentGlApplicationsTbl .payment-gl-amount,#paymentGlApplicationsTbl .payment-gl-description').forEach(input => {
        if (input.dataset.paymentGlBound === '1') return;
        input.dataset.paymentGlBound = '1';
        input.addEventListener('input', syncTotals);
      });
      document.querySelectorAll('#paymentGlApplicationsTbl .payment-gl-remove').forEach(button => {
        if (button.dataset.paymentGlBound === '1') return;
        button.dataset.paymentGlBound = '1';
        button.onclick = () => {
          button.closest('tr')?.remove();
          if (!document.querySelector('#paymentGlApplicationsTbl tbody tr') && !isReadOnly()) addRow();
          syncTotals();
        };
      });
    };

    const addRow = (entry = {}) => {
      const body = document.querySelector('#paymentGlApplicationsTbl tbody');
      if (!body || isReadOnly()) return;
      body.insertAdjacentHTML('beforeend', rowHtml(entry, false));
      bindRows();
      syncTotals();
    };

    const renderRows = entries => {
      const body = document.querySelector('#paymentGlApplicationsTbl tbody');
      if (!body) return;
      const readonly = isReadOnly();
      const rows = Array.isArray(entries) ? entries : [];
      body.innerHTML = rows.map(entry => rowHtml(entry, readonly)).join('');
      if (!rows.length && !readonly) body.innerHTML = rowHtml({}, false);
      bindRows();
      syncTotals();
    };

    const enhanceFinancialGridNames = async () => {
      const table = document.getElementById('payFinGrid');
      if (!table || table.dataset.glNamesEnhanced === '1') return;
      table.dataset.glNamesEnhanced = '1';
      try { await loadAccounts(); } catch { return; }
      const headers = [...table.querySelectorAll('tr:first-child th')].map(th => th.textContent.trim().toLowerCase());
      const accountIndex = headers.findIndex(text => text === 'account');
      const nameIndex = headers.findIndex(text => text === 'account name');
      if (accountIndex < 0 || nameIndex < 0) return;
      [...table.querySelectorAll('tr')].slice(1).forEach(row => {
        const code = String(row.cells[accountIndex]?.textContent || '').trim();
        const account = accountByCode.get(code.toLowerCase());
        if (account && row.cells[nameIndex]) row.cells[nameIndex].textContent = account.name;
      });
    };

    const readPaymentDocument = async form => {
      if (location.pathname === '/ar/payments/new') return null;
      const match = location.pathname.match(/^\/ar\/doc\/([^/]+)$/);
      if (!match) return null;
      try {
        const response = await appFetch(`/api/ar/documents/${encodeURIComponent(decodeURIComponent(match[1]))}`, { credentials: 'same-origin' });
        if (!response.ok) return null;
        const document = await response.json();
        return form.isConnected && document.type === 'Payment' ? document : null;
      } catch { return null; }
    };

    const enhancePaymentForm = async () => {
      const form = paymentForm();
      if (!form || form === enhancedForm || form.dataset.paymentGlApplicationsEnhanced === '1') {
        if (form) enhanceFinancialGridNames();
        return;
      }
      enhancedForm = form;
      form.dataset.paymentGlApplicationsEnhanced = '1';
      const tabs = form.querySelector('.erp-tabs');
      const docsPane = document.getElementById('docs-tab');
      if (!tabs || !docsPane) return;

      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tab';
      tab.dataset.tab = 'gl-tab';
      tab.textContent = 'Apply to GL Account';
      const docsTab = tabs.querySelector("[data-tab='docs-tab']");
      docsTab ? docsTab.insertAdjacentElement('afterend', tab) : tabs.appendChild(tab);

      const pane = document.createElement('div');
      pane.id = 'gl-tab';
      pane.className = 'tab-pane hidden';
      pane.innerHTML = `<section class='panel'><div class='header-row'><div><h4>Apply Payment to GL Account</h4><p>Use this tab when all or part of a customer payment should credit a GL account directly instead of Accounts Receivable.</p></div><button type='button' id='addPaymentGlLine'>Add GL Line</button></div><div class='table-wrap'><table id='paymentGlApplicationsTbl'><thead><tr><th>GL Account</th><th>Account Description</th><th>Amount</th><th>Line Description</th><th>Actions</th></tr></thead><tbody></tbody></table></div><div class='panel'><strong>Application Summary</strong><p>Applied to AR / Sales Orders: $<span id='paymentGlArAmount'>0.00</span> &nbsp; | &nbsp; Applied to GL: $<span id='paymentGlAppliedAmount'>0.00</span> &nbsp; | &nbsp; Remaining: $<span id='paymentGlRemainingAmount'>0.00</span></p><p id='paymentGlValidation' class='err'></p></div></section>`;
      docsPane.insertAdjacentElement('afterend', pane);

      if (isReadOnly()) document.getElementById('addPaymentGlLine')?.setAttribute('disabled', 'disabled');
      const addButton = document.getElementById('addPaymentGlLine');
      if (addButton) addButton.onclick = () => addRow();

      try { await loadAccounts(); } catch {}
      const loadedDocument = await readPaymentDocument(form);
      if (!form.isConnected || form !== paymentForm()) return;
      currentDocument = loadedDocument;
      renderRows(currentDocument?.glApplications || []);
      enhanceFinancialGridNames();
    };

    document.addEventListener('click', event => {
      const tab = event.target.closest('#paymentForm .erp-tabs .tab');
      if (tab) queueMicrotask(() => document.getElementById('gl-tab')?.classList.toggle('hidden', tab.dataset.tab !== 'gl-tab'));
      if (!event.target.closest('.payment-gl-account-suggestions') && !event.target.matches?.("input[data-payment-gl-lookup='1']")) {
        document.querySelectorAll('.payment-gl-account-suggestions').forEach(panel => panel.classList.add('hidden'));
      }
    });

    document.addEventListener('input', event => {
      if (event.target.matches?.('#paymentAmount,#financeChargeAmount,#writeOffAmount,.doc-amt,.so-amt')) queueMicrotask(syncTotals);
    });
    document.addEventListener('change', event => {
      if (event.target.matches?.('#paymentCashAccount,.doc-pick,.so-pick')) queueMicrotask(syncTotals);
    });

    const observer = new MutationObserver(() => {
      queueMicrotask(() => {
        enhancePaymentForm();
        enhanceFinancialGridNames();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    enhancePaymentForm();
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
