(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = value => Number(value || 0).toLocaleString(undefined, { style:'currency', currency:'USD' });
  const num = value => Number(value || 0);
  const request = async (url, options = {}) => {
    const response = await fetch(url, { credentials:'same-origin', ...options });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error:text }; }
    if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
    return data;
  };

  const style = document.createElement('style');
  style.textContent = `
    .ap-po-pro-shell{display:grid;gap:14px}.ap-po-pro-selector{display:grid;grid-template-columns:minmax(220px,.7fr) minmax(320px,1.3fr);gap:12px;align-items:end}
    .ap-po-pro-selector label{display:flex;flex-direction:column;gap:5px}.ap-po-search-wrap{position:relative}.ap-po-search-wrap input{width:100%}
    .ap-po-results{position:absolute;z-index:40;left:0;right:0;top:100%;max-height:280px;overflow:auto;background:var(--surface,#fff);border:1px solid var(--border,#d0d5dd);box-shadow:0 8px 24px rgba(0,0,0,.13)}
    .ap-po-result{display:grid;grid-template-columns:1fr auto;gap:10px;width:100%;text-align:left;padding:9px 10px;border:0;border-bottom:1px solid var(--border,#e5e7eb);background:transparent}.ap-po-result:hover,.ap-po-result:focus{background:rgba(127,127,127,.08)}
    .ap-po-result small{display:block;opacity:.7;margin-top:2px}.ap-po-pro-hint{font-size:12px;opacity:.72}.ap-po-pro-status{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .ap-po-check{font-weight:700}.ap-po-check.pass{color:#18794e}.ap-po-check.fail{color:#b42318}.ap-po-check.na{opacity:.7}.ap-po-readonly-check{width:15px;height:15px;vertical-align:middle}
    .ap-po-match-grid{width:100%;border-collapse:collapse}.ap-po-match-grid th,.ap-po-match-grid td{padding:7px 8px;vertical-align:top;white-space:nowrap}.ap-po-match-grid td.description{white-space:normal;min-width:180px}
    .ap-po-receipts{margin-top:10px}.ap-po-receipts table{width:100%}.ap-po-banner{padding:10px 12px;border:1px solid var(--border,#d0d5dd);border-radius:6px}.ap-po-banner.blocked{border-color:#f0b4ad}.ap-po-banner.ready{border-color:#a6d8c2}
    .ap-po-legacy-hidden{display:none!important}@media(max-width:850px){.ap-po-pro-selector{grid-template-columns:1fr}.ap-po-match-grid{font-size:12px}}
  `;
  document.head.appendChild(style);

  let activePath = '';
  let selectedPo = null;
  let currentReceipts = [];
  let searchTimer = null;
  let renderTimer = null;
  let applyingPo = false;
  const pathMatch = () => location.pathname.match(/^\/ap\/(?:bills|approvals)\/([^/]+)$/);
  const currentBillId = () => pathMatch()?.[1] ? decodeURIComponent(pathMatch()[1]) : '';
  const isNewBill = () => ['new','__new__'].includes(currentBillId());
  const currentVendorId = () => String(document.getElementById('bvend')?.value || document.getElementById('bVendorNumber')?.value || '').trim().split(/\s+—\s+|\s+-\s+/)[0].trim();
  const currentVendorName = () => String(document.getElementById('bVendorName')?.value || '').trim();
  const billLineRows = () => [...document.querySelectorAll('#billLines .compact-ap-lines tr')].slice(1);
  const billLinesFromDom = () => billLineRows().map(row => ({
    inventoryId: row.querySelector('.ln-inv')?.value || '',
    description: row.querySelector('.ln-desc')?.value || '',
    qty: num(row.querySelector('.ln-qty')?.value),
    unitCost: num(row.querySelector('.ln-cost')?.value),
    poNumber: row.querySelector('.ln-po')?.value || '',
    receiptNumber: row.querySelector('.ln-rcpt')?.value || ''
  }));
  const lineMatch = (poLine, invoiceLines, index) => invoiceLines.find(line => line.poNumber === selectedPo?.poNumber && line.inventoryId && line.inventoryId === poLine.inventoryId) || invoiceLines[index] || {};
  const tolerancePass = (invoiceUnit, poUnit, qty, prefs) => {
    const diff = Math.abs(num(invoiceUnit) - num(poUnit));
    const pct = num(poUnit) ? diff / Math.abs(num(poUnit)) * 100 : (diff ? 100 : 0);
    const amount = diff * Math.max(0, num(qty));
    return pct <= num(prefs?.general?.priceTolerancePct) || amount <= num(prefs?.general?.priceToleranceAmount);
  };
  const statusToken = (pass, na = false, label = '') => `<span class='ap-po-check ${na?'na':pass?'pass':'fail'}'>${na?'N/A ✓':pass?'✓':'✕'}${label?` ${esc(label)}`:''}</span>`;

  function hideLegacyControls(panel) {
    panel.querySelector('.po-match-actions')?.classList.add('ap-po-legacy-hidden');
    const actions = document.getElementById('bActions');
    if (actions) [...actions.options].forEach(option => { if (['add-po','add-receipt','add-receipt-line'].includes(option.value)) option.remove(); });
  }

  async function lookupPos(term = '') {
    const vendorId = currentVendorId();
    if (!vendorId) return [];
    const params = new URLSearchParams({ vendorNumber:vendorId });
    if (term.trim()) params.set('q', term.trim());
    return request('/api/purchase-orders/lookup?' + params.toString());
  }

  async function loadReceipts(poNumber) {
    if (!poNumber) return [];
    const params = new URLSearchParams({ poNumber, vendorNumber:currentVendorId() });
    try { return await request('/api/purchase-receipts/lookup?' + params.toString()); }
    catch { return []; }
  }

  function allocationForReceipts(receipts, invoiceLines, poLines) {
    const remainingByKey = new Map();
    poLines.forEach((poLine, index) => {
      const invoice = lineMatch(poLine, invoiceLines, index);
      remainingByKey.set(String(poLine.poLineId || poLine.inventoryId || index), Math.max(0, num(invoice.qty)));
    });
    const allocations = [];
    receipts.forEach(receipt => (receipt.lines || []).forEach((line, index) => {
      const key = String(line.poLineId || line.inventoryId || index);
      const need = remainingByKey.get(key) ?? 0;
      const available = Math.max(0, num(line.qtyRemaining ?? line.qtyAvailable ?? line.qtyReceived));
      const applied = Math.min(need, available);
      if (applied > 0) remainingByKey.set(key, need - applied);
      allocations.push({ receipt, line, applied, available });
    }));
    return allocations;
  }

  async function renderWorkspace() {
    if (!pathMatch()) return;
    const panel = document.getElementById('purchaseOrder');
    if (!panel) return;
    hideLegacyControls(panel);
    const vendorId = currentVendorId();
    const vendorName = currentVendorName();
    const existingPoNo = billLinesFromDom().find(line => line.poNumber)?.poNumber || '';
    if (selectedPo && selectedPo.vendorId && vendorId && String(selectedPo.vendorId) !== String(vendorId)) selectedPo = null;
    if (!selectedPo && existingPoNo && vendorId) {
      try { selectedPo = (await lookupPos(existingPoNo)).find(row => String(row.poNumber) === String(existingPoNo)) || null; } catch {}
    }
    if (selectedPo) currentReceipts = await loadReceipts(selectedPo.poNumber);
    let host = panel.querySelector('#apPoProfessionalWorkspace');
    if (!host) { host = document.createElement('section'); host.id = 'apPoProfessionalWorkspace'; host.className = 'panel ap-po-pro-shell'; panel.prepend(host); }
    const invoiceLines = billLinesFromDom();
    let prefs = {}, savedDoc = null;
    try { prefs = (await request('/api/purchase-orders/preferences')).preferences || {}; } catch {}
    if (!isNewBill()) { try { savedDoc = await request('/api/ap/documents/' + encodeURIComponent(currentBillId())); } catch {} }
    const serverLines = savedDoc?.threeWayMatch?.lines || [];
    const serverApplicable = !!selectedPo && serverLines.some(line => String(line.poNumber) === String(selectedPo.poNumber));
    const poLines = selectedPo?.lines || [];
    const allocations = allocationForReceipts(currentReceipts, invoiceLines, poLines);
    let allReady = !!selectedPo && poLines.length > 0;
    const lineRows = poLines.map((poLine, index) => {
      const invoice = lineMatch(poLine, invoiceLines, index);
      const invoiceQty = num(invoice.qty);
      const available = num(poLine.qtyRemaining ?? poLine.qtyAvailableToBill);
      const serverLine = serverApplicable ? serverLines.find(line => String(line.poLineId) === String(poLine.poLineId) || (line.inventoryId && line.inventoryId === poLine.inventoryId)) : null;
      const poOk = !!poLine.poLineId && !!selectedPo?.poNumber;
      const approvedShort = serverLine?.approvedShort === true;
      const receiptOk = poLine.requiresReceipt === false || available + 0.000001 >= invoiceQty || approvedShort;
      const invoiceOk = invoiceQty > 0 && (serverLine ? (serverLine.priceWithinTolerance !== false || serverLine.postable === true) : tolerancePass(invoice.unitCost, poLine.unitCost, invoiceQty, prefs));
      allReady = allReady && poOk && receiptOk && invoiceOk;
      return `<tr><td>${index+1}</td><td>${statusToken(poOk)}</td><td>${statusToken(receiptOk,poLine.requiresReceipt===false,approvedShort?'Approved shortage':'')}</td><td>${statusToken(invoiceOk)}</td><td>${esc(poLine.inventoryId||'')}</td><td class='description'>${esc(poLine.description||invoice.description||'')}</td><td>${num(poLine.qtyReceived)}</td><td>${num(poLine.qtyBilled)}</td><td>${available}</td><td><b>${invoiceQty}</b></td><td>${money(poLine.unitCost)}</td><td>${money(invoice.unitCost)}</td></tr>`;
    }).join('');
    if (serverApplicable && savedDoc?.threeWayMatch) allReady = savedDoc.threeWayMatch.postable === true;
    const receiptRows = allocations.map(({receipt,line,applied,available}) => `<tr><td><input class='ap-po-readonly-check' type='checkbox' ${applied>0?'checked':''} disabled title='Validated by the ERP receipt record'></td><td><a class='link' href='/purchase-orders/receipts/${encodeURIComponent(receipt.receiptNumber||receipt.id||'')}'>${esc(receipt.receiptNumber||receipt.id||'')}</a></td><td>${esc(line.inventoryId||'')}</td><td>${num(line.qtyReceived)}</td><td>${num(line.qtyBilled)}</td><td>${available}</td><td><b>${applied}</b></td><td>${esc(receipt.status||'Released')}</td></tr>`).join('');
    const legacyDisabled = document.getElementById('bPoAdd')?.disabled === true;
    host.innerHTML = `<div class='ap-po-pro-selector'>
      <label>Vendor<input value='${esc(vendorId ? `${vendorId}${vendorName?` — ${vendorName}`:''}` : 'Select vendor first')}' readonly></label>
      <label>Purchase Order Number<div class='ap-po-search-wrap'><input id='apPoSearch' autocomplete='off' placeholder='Type any part of a PO number to search' value='${esc(selectedPo?.poNumber||existingPoNo)}' ${vendorId&&!legacyDisabled?'':'disabled'}><div id='apPoResults' class='ap-po-results hidden'></div></div><span class='ap-po-pro-hint'>Contains search. Only eligible POs for the selected vendor are shown.</span></label>
    </div>
    ${selectedPo?`<div class='ap-po-pro-status'><b>${esc(selectedPo.poNumber)}</b><span>${esc(selectedPo.status||'')}</span><span>PO ${money(selectedPo.total)}</span><span>Received ${money(selectedPo.receivedAmount)}</span><span>Billed ${money(selectedPo.billedAmount)}</span><span>Open ${money(selectedPo.openAmount)}</span></div>
    <div class='ap-po-banner ${allReady?'ready':'blocked'}'><b>${allReady?'✓ 3-Way Match checks are satisfied for the current bill lines.':'Posting blocked until all required 3-way-match checks pass.'}</b><div class='ap-po-pro-hint'>PO and receipt checks come from system records. Receipt boxes cannot be manually overridden.</div></div>
    <div class='table-wrap'><table class='ap-po-match-grid'><thead><tr><th>Line</th><th>PO</th><th>Receipt</th><th>Invoice</th><th>Item</th><th>Description</th><th>Received</th><th>Previously Billed</th><th>Available Receipt</th><th>Invoice Qty</th><th>PO Cost</th><th>Invoice Cost</th></tr></thead><tbody>${lineRows||"<tr><td colspan='12'>No billable PO lines are available.</td></tr>"}</tbody></table></div>
    <div class='ap-po-receipts'><h4>Receipt Validation</h4><div class='table-wrap'><table><thead><tr><th>Used</th><th>Receipt</th><th>Item</th><th>Received Qty</th><th>Previously Billed</th><th>Available Qty</th><th>Matched to This Bill</th><th>Status</th></tr></thead><tbody>${receiptRows||"<tr><td colspan='8'>No unused receipt quantity is available for this PO.</td></tr>"}</tbody></table></div></div>`:`<div class='ap-po-banner blocked'><b>No Purchase Order selected.</b><div class='ap-po-pro-hint'>Choose the vendor first, then type or select the PO number. PO and receipt information will populate automatically.</div></div>`}`;
    bindSearch(host);
  }

  function bindSearch(host) {
    const input = host.querySelector('#apPoSearch');
    const results = host.querySelector('#apPoResults');
    if (!input || !results || input.disabled) return;
    const show = async () => {
      if (!currentVendorId()) return;
      try {
        const rows = await lookupPos(input.value);
        results.innerHTML = rows.length ? rows.slice(0,30).map(row => `<button type='button' class='ap-po-result' data-po='${esc(row.poNumber)}'><span><b>${esc(row.poNumber)}</b><small>${esc(row.vendorId)} — ${esc(row.vendorName)} · ${esc(row.status)} · ${esc(row.date||'')}</small></span><span>${money(row.openAmount)}</span></button>`).join('') : `<div class='ap-po-result'><span>No matching eligible POs for this vendor.</span></div>`;
        results.classList.remove('hidden');
        results.querySelectorAll('[data-po]').forEach(button => button.onclick = async () => {
          const rowsNow = await lookupPos(button.dataset.po);
          const row = rowsNow.find(item => String(item.poNumber) === String(button.dataset.po));
          if (!row) return;
          results.classList.add('hidden'); input.value = row.poNumber; await applySelectedPo(row);
        });
      } catch (error) {
        results.innerHTML = `<div class='ap-po-result'><span>${esc(error.message)}</span></div>`; results.classList.remove('hidden');
      }
    };
    input.onfocus = show;
    input.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(show, 180); };
    input.onkeydown = async event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const rows = await lookupPos(input.value);
      const exact = rows.find(row => String(row.poNumber).toLowerCase() === String(input.value).trim().toLowerCase());
      if (exact) await applySelectedPo(exact); else show();
    };
    input.onblur = () => setTimeout(() => results.classList.add('hidden'), 180);
  }

  const waitFor = (selector, timeout = 2500) => new Promise((resolve, reject) => {
    const now = document.querySelector(selector); if (now) return resolve(now);
    const observer = new MutationObserver(() => { const found = document.querySelector(selector); if (found) { observer.disconnect(); clearTimeout(timer); resolve(found); } });
    observer.observe(document.body, { childList:true, subtree:true });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('The existing PO selection dialog did not open.')); }, timeout);
  });

  async function applySelectedPo(row) {
    if (applyingPo) return;
    const legacy = document.getElementById('bPoAdd');
    if (!legacy || legacy.disabled) return alert('This AP Bill is read-only and its Purchase Order cannot be changed.');
    applyingPo = true;
    try {
      legacy.click();
      const modal = await waitFor('.lookup-modal');
      const overlay = modal.closest('.cn-overlay'); if (overlay) overlay.style.visibility = 'hidden';
      const choices = [...modal.querySelectorAll('.pickRow')];
      const choice = choices.find(input => { try { return String(JSON.parse(input.dataset.row || '{}').poNumber) === String(row.poNumber); } catch { return false; } });
      if (!choice) throw new Error(`PO ${row.poNumber} is no longer eligible for this vendor.`);
      choice.checked = true; modal.querySelector('#lookupApply')?.click();
      selectedPo = row; currentReceipts = await loadReceipts(row.poNumber);
      setTimeout(() => renderWorkspace(), 60);
    } catch (error) { alert(error.message); }
    finally { applyingPo = false; document.querySelectorAll('.cn-overlay').forEach(overlay => { if (overlay.style.visibility === 'hidden') overlay.remove(); }); }
  }

  function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(() => renderWorkspace().catch(console.error), 80); }
  function mount() {
    if (!pathMatch()) { activePath=''; selectedPo=null; currentReceipts=[]; return; }
    if (activePath !== location.pathname) { activePath=location.pathname; selectedPo=null; currentReceipts=[]; }
    const panel = document.getElementById('purchaseOrder'); if (!panel) return;
    hideLegacyControls(panel);
    if (!panel.querySelector('#apPoProfessionalWorkspace')) scheduleRender();
    ['bVendorNumber','bVendorName'].forEach(id => { const field=document.getElementById(id); if(field && !field.dataset.apPoWatch){field.dataset.apPoWatch='1';field.addEventListener('input',scheduleRender);field.addEventListener('change',scheduleRender);} });
    const tab = document.querySelector(".erp-tabs .tab[data-tab='purchaseOrder']"); if (tab && !tab.dataset.apPoWatch) { tab.dataset.apPoWatch='1'; tab.addEventListener('click', scheduleRender); }
    const lines = document.getElementById('billLines'); if(lines && !lines.dataset.apPoWatch){lines.dataset.apPoWatch='1';lines.addEventListener('input',event=>{if(event.target.matches('.ln-qty,.ln-cost,.ln-po,.ln-inv'))scheduleRender();});lines.addEventListener('change',event=>{if(event.target.matches('.ln-qty,.ln-cost,.ln-po,.ln-inv'))scheduleRender();});}
  }
  let queued=false;
  const scan=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;mount();});};
  new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('popstate',scan);
  scan();
})();