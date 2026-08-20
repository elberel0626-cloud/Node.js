(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const request = async (url, options = {}) => {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
    return data;
  };
  const money = value => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
  const statusClass = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const style = document.createElement('style');
  style.textContent = `
    .po-pref-tabs{display:flex;gap:6px;margin:0 0 14px;border-bottom:1px solid var(--border,#d0d5dd)}
    .po-pref-tabs button{border:0;border-bottom:3px solid transparent;background:transparent;padding:10px 14px}.po-pref-tabs button.active{font-weight:700;border-bottom-color:currentColor}
    .po-pref-section{margin-bottom:14px}.po-pref-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}.po-pref-grid label{display:flex;flex-direction:column;gap:5px}
    .po-pref-check{display:flex!important;flex-direction:row!important;align-items:center;gap:8px!important}.po-pref-check input{width:auto}
    .po-pref-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}.po-reason-table input,.po-reason-table select{width:100%;min-width:100px}
    .po-match-pro-status{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.po-match-pro-status strong{font-size:1.05rem}
    .po-match-kpis{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:8px;margin-bottom:12px}.po-match-kpis>div{padding:9px;border:1px solid var(--border,#d0d5dd);border-radius:6px}.po-match-kpis span{display:block;font-size:12px;opacity:.75}.po-match-kpis b{font-size:16px}
    .po-match-lines td,.po-match-lines th{vertical-align:top}.po-variance-detail td{padding:6px 12px 10px 38px;font-size:12px}.po-match-actions-pro{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
    .po-match-note{font-size:12px;opacity:.8}.po-adjustment-ref{white-space:nowrap}.po-pref-message{margin-left:8px;font-size:12px}
    .po-exception-modal textarea{min-height:90px;width:100%}.po-exception-modal label{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}
    @media(max-width:800px){.po-match-kpis{grid-template-columns:1fr 1fr}}
  `;
  document.head.appendChild(style);

  let preferencesCache = null;
  let accountsCache = null;
  let approvalUsersCache = null;
  const loadPreferences = async refresh => {
    if (!refresh && preferencesCache) return preferencesCache;
    preferencesCache = await request('/api/purchase-orders/preferences');
    return preferencesCache;
  };
  const loadAccounts = async () => accountsCache || (accountsCache = await request('/api/finance/chart-of-accounts'));
  const loadApprovalUsers = async () => approvalUsersCache || (approvalUsersCache = await request('/api/ap/approval-users'));
  const accountNumber = row => row.accountNumber || row.code || '';
  const accountTitle = row => row.accountTitle || row.name || '';
  const accountOptions = (accounts, selected) => accounts.map(row => `<option value='${esc(accountNumber(row))}' ${String(accountNumber(row))===String(selected||'')?'selected':''}>${esc(accountNumber(row))} - ${esc(accountTitle(row))}</option>`).join('');

  function injectNavigation() {
    if (!location.pathname.startsWith('/purchase-orders') && !location.pathname.startsWith('/purchasing')) return;
    const nav = document.getElementById('ar-nav');
    if (!nav || nav.querySelector("a[href='/purchase-orders/preferences']")) return;
    const explore = [...nav.querySelectorAll('.nav-group')].find(group => group.querySelector('.nav-group-title')?.textContent.trim() === 'Explore');
    if (!explore) return;
    const link = document.createElement('a');
    link.href = '/purchase-orders/preferences';
    link.textContent = 'Purchase Order Preferences';
    if (location.pathname === link.getAttribute('href')) link.classList.add('active');
    explore.appendChild(link);
  }

  function reasonRowsHtml(rows) {
    return (rows || []).map((row, index) => `<tr data-reason-index='${index}'><td><input class='pr-code' value='${esc(row.code)}'></td><td><input class='pr-description' value='${esc(row.description)}'></td><td><select class='pr-type'>${['Price Variance','Quantity Variance','Freight','Other'].map(type=>`<option ${type===row.type?'selected':''}>${type}</option>`).join('')}</select></td><td><input class='pr-active' type='checkbox' ${row.active!==false?'checked':''}></td><td><button type='button' class='pr-remove'>Remove</button></td></tr>`).join('');
  }

  async function renderPreferences() {
    if (location.pathname !== '/purchase-orders/preferences') return;
    const view = document.getElementById('view');
    if (!view || view.dataset.poPreferencesRendering === '1') return;
    if (view.dataset.poPreferencesRendered === '1' && view.querySelector('#poPreferencesForm')) return;
    view.dataset.poPreferencesRendering = '1';
    try {
      const [{ preferences }, accounts, users] = await Promise.all([loadPreferences(true), loadAccounts(), loadApprovalUsers()]);
      if (location.pathname !== '/purchase-orders/preferences' || !view.isConnected) return;
      const g = preferences.general || {}, approval = preferences.approval || {}, mailing = preferences.mailing || {}, numbering = g.numbering || {}, poNumbering = numbering.purchaseOrder || {}, receiptNumbering = numbering.receipt || {};
      const title = document.getElementById('title'); if (title) title.textContent = 'Purchase Order Preferences';
      view.innerHTML = `<form id='poPreferencesForm' class='erp-workspace'>
        <div class='header-row'><div><h3>Purchase Order Preferences</h3><p class='po-match-note'>Central controls for PO numbering, 3-way matching, variance accounting, Purchasing approval, and PO email defaults.</p></div><div><button type='button' id='poPrefSaveTop'>Save Preferences</button><span id='poPrefMessage' class='po-pref-message'></span></div></div>
        <div class='po-pref-tabs'><button type='button' class='active' data-pref-tab='general'>General Settings</button><button type='button' data-pref-tab='approval'>Approval</button><button type='button' data-pref-tab='mailing'>Mailing Settings</button></div>
        <div id='poPrefGeneral' class='po-pref-pane'>
          <section class='panel po-pref-section'><h4>3-Way Match & Variance Controls</h4><div class='po-pref-grid'>
            <label class='po-pref-check'><input id='ppStrict3Way' type='checkbox' ${g.strictThreeWayMatch!==false?'checked':''}> Require 3-way match for receipt-required PO bills</label>
            <label class='po-pref-check'><input id='ppAutoRematch' type='checkbox' ${g.autoRematchOnReceipt!==false?'checked':''}> Automatically re-match AP bills when a receipt posts</label>
            <label>Price tolerance %<input id='ppPricePct' type='number' min='0' step='0.01' value='${Number(g.priceTolerancePct||0)}'></label>
            <label>Price tolerance amount<input id='ppPriceAmt' type='number' min='0' step='0.01' value='${Number(g.priceToleranceAmount||0)}'></label>
            <label>Quantity approval guide %<input id='ppQtyPct' type='number' min='0' step='0.01' value='${Number(g.quantityTolerancePct||0)}'></label>
            <label>Quantity approval guide units<input id='ppQtyUnits' type='number' min='0' step='0.01' value='${Number(g.quantityToleranceUnits||0)}'></label>
          </div></section>
          <section class='panel po-pref-section'><h4>Posting & Allocation Accounts</h4><div class='po-pref-grid'>
            <label>Purchase Price Variance (PPV)<select id='ppPpvAccount'>${accountOptions(accounts,g.purchasePriceVarianceAccount)}</select></label>
            <label>Purchase Quantity Variance<select id='ppQtyVarianceAccount'>${accountOptions(accounts,g.purchaseQuantityVarianceAccount)}</select></label>
            <label>Receipt Not Invoiced / RNI<select id='ppRniAccount'>${accountOptions(accounts,g.receiptNotInvoicedAccount)}</select></label>
            <label>Freight Allocation Account<select id='ppFreightAccount'>${accountOptions(accounts,g.freightAllocationAccount)}</select></label>
            <label>Default PPV Reason Code<input id='ppPpvReason' value='${esc(g.priceVarianceReasonCode||'PPV')}'></label>
            <label>Default Quantity Variance Reason<input id='ppQtyReason' value='${esc(g.quantityVarianceReasonCode||'QTY-SHORT')}'></label>
            <label>Default Freight Reason<input id='ppFreightReason' value='${esc(g.freightReasonCode||'FREIGHT')}'></label>
          </div></section>
          <section class='panel po-pref-section'><h4>Document Numbering</h4><div class='po-pref-grid'>
            <label>PO Prefix<input id='ppPoPrefix' value='${esc(poNumbering.prefix||'PO-')}'></label><label>Next PO Number<input id='ppPoNext' type='number' min='1' value='${Number(poNumbering.nextNumber||1)}'></label><label>PO Number Padding<input id='ppPoPadding' type='number' min='1' value='${Number(poNumbering.padding||4)}'></label>
            <label>Receipt Prefix<input id='ppReceiptPrefix' value='${esc(receiptNumbering.prefix||'PR')}'></label><label>Next Receipt Number<input id='ppReceiptNext' type='number' min='1' value='${Number(receiptNumbering.nextNumber||1)}'></label><label>Receipt Number Padding<input id='ppReceiptPadding' type='number' min='1' value='${Number(receiptNumbering.padding||6)}'></label>
          </div></section>
          <section class='panel po-pref-section'><div class='header-row'><h4>Purchase Order Reason Codes</h4><button type='button' id='poAddReason'>Add Reason Code</button></div><div class='table-wrap'><table class='po-reason-table'><thead><tr><th>Code</th><th>Description</th><th>Type</th><th>Active</th><th></th></tr></thead><tbody id='poReasonRows'>${reasonRowsHtml(preferences.reasonCodes||[])}</tbody></table></div></section>
        </div>
        <div id='poPrefApproval' class='po-pref-pane hidden'>
          <section class='panel'><h4>Purchasing Exception Approval</h4><p class='po-match-note'>Receipt shortages never create fake receipts. AP can save the bill, but posting stays blocked until the receipt arrives or Purchasing approves the shortage.</p><div class='po-pref-grid'>
            <label class='po-pref-check'><input id='ppRouteQty' type='checkbox' ${approval.routeQuantityExceptionsToPurchasing!==false?'checked':''}> Route quantity shortages to Purchasing</label>
            <label>Default Purchasing Approver<select id='ppPurchasingApprover'><option value=''>Use vendor assigned Purchasing person</option>${users.filter(row=>row.status==='Active').map(row=>`<option value='${esc(row.id)}' ${row.id===approval.purchasingApproverUserId?'selected':''}>${esc(row.name)} — ${esc(row.email||row.id)}</option>`).join('')}</select></label>
            <label>Controller review amount<input id='ppControllerAmount' type='number' min='0' step='0.01' value='${Number(approval.controllerReviewAmount||0)}'></label>
            <label class='po-pref-check'><input id='ppRequireReason' type='checkbox' ${approval.requireReasonCode!==false?'checked':''}> Require reason code</label>
            <label class='po-pref-check'><input id='ppRequireComment' type='checkbox' ${approval.requireComment!==false?'checked':''}> Require approval comment</label>
            <label class='po-pref-check'><input id='ppAllowAccept' type='checkbox' ${approval.allowAcceptShort!==false?'checked':''}> Allow Accept Short / Close Missing Qty</label>
            <label class='po-pref-check'><input id='ppAllowWait' type='checkbox' ${approval.allowWaitForReceipt!==false?'checked':''}> Allow Wait for Remaining Receipt</label>
            <label class='po-pref-check'><input id='ppAllowCredit' type='checkbox' ${approval.allowVendorCredit!==false?'checked':''}> Allow Request Vendor Credit</label>
          </div></section>
        </div>
        <div id='poPrefMailing' class='po-pref-pane hidden'>
          <section class='panel'><h4>Purchase Order Mailing Defaults</h4><div class='po-pref-grid'>
            <label>From Name<input id='ppMailFrom' value='${esc(mailing.fromName||'Purchasing')}'></label><label>Reply-To Email<input id='ppMailReply' type='email' value='${esc(mailing.replyTo||'')}'></label>
            <label style='grid-column:1/-1'>Subject Template<input id='ppMailSubject' value='${esc(mailing.subjectTemplate||'')}'></label><label style='grid-column:1/-1'>Message Template<textarea id='ppMailBody' rows='6'>${esc(mailing.bodyTemplate||'')}</textarea></label>
            <label class='po-pref-check'><input id='ppAttachPdf' type='checkbox' ${mailing.attachPurchaseOrderPdf!==false?'checked':''}> Attach Purchase Order PDF</label><label class='po-pref-check'><input id='ppCcBuyer' type='checkbox' ${mailing.ccBuyer?'checked':''}> CC Buyer</label><label class='po-pref-check'><input id='ppSendOpen' type='checkbox' ${mailing.sendWhenOpened?'checked':''}> Send when PO is opened</label><label class='po-pref-check'><input id='ppSendApproved' type='checkbox' ${mailing.sendAfterApproval!==false?'checked':''}> Send after approval</label>
          </div><p class='po-match-note'>Supported placeholders: {{poNumber}}, {{vendorName}}, {{buyerName}}, {{companyName}}, {{poTotal}}.</p></section>
        </div>
        <div class='po-pref-actions'><button type='button' id='poPrefSave'>Save Preferences</button></div>
      </form>`;

      const showTab = name => {
        view.querySelectorAll('[data-pref-tab]').forEach(button => button.classList.toggle('active', button.dataset.prefTab === name));
        ['general','approval','mailing'].forEach(tab => document.getElementById('poPref'+tab[0].toUpperCase()+tab.slice(1))?.classList.toggle('hidden', tab !== name));
      };
      view.querySelectorAll('[data-pref-tab]').forEach(button => button.onclick = () => showTab(button.dataset.prefTab));
      const bindReasonRemove = () => view.querySelectorAll('.pr-remove').forEach(button => button.onclick = () => button.closest('tr').remove());
      bindReasonRemove();
      document.getElementById('poAddReason').onclick = () => { document.getElementById('poReasonRows').insertAdjacentHTML('beforeend', reasonRowsHtml([{code:'',description:'',type:'Other',active:true}])); bindReasonRemove(); };

      const collect = () => ({
        general: {
          strictThreeWayMatch: document.getElementById('ppStrict3Way').checked, autoRematchOnReceipt: document.getElementById('ppAutoRematch').checked,
          priceTolerancePct: Number(document.getElementById('ppPricePct').value||0), priceToleranceAmount: Number(document.getElementById('ppPriceAmt').value||0), quantityTolerancePct: Number(document.getElementById('ppQtyPct').value||0), quantityToleranceUnits: Number(document.getElementById('ppQtyUnits').value||0),
          purchasePriceVarianceAccount: document.getElementById('ppPpvAccount').value, purchaseQuantityVarianceAccount: document.getElementById('ppQtyVarianceAccount').value, receiptNotInvoicedAccount: document.getElementById('ppRniAccount').value, freightAllocationAccount: document.getElementById('ppFreightAccount').value,
          priceVarianceReasonCode: document.getElementById('ppPpvReason').value.trim(), quantityVarianceReasonCode: document.getElementById('ppQtyReason').value.trim(), freightReasonCode: document.getElementById('ppFreightReason').value.trim(),
          numbering: { purchaseOrder: { prefix: document.getElementById('ppPoPrefix').value.trim(), nextNumber: Number(document.getElementById('ppPoNext').value||1), padding: Number(document.getElementById('ppPoPadding').value||1) }, receipt: { prefix: document.getElementById('ppReceiptPrefix').value.trim(), nextNumber: Number(document.getElementById('ppReceiptNext').value||1), padding: Number(document.getElementById('ppReceiptPadding').value||1) } }
        },
        approval: { routeQuantityExceptionsToPurchasing: document.getElementById('ppRouteQty').checked, purchasingApproverUserId: document.getElementById('ppPurchasingApprover').value, controllerReviewAmount: Number(document.getElementById('ppControllerAmount').value||0), requireReasonCode: document.getElementById('ppRequireReason').checked, requireComment: document.getElementById('ppRequireComment').checked, allowAcceptShort: document.getElementById('ppAllowAccept').checked, allowWaitForReceipt: document.getElementById('ppAllowWait').checked, allowVendorCredit: document.getElementById('ppAllowCredit').checked },
        mailing: { fromName: document.getElementById('ppMailFrom').value.trim(), replyTo: document.getElementById('ppMailReply').value.trim(), subjectTemplate: document.getElementById('ppMailSubject').value, bodyTemplate: document.getElementById('ppMailBody').value, attachPurchaseOrderPdf: document.getElementById('ppAttachPdf').checked, ccBuyer: document.getElementById('ppCcBuyer').checked, sendWhenOpened: document.getElementById('ppSendOpen').checked, sendAfterApproval: document.getElementById('ppSendApproved').checked },
        reasonCodes: [...document.querySelectorAll('#poReasonRows tr')].map(row => ({ code: row.querySelector('.pr-code').value.trim(), description: row.querySelector('.pr-description').value.trim(), type: row.querySelector('.pr-type').value, active: row.querySelector('.pr-active').checked })).filter(row => row.code)
      });
      const save = async () => {
        const message = document.getElementById('poPrefMessage'); message.textContent = 'Saving…';
        try { const result = await request('/api/purchase-orders/preferences', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(collect()) }); preferencesCache = result; message.textContent = 'Saved'; setTimeout(()=>{ if(message.isConnected) message.textContent=''; },1800); }
        catch (error) { message.textContent = error.message; alert(error.message); }
      };
      document.getElementById('poPrefSave').onclick = save; document.getElementById('poPrefSaveTop').onclick = save;
      view.dataset.poPreferencesRendered = '1';
    } finally { delete view.dataset.poPreferencesRendering; }
  }

  async function exceptionDialog({ title, preferences, decisions = null, onSubmit }) {
    const reasonCodes = (preferences.reasonCodes || []).filter(row => row.active !== false && (row.type === 'Quantity Variance' || row.type === 'Other'));
    const overlay = document.createElement('div'); overlay.className = 'cn-overlay po-exception-modal';
    overlay.innerHTML = `<div class='cn-modal'><div class='cn-head'><h3>${esc(title)}</h3></div><div class='cn-list'><label>Reason Code<select id='poExReason'><option value=''>Select reason</option>${reasonCodes.map(row=>`<option value='${esc(row.code)}'>${esc(row.code)} — ${esc(row.description)}</option>`).join('')}</select></label><label>Purchasing Comment<textarea id='poExComment' placeholder='Explain why the shortage is acceptable or what should happen next.'></textarea></label>${decisions?`<label>Decision<select id='poExDecision'>${decisions.map(row=>`<option value='${esc(row.value)}'>${esc(row.label)}</option>`).join('')}</select></label>`:''}</div><div class='cn-foot'><button type='button' id='poExSubmit'>Submit</button><button type='button' id='poExCancel'>Cancel</button></div></div>`;
    document.body.appendChild(overlay); overlay.querySelector('#poExCancel').onclick = () => overlay.remove();
    overlay.querySelector('#poExSubmit').onclick = async () => { const payload = { reasonCode: overlay.querySelector('#poExReason').value, comments: overlay.querySelector('#poExComment').value.trim() }; if (decisions) payload.decision = overlay.querySelector('#poExDecision').value; try { await onSubmit(payload); overlay.remove(); } catch (error) { alert(error.message); } };
  }

  function varianceHtml(doc, matchLine) {
    const adjustments = (doc.varianceAdjustments || []).filter(row => Number(row.lineIndex) === Number(matchLine.lineIndex));
    const pending = [];
    if (Math.abs(Number(matchLine.priceVariance||0)) >= .005 && !adjustments.some(row=>row.type==='Price Variance')) pending.push(`Estimated PPV ${money(matchLine.priceVariance)} → generated at posting`);
    if (Math.abs(Number(matchLine.quantityVariance||0)) >= .005 && !adjustments.some(row=>row.type==='Quantity Variance')) pending.push(`Approved quantity variance ${money(matchLine.quantityVariance)} → generated at posting`);
    const refs = adjustments.map(row => `<a class='link po-adjustment-ref' href='/purchase-orders/variance-adjustments/${encodeURIComponent(row.id)}'>${esc(row.id)} · ${esc(row.type)} · ${money(row.amount)}</a>`);
    return [...refs, ...pending.map(text=>`<span>${esc(text)}</span>`)].join('<br>') || '<span>No variance adjustment.</span>';
  }

  async function enhanceBill() {
    const match = location.pathname.match(/^\/ap\/(?:bills|approvals)\/([^/]+)$/); if (!match) return;
    const id = decodeURIComponent(match[1]); if (id === 'new' || id === '__new__') return;
    const panel = document.getElementById('purchaseOrder'); if (!panel || panel.dataset.professionalMatchEnhanced === id) return;
    panel.dataset.professionalMatchEnhanced = id;
    try {
      const [doc, prefResult, session] = await Promise.all([request('/api/ap/documents/'+encodeURIComponent(id)), loadPreferences(), request('/api/auth/session')]);
      if (!panel.isConnected) return;
      const threeWay = doc.threeWayMatch || {hasPo:false,status:'Not Applicable',postable:true,lines:[],totals:{}}, approval = doc.poQuantityException || threeWay.approval || null, totals = threeWay.totals || {}, prefs = prefResult.preferences || {};
      const oldSummary = panel.querySelector('.po-match-summary');
      const summary = document.createElement('div'); summary.className = 'po-match-professional';
      summary.innerHTML = `<div class='po-match-pro-status'><div><strong>3-Way Match: <span class='period-status ${statusClass(threeWay.status)}'>${esc(threeWay.status)}</span></strong><div class='po-match-note'>PO → released receipt → vendor invoice. Unused receipt quantity is consumed only when the bill posts.</div></div><div>${threeWay.postable?'<b>Ready for AP Posting</b>':'<b>Posting Blocked</b>'}</div></div>
        <div class='po-match-kpis'><div><span>Invoice Qty</span><b>${Number(totals.invoiceQty||0)}</b></div><div><span>Matched Receipt Qty</span><b>${Number(totals.matchedQty||0)}</b></div><div><span>Missing Qty</span><b>${Number(totals.shortQty||0)}</b></div><div><span>Price Variance</span><b>${money(totals.priceVariance||0)}</b></div></div>
        ${approval?`<section class='panel'><b>Purchasing Exception:</b> ${esc(approval.status||'')} · ${esc(approval.assignedTo||approval.assignedToUser||'')} ${approval.decision?`· ${esc(approval.decision)}`:''}<br><small>${esc(approval.reasonCode||'')} ${esc(approval.decisionComments||approval.comments||'')}</small></section>`:''}
        <div class='po-match-actions-pro' id='poMatchProfessionalActions'></div>
        <div class='table-wrap'><table class='po-match-lines'><thead><tr><th>Line</th><th>PO</th><th>Item</th><th>Ordered</th><th>Received</th><th>Previously Billed</th><th>Available Receipt</th><th>Invoice Qty</th><th>Matched</th><th>Missing</th><th>PO Cost</th><th>Invoice Cost</th><th>Line Status</th></tr></thead><tbody>${(threeWay.lines||[]).map(row=>`<tr><td>${row.lineIndex+1}</td><td><a class='link' href='/purchase-orders/orders/${encodeURIComponent(row.poNumber||'')}'>${esc(row.poNumber||'')}</a></td><td>${esc(row.inventoryId||'')}</td><td>${Number(row.orderedQty||0)}</td><td>${Number(row.receivedQty||0)}</td><td>${Number(row.previouslyBilledQty||0)}</td><td>${Number(row.availableReceiptQty||0)}</td><td>${Number(row.invoiceQty||0)}</td><td>${Number(row.matchedQty||0)}</td><td><b>${Number(row.shortQty||0)}</b></td><td>${money(row.poUnitCost||0)}</td><td>${money(row.invoiceUnitCost||0)}</td><td>${esc(row.status||'')}</td></tr><tr class='po-variance-detail'><td colspan='13'><b>Variance / Adjustment:</b><br>${varianceHtml(doc,row)}${(row.receiptNumbers||[]).length?`<br><b>Receipt references:</b> ${(row.receiptNumbers||[]).map(ref=>`<a class='link' href='/purchase-orders/receipts/${encodeURIComponent(ref)}'>${esc(ref)}</a>`).join(', ')}`:''}</td></tr>`).join('')||"<tr><td colspan='13'>This bill is not linked to a Purchase Order.</td></tr>"}</tbody></table></div>`;
      if (oldSummary) oldSummary.replaceWith(summary); else panel.prepend(summary);
      const actions = summary.querySelector('#poMatchProfessionalActions');
      const unresolvedShort = (threeWay.lines||[]).some(row=>Number(row.shortQty||0)>0&&!row.approvedShort);
      if (unresolvedShort && !doc.posted && approval?.status !== 'Pending Purchasing Approval' && approval?.status !== 'Vendor Credit Pending') {
        const button = document.createElement('button'); button.type='button'; button.textContent='Send Quantity Exception to Purchasing'; actions.appendChild(button);
        button.onclick = () => exceptionDialog({ title:'Send Quantity Exception to Purchasing', preferences:prefs, onSubmit: async payload => { await request(`/api/ap/documents/${encodeURIComponent(id)}/po-match/submit-quantity-exception`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); panel.dataset.professionalMatchEnhanced=''; enhanceBill(); } });
      }
      const user = session.user || {}, canDecide = approval?.status === 'Pending Purchasing Approval' && ((user.roles||[]).includes('Admin') || approval.assignedToUser === user.id);
      if (canDecide) {
        const button = document.createElement('button'); button.type='button'; button.textContent='Purchasing Decision'; actions.appendChild(button);
        const decisions=[]; if(prefs.approval?.allowAcceptShort!==false)decisions.push({value:'Accept Short & Close PO',label:'Accept Short / Close Missing Qty'}); if(prefs.approval?.allowWaitForReceipt!==false)decisions.push({value:'Wait for Remaining Receipt',label:'Wait for Remaining Receipt'}); if(prefs.approval?.allowVendorCredit!==false)decisions.push({value:'Request Vendor Credit',label:'Request Vendor Credit'});
        button.onclick = () => exceptionDialog({ title:'Purchasing Quantity Exception Decision', preferences:prefs, decisions, onSubmit: async payload => { await request(`/api/ap/documents/${encodeURIComponent(id)}/po-match/decision`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); panel.dataset.professionalMatchEnhanced=''; enhanceBill(); } });
      }
      if (threeWay.hasPo) {
        const post = document.getElementById('bPost'); if(post && !threeWay.postable && !doc.posted){post.disabled=true;post.title=`3-way match incomplete: ${threeWay.status}`;}
      }
    } catch (error) { panel.dataset.professionalMatchEnhanced = ''; console.error('PO match enhancement failed', error); }
  }

  async function enhanceBillList() {
    if (location.pathname !== '/ap/bills') return; const table = document.querySelector('#apBillGrid table'); if (!table || table.dataset.poMatchColumn === '1') return;
    table.dataset.poMatchColumn='1';
    try { const docs = await request('/api/ap/documents?type=Bill'); const byId=new Map(docs.map(doc=>[String(doc.id),doc])); const head=table.querySelector('tr'); if(head){const th=document.createElement('th');th.textContent='3-Way Match';head.appendChild(th);} [...table.querySelectorAll('tr')].slice(1).forEach(row=>{const link=row.querySelector("a[href^='/ap/bills/']"),id=link?.textContent.trim(),doc=byId.get(id),td=document.createElement('td');td.textContent=doc?.threeWayMatch?.hasPo?(doc.matchStatus||doc.threeWayMatch.status):'N/A';row.appendChild(td);}); } catch { table.dataset.poMatchColumn=''; }
  }

  async function renderVarianceAdjustment() {
    const route = location.pathname.match(/^\/purchase-orders\/variance-adjustments\/([^/]+)$/); if (!route) return;
    const view=document.getElementById('view'); if(!view||view.dataset.poVarianceRendered===route[1])return; view.dataset.poVarianceRendered=route[1];
    try { const row=await request('/api/purchase-orders/variance-adjustments/'+encodeURIComponent(decodeURIComponent(route[1]))); if(!view.isConnected)return; const title=document.getElementById('title');if(title)title.textContent=`Purchase Order Variance ${row.id}`; view.innerHTML=`<div class='erp-toolbar sticky'><button type='button' id='poVarBack'>Back</button></div><section class='erp-workspace'><div class='erp-header-grid'><label>Adjustment Reference<input readonly value='${esc(row.id)}'></label><label>Type<input readonly value='${esc(row.type)}'></label><label>Reason Code<input readonly value='${esc(row.reasonCode)}'></label><label>Account<input readonly value='${esc(row.account)} - ${esc(row.accountName||'')}'></label><label>Amount<input readonly value='${money(row.amount)}'></label><label>PO Number<a class='link' href='/purchase-orders/orders/${encodeURIComponent(row.poNumber)}'>${esc(row.poNumber)}</a></label><label>AP Bill<a class='link' href='/ap/bills/${encodeURIComponent(row.billId)}'>${esc(row.billId)}</a></label><label>Vendor Invoice<input readonly value='${esc(row.vendorInvoiceNumber||'')}'></label><label>Inventory ID<input readonly value='${esc(row.inventoryId||'')}'></label><label>Invoice Qty<input readonly value='${Number(row.invoiceQty||0)}'></label><label>Matched Qty<input readonly value='${Number(row.matchedQty||0)}'></label><label>Short Qty<input readonly value='${Number(row.shortQty||0)}'></label><label>PO Unit Cost<input readonly value='${money(row.poUnitCost)}'></label><label>Invoice Unit Cost<input readonly value='${money(row.invoiceUnitCost)}'></label><label>JE Reference<input readonly value='${esc(row.jeReference||'Not posted')}'></label><label>Approval Reference<input readonly value='${esc(row.approvalReference||'')}'></label><label>Approved By<input readonly value='${esc(row.approvedBy||'')}'></label><label>Approved Date<input readonly value='${esc(row.approvedAt||'')}'></label></div><section class='panel'><h4>Receipt References</h4>${(row.receiptNumbers||[]).map(ref=>`<a class='link' href='/purchase-orders/receipts/${encodeURIComponent(ref)}'>${esc(ref)}</a>`).join(', ')||'No receipt reference.'}</section></section>`; document.getElementById('poVarBack').onclick=()=>history.back(); } catch(error){view.innerHTML=`<div class='panel'>${esc(error.message)}</div>`;}
  }

  let queued=false;
  const scan=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;injectNavigation();renderPreferences();enhanceBill();enhanceBillList();renderVarianceAdjustment();});};
  new MutationObserver(scan).observe(document.body,{childList:true,subtree:true}); window.addEventListener('popstate',scan); scan();
})();
