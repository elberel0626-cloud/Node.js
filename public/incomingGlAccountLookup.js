(() => {
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let accountPromise = null;
  let activeAccounts = [];
  let accountByCode = new Map();

  const normalizeAccount = account => ({
    code: String(account.accountNumber ?? account.code ?? '').trim(),
    name: String(account.accountTitle ?? account.name ?? '').trim(),
    active: account.active !== false
  });

  function install() {
    const appFetch = globalThis.fetch.bind(globalThis);

    const loadAccounts = async () => {
      if (!accountPromise) {
        accountPromise = appFetch('/api/finance/chart-of-accounts', { credentials: 'same-origin' })
          .then(async response => {
            if (!response.ok) throw new Error(`Unable to load GL accounts (${response.status})`);
            const rows = await response.json();
            activeAccounts = rows.map(normalizeAccount).filter(account => account.active && account.code);
            accountByCode = new Map(activeAccounts.map(account => [account.code.toLowerCase(), account]));
            return activeAccounts;
          })
          .catch(error => { accountPromise = null; throw error; });
      }
      return accountPromise;
    };

    const periodFromDate = value => /^\d{4}-\d{2}/.test(String(value || '')) ? String(value).slice(0, 7) : '';
    const lineAmount = line => Number(line.lineAmount ?? line.extendedAmount ?? (Number(line.qty ?? line.quantity ?? 0) * Number(line.unitPrice ?? 0)) ?? 0);

    const synchronizeDraftBill = async payload => {
      const extracted = payload?.extracted;
      if (!extracted || !Array.isArray(extracted.lines)) return payload;
      try { await loadAccounts(); } catch {}
      const vendorId = String(payload.vendorMatch?.vendorId ?? extracted.vendorNumber ?? '').trim();
      const vendorName = String(payload.vendorMatch?.vendorName ?? extracted.vendorName ?? '').trim();
      const amount = Number(extracted.grossInvoiceAmount ?? extracted.totalAmount ?? 0);
      const lines = extracted.lines.map(line => {
        const code = String(line.glAccountSuggestion ?? '').trim();
        const account = accountByCode.get(code.toLowerCase());
        if (account) {
          line.glAccountSuggestion = account.code;
          line.accountDescription = account.name;
        }
        const qty = Number(line.qty ?? line.quantity ?? 1);
        const unitCost = Number(line.unitPrice ?? line.unitCost ?? line.extendedAmount ?? 0);
        const extendedCost = Number(line.extendedAmount ?? (qty * unitCost));
        return {
          inventoryId: line.itemCode ?? line.inventoryId ?? '',
          description: line.lineDescription ?? line.description ?? line.itemCode ?? line.inventoryId ?? '',
          qty,
          uom: line.uom || 'EA',
          unitCost,
          extendedCost,
          amount: lineAmount(line),
          expenseAccount: account?.code || code,
          accountDescription: account?.name || line.accountDescription || '',
          branch: line.branch || extracted.branch || '100',
          warehouse: line.warehouse || 'MAIN',
          location: line.location || 'MAIN-A1',
          poNumber: extracted.purchaseOrderNumber || extracted.poNumber || ''
        };
      });
      payload.draftBill = {
        ...(payload.draftBill || {}),
        vendorId,
        vendorName,
        date: extracted.invoiceDate || '',
        postDate: extracted.invoiceDate || '',
        postPeriod: periodFromDate(extracted.invoiceDate),
        dueDate: extracted.dueDate || '',
        terms: extracted.paymentTerms || extracted.terms || '',
        vendorRef: extracted.invoiceNumber || '',
        invoiceNumber: extracted.invoiceNumber || '',
        amount,
        balance: amount,
        branch: extracted.branch || '100',
        department: extracted.department || '',
        currency: extracted.currency || 'USD',
        description: extracted.description || 'Created from Incoming Documents recognition',
        lines
      };
      return payload;
    };

    globalThis.fetch = async (input, options = {}) => {
      const method = String(options.method || input?.method || 'GET').toUpperCase();
      let pathname = '';
      try { pathname = new URL(typeof input === 'string' ? input : input.url, location.origin).pathname; } catch {}
      if (method === 'PUT' && /^\/api\/ap\/incoming-documents\/[^/]+$/.test(pathname) && typeof options.body === 'string') {
        try {
          const payload = JSON.parse(options.body);
          await synchronizeDraftBill(payload);
          options = { ...options, body: JSON.stringify(payload) };
        } catch {}
      }
      return appFetch(input, options);
    };

    const descriptionTargetFor = input => {
      const row = input.closest('tr'), table = row?.closest('table');
      if (!row || !table) return null;
      const headers = [...table.querySelectorAll('tr:first-child th')].map(th => th.textContent.trim().toLowerCase());
      const index = headers.findIndex(text => text === 'account description');
      return index >= 0 ? row.cells[index] : null;
    };

    const ensureNameDisplay = input => {
      const cell = input.closest('td');
      if (!cell) return null;
      const existing = cell.querySelector('.incoming-gl-account-name');
      if (existing) return existing;
      const small = document.createElement('small');
      small.className = 'incoming-gl-account-name';
      small.style.display = 'block';
      small.style.marginTop = '3px';
      cell.appendChild(small);
      return small;
    };

    const enhanceInput = input => {
      if (!input || input.dataset.glLookupEnhanced === '1') return;
      input.dataset.glLookupEnhanced = '1';
      input.classList.add('search-input');
      input.autocomplete = 'off';
      input.spellcheck = false;
      const descriptionCell = descriptionTargetFor(input);
      const nameDisplay = descriptionCell ? null : ensureNameDisplay(input);
      const panel = document.createElement('div');
      panel.className = 'erp-lookup-panel hidden incoming-gl-account-suggestions';
      const list = document.createElement('div');
      list.className = 'erp-lookup-list';
      panel.appendChild(list);
      document.body.appendChild(panel);
      let shown = [], active = -1, choosing = false;

      const place = () => {
        if (!input.isConnected) return panel.remove();
        const rect = input.getBoundingClientRect();
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.bottom + 2}px`;
        panel.style.width = `${Math.max(rect.width, 420)}px`;
      };
      const close = () => { panel.classList.add('hidden'); active = -1; };
      const showName = account => {
        if (descriptionCell) descriptionCell.textContent = account?.name || '';
        if (nameDisplay) nameDisplay.textContent = account?.name || '';
        input.title = account ? `${account.code} — ${account.name}` : '';
      };
      const exactAccount = () => accountByCode.get(String(input.value || '').trim().toLowerCase()) || null;
      const syncValidity = ({ requireValue = false } = {}) => {
        const value = String(input.value || '').trim();
        const account = exactAccount();
        const invalid = (requireValue && !value) || (value && !account);
        input.setCustomValidity(invalid ? 'Select a valid active GL account from the account list.' : '');
        if (account) showName(account); else if (!value) showName(null);
        return !invalid;
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
        let accounts;
        try { accounts = await loadAccounts(); } catch { return; }
        if (!input.isConnected) return panel.remove();
        const q = String(query || '').trim().toLowerCase();
        shown = (q ? accounts.filter(account => account.code.toLowerCase().includes(q) || account.name.toLowerCase().includes(q)) : accounts).slice(0, 60);
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

      input.addEventListener('focus', () => render(exactAccount() ? '' : input.value));
      input.addEventListener('input', () => {
        if (choosing) return;
        active = -1;
        input.dataset.selectedGlAccount = '';
        const account = exactAccount();
        showName(account);
        input.setCustomValidity('');
        render(input.value);
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (panel.classList.contains('hidden')) render(input.value);
          active = event.key === 'ArrowDown' ? Math.min(active + 1, shown.length - 1) : Math.max(active - 1, 0);
          list.querySelectorAll('button').forEach((row, index) => row.classList.toggle('active', index === active));
        } else if (event.key === 'Enter' && active >= 0 && shown[active]) {
          event.preventDefault(); pick(shown[active]);
        } else if (event.key === 'Escape') {
          event.preventDefault(); close();
        }
      });
      input.addEventListener('blur', () => setTimeout(() => { syncValidity(); close(); }, 120));
      window.addEventListener('resize', place);
      window.addEventListener('scroll', place, true);
      loadAccounts().then(() => syncValidity()).catch(() => {});
    };

    const enhanceRoot = root => {
      root.querySelectorAll?.("input[data-line-field='glAccountSuggestion']").forEach(enhanceInput);
      root.querySelectorAll?.('table').forEach(table => {
        const headers = [...table.querySelectorAll('tr:first-child th')].map(th => th.textContent.trim().toLowerCase());
        const accountIndex = headers.findIndex(text => text === 'account' || text === 'gl account');
        if (accountIndex < 0) return;
        [...table.querySelectorAll('tr')].slice(1).forEach(row => enhanceInput(row.cells[accountIndex]?.querySelector('input')));
      });
    };

    let scanQueued = false;
    const queueScan = () => {
      if (scanQueued) return;
      scanQueued = true;
      queueMicrotask(() => { scanQueued = false; enhanceRoot(document); });
    };
    const observer = new MutationObserver(queueScan);
    observer.observe(document.body, { childList: true, subtree: true });
    enhanceRoot(document);

    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('.incoming-gl-account-suggestions') && !event.target.matches?.("input[data-gl-lookup-enhanced='1']")) {
        document.querySelectorAll('.incoming-gl-account-suggestions').forEach(panel => panel.classList.add('hidden'));
      }
    });

    document.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || !['createBill','saveReview','saveNextReview','saveDraft','saveNext','approveIncoming'].includes(button.id)) return;
      const scope = button.closest('.incoming-review-screen') || document.querySelector('#incomingReview');
      if (!scope) return;
      const requireValue = button.id === 'createBill';
      const inputs = [...scope.querySelectorAll("input[data-gl-lookup-enhanced='1']")];
      const invalid = inputs.find(input => {
        const value = String(input.value || '').trim();
        const account = accountByCode.get(value.toLowerCase());
        const bad = (requireValue && !value) || (value && !account);
        input.setCustomValidity(bad ? 'Select a valid active GL account from the account list.' : '');
        return bad;
      });
      if (invalid) {
        event.preventDefault();
        event.stopImmediatePropagation();
        invalid.reportValidity();
        invalid.focus();
      }
    }, true);
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
