(() => {
  'use strict';

  const RGA_PATHS = ['/sales-orders/rga', '/ar/rga'];
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const money = value => Number(value || 0).toLocaleString(undefined, { style:'currency', currency:'USD' });
  const today = () => new Date().toISOString().slice(0, 10);

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

  function navigate(path) {
    history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
    setTimeout(schedule, 25);
  }

  function addStyles() {
    if ($('#rga-workflow-styles')) return;
    const style = document.createElement('style');
    style.id = 'rga-workflow-styles';
    style.textContent = `
      .rga-workspace{display:grid;gap:16px}.rga-header{display:grid;grid-template-columns:repeat(4,minmax(180px,1fr));gap:12px}
      .rga-header label,.rga-receive-grid label{display:grid;gap:5px;font-size:.88rem}.rga-header input,.rga-header select,.rga-header textarea,.rga-receive-grid input,.rga-receive-grid select{width:100%;box-sizing:border-box}
      .rga-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.rga-kpis{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:10px}.rga-kpi{padding:12px;border:1px solid var(--border-color,#d9dde3);border-radius:6px;background:var(--panel-bg,#fff)}
      .rga-kpi b{display:block;font-size:1.2rem;margin-top:4px}.rga-table-wrap{overflow:auto}.rga-table{width:100%;border-collapse:collapse;min-width:980px}.rga-table th,.rga-table td{padding:8px;border-bottom:1px solid var(--border-color,#ddd);text-align:left;white-space:nowrap}.rga-table input,.rga-table select{min-width:90px;box-sizing:border-box}
      .rga-status{display:inline-block;padding:3px 8px;border-radius:999px;background:#eef2f7;font-weight:600}.rga-note{padding:10px;border-left:4px solid #6b7280;background:#f8fafc}.rga-success{border-left-color:#15803d}.rga-warning{border-left-color:#b45309}.rga-error{border-left-color:#b91c1c}.rga-muted{color:#667085}.rga-link{cursor:pointer;text-decoration:underline}.rga-section{border:1px solid var(--border-color,#d9dde3);border-radius:6px;padding:14px;background:var(--panel-bg,#fff)}
      @media(max-width:1000px){.rga-header,.rga-kpis{grid-template-columns:repeat(2,minmax(150px,1fr))}}@media(max-width:650px){.rga-header,.rga-kpis{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function injectLink(afterHref, href, label) {
    if (document.querySelector(`#ar-nav a[href='${href}']`)) return;
    const anchor = document.querySelector(`#ar-nav a[href='${afterHref}']`);
    if (!anchor) return;
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    if (location.pathname === href || location.pathname.startsWith(href + '/')) link.classList.add('active');
    anchor.insertAdjacentElement('afterend', link);
  }

  function injectNavigation() {
    if (location.pathname.startsWith('/sales-orders')) injectLink('/sales-orders/invoices', '/sales-orders/rga', 'Customer Returns / RGA');
    if (location.pathname.startsWith('/ar')) injectLink('/ar/invoices', '/ar/rga', 'Customer Returns / RGA');
    if (location.pathname.startsWith('/inventory')) injectLink('/inventory/receipts', '/inventory/customer-returns', 'Customer Return Receipts');
  }

  function injectInvoiceRgaButton() {
    if (!location.pathname.startsWith('/ar/doc/') || $('#createRgaFromInvoice')) return;
    const type = $('#dtype')?.value || '';
    if (type !== 'Invoice') return;
    const reference = location.pathname.split('/').pop();
    if (!reference || reference === '<NEW>') return;
    const toolbar = $('.erp-toolbar');
    if (!toolbar) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'createRgaFromInvoice';
    button.textContent = 'Create RGA';
    button.onclick = () => navigate('/sales-orders/rga/new?invoiceId=' + encodeURIComponent(reference));
    const inquiry = $('#inqSel');
    if (inquiry) toolbar.insertBefore(button, inquiry); else toolbar.appendChild(button);
  }

  function isRgaRoute(path = location.pathname) {
    return RGA_PATHS.some(base => path === base || path.startsWith(base + '/'));
  }

  function listBase() {
    if (location.pathname.startsWith('/inventory/')) return '/inventory/customer-returns';
    if (location.pathname.startsWith('/ar/')) return '/ar/rga';
    return '/sales-orders/rga';
  }

  function statusBadge(value) { return `<span class='rga-status'>${esc(value)}</span>`; }

  async function renderList(view) {
    const rows = await api('/api/rga');
    const base = listBase();
    const title = location.pathname.startsWith('/inventory/') ? 'Customer Return Receipts' : 'Customer Returns / RGA';
    $('#title').textContent = title;
    view.innerHTML = `<div data-rga-root class='rga-workspace'>
      <div class='header-row'><div><h3>${esc(title)}</h3><p class='rga-muted'>Return authorizations are tied to the original customer invoice.</p></div><div class='rga-toolbar'><button id='rgaNew'>New RGA</button><button id='rgaRefresh'>Refresh</button></div></div>
      <div class='rga-kpis'>
        <div class='rga-kpi'>Open Returns<b>${rows.filter(r=>!['Closed','Cancelled','Rejected'].includes(r.status)).length}</b></div>
        <div class='rga-kpi'>Awaiting Product<b>${rows.filter(r=>['Awaiting Return','Partially Received'].includes(r.status)).length}</b></div>
        <div class='rga-kpi'>Credit Pending<b>${rows.filter(r=>['Received','Credit Pending'].includes(r.status)).length}</b></div>
        <div class='rga-kpi'>Returned Credit<b>${money(rows.reduce((sum,r)=>sum+Number(r.totalCredit||0),0))}</b></div>
      </div>
      <section class='rga-section rga-table-wrap'><table class='rga-table'><thead><tr><th>RGA</th><th>Status</th><th>Customer</th><th>Original Invoice</th><th>Invoice Status</th><th>Invoice Balance</th><th>Authorized Qty</th><th>Received Qty</th><th>Credit Amount</th><th>Credit Memo</th><th>Reason</th></tr></thead><tbody>
      ${rows.map(row=>`<tr><td><a href='/sales-orders/rga/${encodeURIComponent(row.id)}'>${esc(row.id)}</a></td><td>${statusBadge(row.status)}</td><td>${esc(row.customerName)}</td><td><a href='/ar/doc/${encodeURIComponent(row.invoiceId)}'>${esc(row.invoiceId)}</a></td><td>${esc(row.invoice?.status||'')}</td><td>${money(row.invoice?.balance||0)}</td><td>${Number(row.authorizedQty||0)}</td><td>${Number(row.receivedQty||0)}</td><td>${money(row.totalCredit||0)}</td><td>${row.creditMemo?.id?`<a href='/ar/doc/${encodeURIComponent(row.creditMemo.id)}'>${esc(row.creditMemo.id)} — ${esc(row.creditMemo.status)} — ${money(row.creditMemo.balance)} open credit</a>`:''}</td><td>${esc(row.reason||'')}</td></tr>`).join('') || `<tr><td colspan='11'>No RGA transactions yet.</td></tr>`}
      </tbody></table></section>
    </div>`;
    $('#rgaNew').onclick = () => navigate('/sales-orders/rga/new');
    $('#rgaRefresh').onclick = schedule;
    if (base !== '/sales-orders/rga') view.querySelectorAll("a[href^='/sales-orders/rga/']").forEach(a => a.dataset.rgaExternal = '1');
  }

  async function renderNew(view) {
    const invoices = await api('/api/rga/eligible-invoices');
    const params = new URLSearchParams(location.search);
    const requestedInvoice = params.get('invoiceId') || '';
    let selected = invoices.find(inv => inv.id === requestedInvoice) || invoices[0] || null;
    $('#title').textContent = 'New RGA';

    const render = () => {
      const lines = selected?.returnableLines || [];
      view.innerHTML = `<div data-rga-root class='rga-workspace'>
        <div class='rga-toolbar'><button id='rgaBack'>Back</button><button id='rgaSave' ${selected?'':'disabled'}>Save Draft RGA</button></div>
        <section class='rga-section'><h3>Return Authorization</h3><div class='rga-header'>
          <label>Original Invoice<select id='rgaInvoiceSelect'>${invoices.map(inv=>`<option value='${esc(inv.id)}' ${selected?.id===inv.id?'selected':''}>${esc(inv.id)} — ${esc(inv.customerName)} — ${money(inv.amount)}</option>`).join('')}</select></label>
          <label>Customer<input readonly value='${esc(selected?.customerName||'')}'></label>
          <label>Invoice Status<input readonly value='${esc(selected?.status||'')}'></label>
          <label>Current Invoice Balance<input readonly value='${money(selected?.balance||0)}'></label>
          <label>Return Reason<select id='rgaReason'><option>Defective</option><option>Damaged in Transit</option><option>Wrong Item</option><option selected>Customer Return</option><option>Warranty</option><option>Duplicate Shipment</option><option>Other</option></select></label>
          <label>Requested Date<input id='rgaRequestedDate' type='date' value='${today()}'></label>
          <label style='grid-column:span 2'>Notes<textarea id='rgaNotes' rows='2'></textarea></label>
        </div></section>
        ${selected?.paid?`<div class='rga-note rga-warning'>This invoice is already paid/closed. The RGA is still allowed. After the return is received, the credit memo will remain as an open customer credit unless it is refunded or applied elsewhere.</div>`:''}
        <section class='rga-section rga-table-wrap'><h3>Invoice Lines</h3><table class='rga-table'><thead><tr><th>Item</th><th>Description</th><th>Invoiced</th><th>Already Returned</th><th>Available to Return</th><th>Return Qty</th><th>Unit Price</th><th>Estimated Credit</th></tr></thead><tbody>
          ${lines.map(line=>`<tr data-line='${line.invoiceLineIndex}'><td>${esc(line.itemCode)}</td><td>${esc(line.description)}</td><td>${line.invoiceQty}</td><td>${line.alreadyReturnedQty}</td><td>${line.availableToReturnQty}</td><td><input class='rga-return-qty' type='number' min='0' max='${line.availableToReturnQty}' step='0.01' value='0'></td><td>${money(line.unitPrice)}</td><td class='rga-line-credit'>${money(0)}</td></tr>`).join('') || `<tr><td colspan='8'>No returnable invoice quantities remain.</td></tr>`}
        </tbody></table><p><b>Estimated credit: <span id='rgaEstimate'>$0.00</span></b></p></section>
      </div>`;
      $('#rgaBack').onclick = () => navigate('/sales-orders/rga');
      $('#rgaInvoiceSelect')?.addEventListener('change', event => { selected = invoices.find(inv => inv.id === event.target.value) || null; render(); });
      const recalc = () => {
        let total = 0;
        view.querySelectorAll('tr[data-line]').forEach(row => {
          const line = lines.find(x => String(x.invoiceLineIndex) === row.dataset.line);
          const qty = Number(row.querySelector('.rga-return-qty')?.value || 0);
          const gross = qty * Number(line?.unitPrice || 0);
          const discount = gross * Number(line?.discountPct || 0) / 100;
          const tax = qty * Number(line?.taxPerUnit || 0);
          const credit = gross - discount + tax;
          total += credit;
          row.querySelector('.rga-line-credit').textContent = money(credit);
        });
        $('#rgaEstimate').textContent = money(total);
      };
      view.querySelectorAll('.rga-return-qty').forEach(input => input.oninput = recalc);
      $('#rgaSave').onclick = async () => {
        try {
          const requestedLines = [...view.querySelectorAll('tr[data-line]')].map(row => ({ invoiceLineIndex:Number(row.dataset.line), returnQty:Number(row.querySelector('.rga-return-qty').value || 0) }));
          const created = await api('/api/rga', { method:'POST', body:JSON.stringify({ invoiceId:selected.id, reason:$('#rgaReason').value, requestedDate:$('#rgaRequestedDate').value, notes:$('#rgaNotes').value, lines:requestedLines }) });
          navigate('/sales-orders/rga/' + encodeURIComponent(created.id));
        } catch (error) { alert(error.message); }
      };
    };
    render();
  }

  async function renderDetail(view, id) {
    const row = await api('/api/rga/' + encodeURIComponent(id));
    const setup = await api('/api/inventory/setup').catch(() => ({ warehouses:[], locations:[] }));
    const editable = row.status === 'Draft';
    const canReceive = ['Awaiting Return','Partially Received'].includes(row.status);
    const canCredit = row.receiptComplete && !row.creditMemo?.posted && !['Cancelled','Rejected'].includes(row.status);
    $('#title').textContent = 'RGA ' + row.id;
    view.innerHTML = `<div data-rga-root class='rga-workspace'>
      <div class='rga-toolbar'><button id='rgaBack'>Back</button>${editable?"<button id='rgaApprove'>Approve RGA</button>":''}${!row.receipts?.length&&!row.creditMemo&& !['Cancelled','Closed'].includes(row.status)?"<button id='rgaCancel'>Cancel RGA</button>":''}${canCredit?"<button id='rgaCredit'>Create & Post Credit Memo</button>":''}<button id='rgaRefresh'>Refresh</button></div>
      <section class='rga-section'><div class='rga-header'>
        <label>RGA Number<input readonly value='${esc(row.id)}'></label><label>Status<input readonly value='${esc(row.status)}'></label><label>Customer<input readonly value='${esc(row.customerName)}'></label><label>Reason<input readonly value='${esc(row.reason||'')}'></label>
        <label>Original Invoice<div><a href='/ar/doc/${encodeURIComponent(row.invoiceId)}'>${esc(row.invoiceId)}</a></div></label><label>Invoice Status<input readonly value='${esc(row.invoice?.status||'')}'></label><label>Invoice Balance<input readonly value='${money(row.invoice?.balance||0)}'></label><label>Total Credit<input readonly value='${money(row.totalCredit||0)}'></label>
        <label>Requested Date<input readonly value='${esc(row.requestedDate||'')}'></label><label>Authorized Qty<input readonly value='${row.authorizedQty}'></label><label>Received Qty<input readonly value='${row.receivedQty}'></label><label>Credit Memo<div>${row.creditMemo?.id?`<a href='/ar/doc/${encodeURIComponent(row.creditMemo.id)}'>${esc(row.creditMemo.id)} — ${esc(row.creditMemo.status)} — ${money(row.creditMemo.balance)} open credit</a>`:'Not created'}</div></label>
      </div></section>
      ${row.invoice?.paid?`<div class='rga-note rga-warning'>Original invoice is already fully paid. A posted RGA credit will remain open on the customer account for refund or future application.</div>`:''}
      <section class='rga-section rga-table-wrap'><h3>Authorized Return Lines</h3><table class='rga-table'><thead><tr><th>Item</th><th>Description</th><th>Invoice Qty</th><th>Return Qty</th><th>Received Qty</th><th>Remaining</th><th>Unit Price</th><th>Credit</th></tr></thead><tbody>${(row.lines||[]).filter(line=>Number(line.returnQty)>0).map(line=>`<tr><td>${esc(line.itemCode)}</td><td>${esc(line.description)}</td><td>${line.invoiceQty}</td><td>${line.returnQty}</td><td>${line.receivedQty||0}</td><td>${Math.max(0,Number(line.returnQty||0)-Number(line.receivedQty||0))}</td><td>${money(line.unitPrice)}</td><td>${money(line.creditAmount)}</td></tr>`).join('')}</tbody></table></section>
      ${canReceive?`<section class='rga-section'><h3>Receive Returned Product</h3><p class='rga-muted'>Only “Return to Stock” adds available inventory and reverses COGS. Repair, Hold, and Scrap are recorded for disposition without adding available stock.</p><div class='rga-table-wrap'><table class='rga-table'><thead><tr><th>Item</th><th>Remaining</th><th>Receive Qty</th><th>Warehouse</th><th>Location</th><th>Condition</th><th>Disposition</th></tr></thead><tbody>${(row.lines||[]).filter(line=>Number(line.returnQty)>Number(line.receivedQty||0)).map(line=>{const defaultWarehouse=setup.warehouses?.[0]?.warehouseId||'MAIN';const locations=(setup.locations||[]).filter(loc=>loc.warehouse===defaultWarehouse);return `<tr data-receive-line='${esc(line.lineId)}'><td>${esc(line.itemCode)}</td><td>${Math.max(0,Number(line.returnQty)-Number(line.receivedQty||0))}</td><td><input class='rga-receive-qty' type='number' min='0' max='${Math.max(0,Number(line.returnQty)-Number(line.receivedQty||0))}' step='0.01' value='${Math.max(0,Number(line.returnQty)-Number(line.receivedQty||0))}'></td><td><select class='rga-wh'>${(setup.warehouses||[]).filter(w=>w.active!==false).map(w=>`<option value='${esc(w.warehouseId)}'>${esc(w.warehouseId)} - ${esc(w.name)}</option>`).join('')||'<option>MAIN</option>'}</select></td><td><input class='rga-loc' value='${esc(locations[0]?.locationId||'MAIN-A1')}'></td><td><select class='rga-condition'><option>Good</option><option>Damaged</option><option>Needs Inspection</option></select></td><td><select class='rga-disposition'><option>Return to Stock</option><option>Repair</option><option>Hold</option><option>Scrap</option></select></td></tr>`;}).join('')}</tbody></table></div><div class='rga-toolbar'><label>Receipt Date <input id='rgaReceiptDate' type='date' value='${today()}'></label><button id='rgaReceive'>Post Return Receipt</button></div></section>`:''}
      <section class='rga-section rga-table-wrap'><h3>Receipt History</h3><table class='rga-table'><thead><tr><th>Receipt</th><th>Date</th><th>Item</th><th>Qty</th><th>Warehouse</th><th>Location</th><th>Condition</th><th>Disposition</th><th>JE</th></tr></thead><tbody>${(row.receipts||[]).flatMap(receipt=>(receipt.lines||[]).map(line=>`<tr><td>${esc(receipt.id)}</td><td>${esc(receipt.receiptDate)}</td><td>${esc(line.itemCode)}</td><td>${line.quantity}</td><td>${esc(line.warehouse)}</td><td>${esc(line.location)}</td><td>${esc(line.condition)}</td><td>${esc(line.disposition)}</td><td>${receipt.jeReference?`<a href='/finance/journal/${encodeURIComponent(receipt.jeReference)}'>${esc(receipt.jeReference)}</a>`:''}</td></tr>`)).join('') || `<tr><td colspan='9'>No return receipts posted.</td></tr>`}</tbody></table></section>
    </div>`;
    $('#rgaBack').onclick = () => navigate('/sales-orders/rga');
    $('#rgaRefresh').onclick = schedule;
    $('#rgaApprove')?.addEventListener('click', async () => { try { await api('/api/rga/'+encodeURIComponent(row.id)+'/approve',{method:'POST',body:'{}'}); schedule(true); } catch(error){ alert(error.message); } });
    $('#rgaCancel')?.addEventListener('click', async () => { if(!confirm('Cancel this RGA?'))return; try { await api('/api/rga/'+encodeURIComponent(row.id)+'/cancel',{method:'POST',body:'{}'}); schedule(true); } catch(error){ alert(error.message); } });
    $('#rgaReceive')?.addEventListener('click', async () => {
      try {
        const lines=[...view.querySelectorAll('tr[data-receive-line]')].map(tr=>({lineId:tr.dataset.receiveLine,quantity:Number(tr.querySelector('.rga-receive-qty').value||0),warehouse:tr.querySelector('.rga-wh').value,location:tr.querySelector('.rga-loc').value,condition:tr.querySelector('.rga-condition').value,disposition:tr.querySelector('.rga-disposition').value})).filter(line=>line.quantity>0);
        await api('/api/rga/'+encodeURIComponent(row.id)+'/receive',{method:'POST',body:JSON.stringify({receiptDate:$('#rgaReceiptDate').value,lines})});schedule(true);
      } catch(error){alert(error.message);}
    });
    $('#rgaCredit')?.addEventListener('click', async () => {
      if(!confirm('Create and post the credit memo for this received return?'))return;
      try { const result=await api('/api/rga/'+encodeURIComponent(row.id)+'/credit',{method:'POST',body:JSON.stringify({date:today(),post:true,apply:true})}); const app=result.application||{}; alert(app.appliedAmount>0?`Credit posted. ${money(app.appliedAmount)} applied to ${row.invoiceId}.`:'Credit posted as open customer credit.'); schedule(true); } catch(error){alert(error.message);}
    });
  }

  async function renderRgaRoute(force = false) {
    if (!isRgaRoute()) return;
    const view = $('#view');
    if (!view) return;
    if (!force && view.querySelector('[data-rga-root]')) return;
    try {
      const path = location.pathname;
      if (path === '/sales-orders/rga/new') return await renderNew(view);
      const detail = path.match(/^\/sales-orders\/rga\/([^/]+)$/);
      if (detail) return await renderDetail(view, decodeURIComponent(detail[1]));
      return await renderList(view);
    } catch (error) {
      $('#title').textContent = 'Customer Returns / RGA';
      view.innerHTML = `<div data-rga-root class='rga-note rga-error'><b>Unable to load RGA workflow.</b><br>${esc(error.message)}</div>`;
    }
  }

  let timer = 0;
  function schedule(force = false) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      addStyles();
      injectNavigation();
      injectInvoiceRgaButton();
      renderRgaRoute(force);
    }, 15);
  }

  const observer = new MutationObserver(() => schedule(false));
  document.addEventListener('DOMContentLoaded', () => {
    addStyles();
    observer.observe(document.body, { childList:true, subtree:true });
    schedule(true);
  });
  window.addEventListener('popstate', () => schedule(true));
})();