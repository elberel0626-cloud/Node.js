const JOURNAL_CSV_HEADERS = ['Account', 'Branch', 'Debit', 'Credit', 'Line Description'];
const LEGACY_JOURNAL_CSV_HEADERS = ['Branch', 'Branch Code', 'Account', 'Debit', 'Credit', 'Line Description'];

function normalizeHeader(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase();
}

function headerMatches(actual, expected) {
  const normalized = expected.map(normalizeHeader);
  return actual.length === normalized.length && normalized.every((value, index) => actual[index] === value);
}

export function parseJournalCsv(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows.filter(values => values.some(value => String(value).trim() !== ''));
}

function parseAmount(value, label, rowNumber) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const negativeByParentheses = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[,$\s]/g, '').replace(/^\((.*)\)$/, '$1');
  const amount = Number(cleaned);
  if (!Number.isFinite(amount)) throw new Error(`Row ${rowNumber}: ${label} must be a valid number.`);
  const normalized = negativeByParentheses ? -amount : amount;
  if (normalized < 0) throw new Error(`Row ${rowNumber}: ${label} cannot be negative.`);
  return normalized;
}

export function validateJournalCsvRecords(text) {
  const rows = parseJournalCsv(text);
  if (!rows.length) throw new Error('CSV file is empty.');

  const header = rows[0].map(normalizeHeader);
  const preferredFormat = headerMatches(header, JOURNAL_CSV_HEADERS);
  const legacyFormat = headerMatches(header, LEGACY_JOURNAL_CSV_HEADERS);
  if (!preferredFormat && !legacyFormat) {
    throw new Error(`CSV columns must be: ${JOURNAL_CSV_HEADERS.join(', ')}`);
  }

  const columnCount = preferredFormat ? JOURNAL_CSV_HEADERS.length : LEGACY_JOURNAL_CSV_HEADERS.length;
  const records = rows.slice(1).map((values, index) => {
    const rowNumber = index + 2;
    if (values.length > columnCount && values.slice(columnCount).some(value => String(value).trim())) {
      throw new Error(`Row ${rowNumber}: too many columns. Check commas and quoted text.`);
    }
    const padded = [...values];
    while (padded.length < columnCount) padded.push('');

    let branch = '';
    let branchCode = '';
    let account = '';
    let debitRaw = '';
    let creditRaw = '';
    let lineDescription = '';

    if (preferredFormat) {
      [account, branchCode, debitRaw, creditRaw, lineDescription] = padded.map(value => String(value ?? '').trim());
    } else {
      [branch, branchCode, account, debitRaw, creditRaw, lineDescription] = padded.map(value => String(value ?? '').trim());
    }

    const debit = parseAmount(debitRaw, 'Debit', rowNumber);
    const credit = parseAmount(creditRaw, 'Credit', rowNumber);
    if (!branchCode && !branch) throw new Error(`Row ${rowNumber}: Branch code is required.`);
    if (!account) throw new Error(`Row ${rowNumber}: Account is required.`);
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      throw new Error(`Row ${rowNumber}: enter either Debit or Credit, but not both.`);
    }
    if (lineDescription.length > 255) throw new Error(`Row ${rowNumber}: Line Description cannot exceed 255 characters.`);
    return { rowNumber, branch, branchCode, account, debit, credit, lineDescription };
  });

  if (!records.length) throw new Error('CSV must contain at least one journal line.');
  return records;
}

function getBranchOptions(table) {
  const firstSelect = table.querySelector('.bname');
  if (!firstSelect) return [];
  return [...firstSelect.options].map(option => ({ code: String(option.value).trim(), name: String(option.textContent).trim() }));
}

function getAccountOptions(table) {
  const firstSelect = table.querySelector('.acctSel');
  if (!firstSelect) return [];
  return [...firstSelect.options].map(option => ({ code: String(option.value).trim(), label: String(option.textContent).trim() }));
}

function resolveBranch(record, options) {
  const codeInput = record.branchCode.trim();
  const branchInput = record.branch.trim();
  const byCode = codeInput ? options.find(option => option.code.toLowerCase() === codeInput.toLowerCase()) : null;
  const byBranch = branchInput
    ? options.find(option => option.name.toLowerCase() === branchInput.toLowerCase() || option.code.toLowerCase() === branchInput.toLowerCase())
    : null;

  if (codeInput && !byCode) throw new Error(`Row ${record.rowNumber}: Branch code "${codeInput}" was not found.`);
  if (branchInput && !byBranch) throw new Error(`Row ${record.rowNumber}: Branch "${branchInput}" was not found.`);
  if (byCode && byBranch && byCode.code !== byBranch.code) {
    throw new Error(`Row ${record.rowNumber}: Branch and Branch Code do not match.`);
  }
  const resolved = byCode || byBranch;
  if (!resolved) throw new Error(`Row ${record.rowNumber}: Branch could not be resolved.`);
  return resolved;
}

function resolveAccount(record, options) {
  const raw = record.account.trim();
  const leadingCode = raw.includes(' - ') ? raw.split(' - ')[0].trim() : raw;
  const exact = options.find(option => option.code.toLowerCase() === raw.toLowerCase());
  const byLeadingCode = options.find(option => option.code.toLowerCase() === leadingCode.toLowerCase());
  const byLabel = options.find(option => option.label.toLowerCase() === raw.toLowerCase());
  const resolved = exact || byLeadingCode || byLabel;
  if (!resolved) throw new Error(`Row ${record.rowNumber}: Account "${raw}" was not found or is not allowed for manual journal entries.`);
  return resolved;
}

function currentJournalLinesHaveData(table) {
  return [...table.querySelectorAll('tr')].slice(1).some(row => {
    const debit = Number(row.querySelector('.dr')?.value || 0);
    const credit = Number(row.querySelector('.cr')?.value || 0);
    const description = row.querySelector('.line-desc')?.value?.trim() || '';
    return debit !== 0 || credit !== 0 || description !== '';
  });
}

function setStatus(message, isError = false) {
  const status = document.getElementById('journalCsvStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('err', isError);
}

function applyImportedRecords(records) {
  const table = document.getElementById('jlines');
  const addButton = document.getElementById('addJl');
  if (!table || !addButton) throw new Error('Journal line grid is not available.');

  const branchOptions = getBranchOptions(table);
  const accountOptions = getAccountOptions(table);
  if (!branchOptions.length) throw new Error('Branch list is not available yet.');
  if (!accountOptions.length) throw new Error('Account list is not available yet.');

  const resolved = records.map(record => ({
    ...record,
    resolvedBranch: resolveBranch(record, branchOptions),
    resolvedAccount: resolveAccount(record, accountOptions)
  }));

  if (currentJournalLinesHaveData(table) && !window.confirm('Replace the current journal lines with the imported CSV lines?')) return false;

  [...table.querySelectorAll('tr')].slice(1).forEach(row => row.querySelector('.new-je-remove')?.click());
  resolved.forEach(() => addButton.click());
  installJournalBranchLayout();

  const rows = [...table.querySelectorAll('tr')].slice(1);
  resolved.forEach((record, index) => {
    const row = rows[index];
    const branchSelect = row.querySelector('.bname');
    const branchCode = row.querySelector('.bcode');
    const accountSelect = row.querySelector('.acctSel');
    const debit = row.querySelector('.dr');
    const credit = row.querySelector('.cr');
    const description = row.querySelector('.line-desc');

    branchSelect.value = record.resolvedBranch.code;
    branchCode.value = record.resolvedBranch.code;
    accountSelect.value = record.resolvedAccount.code;
    debit.value = String(record.debit);
    credit.value = String(record.credit);
    description.value = record.lineDescription;
    debit.dispatchEvent(new Event('input', { bubbles: true }));
    credit.dispatchEvent(new Event('input', { bubbles: true }));
  });

  return true;
}

function replaceBranchCodeInput(row, branchNameSelect) {
  const branchCodeControl = row.querySelector('.bcode');
  if (!branchCodeControl || branchCodeControl.tagName === 'SELECT') return;

  const select = document.createElement('select');
  select.className = branchCodeControl.className;
  select.setAttribute('aria-label', 'Branch');
  select.title = 'Branch code';

  [...branchNameSelect.options].forEach(option => {
    const codeOption = document.createElement('option');
    codeOption.value = option.value;
    codeOption.textContent = option.value;
    select.appendChild(codeOption);
  });

  const existingValue = String(branchCodeControl.value || '').trim();
  select.value = [...select.options].some(option => option.value === existingValue) ? existingValue : branchNameSelect.value;
  branchNameSelect.value = select.value;
  select.addEventListener('change', () => {
    branchNameSelect.value = select.value;
  });
  branchCodeControl.replaceWith(select);
}

function installJournalBranchLayout() {
  if (location.pathname !== '/finance/journal/new') return;
  const table = document.getElementById('jlines');
  if (!table) return;

  const headerRow = table.querySelector('tr');
  if (headerRow && !headerRow.dataset.branchLayoutApplied) {
    const cells = [...headerRow.children];
    const branchNameHeader = cells[0];
    const branchCodeHeader = cells[1];
    const accountHeader = cells[2];
    if (branchNameHeader && branchCodeHeader && accountHeader) {
      branchNameHeader.style.display = 'none';
      branchNameHeader.setAttribute('aria-hidden', 'true');
      branchCodeHeader.textContent = 'Branch';
      headerRow.insertBefore(accountHeader, branchCodeHeader);
      headerRow.dataset.branchLayoutApplied = '1';
    }
  }

  [...table.querySelectorAll('tr')].slice(1).forEach(row => {
    const branchNameSelect = row.querySelector('.bname');
    const accountControl = row.querySelector('.acctSel');
    if (!branchNameSelect || !accountControl) return;

    const branchNameCell = branchNameSelect.closest('td');
    if (branchNameCell) {
      branchNameCell.style.display = 'none';
      branchNameCell.setAttribute('aria-hidden', 'true');
    }

    replaceBranchCodeInput(row, branchNameSelect);
    const branchCodeCell = row.querySelector('.bcode')?.closest('td');
    const accountCell = accountControl.closest('td');
    if (branchCodeCell && accountCell && accountCell.nextElementSibling !== branchCodeCell) {
      row.insertBefore(accountCell, branchCodeCell);
    }
  });
}

function installJournalCsvUpload() {
  if (location.pathname !== '/finance/journal/new') return;
  const form = document.getElementById('newJe');
  const addButton = document.getElementById('addJl');
  if (!form || !addButton || document.getElementById('newJeCsvUpload')) return;

  const uploadButton = document.createElement('button');
  uploadButton.type = 'button';
  uploadButton.id = 'newJeCsvUpload';
  uploadButton.title = `Import CSV: ${JOURNAL_CSV_HEADERS.join(', ')}`;
  uploadButton.textContent = '↑ Upload CSV';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'newJeCsvFile';
  fileInput.accept = '.csv,text/csv';
  fileInput.hidden = true;

  const status = document.createElement('span');
  status.id = 'journalCsvStatus';
  status.style.marginLeft = '8px';
  status.style.fontSize = '0.9em';

  addButton.insertAdjacentElement('afterend', uploadButton);
  uploadButton.insertAdjacentElement('afterend', fileInput);
  fileInput.insertAdjacentElement('afterend', status);

  uploadButton.addEventListener('click', () => {
    setStatus('');
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const records = validateJournalCsvRecords(await file.text());
      const applied = applyImportedRecords(records);
      if (applied) setStatus(`${records.length} journal line${records.length === 1 ? '' : 's'} imported.`);
    } catch (error) {
      setStatus(error.message || 'Unable to import CSV.', true);
      window.alert(error.message || 'Unable to import CSV.');
    }
  });
}

function installJournalEnhancements() {
  installJournalBranchLayout();
  installJournalCsvUpload();
}

if (typeof document !== 'undefined') {
  const observer = new MutationObserver(installJournalEnhancements);
  const start = () => {
    installJournalEnhancements();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
