(() => {
  'use strict';

  const TYPES = new Set(['Payment', 'Prepayment', 'Cash Payment']);
  const originalFetch = window.fetch.bind(window);
  const documentCache = new Map();
  let coaPromise = null;
  let poRequestToken = 0;

  const paymentListRoute = () => location.pathname === '/ap/payments';
  const paymentDetailMatch = () => location.pathname.match(/^\/ap\/payments\/([^/]+)$/);
  const isNewPayment = () => ['/ap/payments/new', '/ap/payments/__new__'].includes(location.pathname);
  const routeKey = () => `${location.pathname}${location.search}`;

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

  async function parseResponse(response) {
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!response.ok) throw new Error(data.error || data.message || text || `Request failed (${response.status})`);
    return data;
  }

  async function api(path, options = {}) {
    return parseResponse(await fetch(path, { credentials: 'same-origin', ...options }));
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
      return new Response(JSON.stringify(filtered), { status: response.status, statusText: response.statusText, headers });
    }

    if (url && ['POST', 'PUT'].includes(method) && url.pathname.startsWith('/api/ap/documents') && location.pathname.startsWith('/ap/payments/') && typeof options.body === 'string') {
      try {
        const body = JSON.parse(options.body);
        const type = activeType();
        body.type = type;
        if (type === 'Prepayment') {
          const selectedPo = document.querySelector("input[name='apPrepaymentPo']:checked");
          if (!selectedPo) return new Response(JSON.stringify({ error: 'Select an open Purchase Order for this vendor prepayment.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
          body.poId = selectedPo.dataset.poId || '';
          body.poNumber = selectedPo.dataset.poNumber || body.poId;
          body.applications = [];
        } else if (type === 'Cash Payment') {
          const glAccount = document.getElementById('cashPaymentGlAccount')?.value || '';
          if (!glAccount) return new Response(JSON.stringify({ error: 'Select a GL account for this cash payment.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
          body.glAccount = glAccount.split(' - ')[0].trim();
          body.balance = 0;
          body.applications = [];
        }
        options = { ...options, body: JSON.stringify(body) };
      } catch (error) {
        console.error('Unable to prepare AP payment-type payload', error);
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
      const link = document.createElement('a'); link.href = '/ap/payments/new?type=Prepayment'; link.innerHTML = '<button type="button">New Prepayment</button>'; actions.appendChild(link);
    }
    if (!header.querySelector("a[href='/ap/payments/new?type=CashPayment']")) {
      const link = document.createElement('a'); link.href = '/ap/payments/new?type=CashPayment'; link.innerHTML = '<button type="button">Cash Payment</button>'; actions.appendChild(link);
    }
  }

  function typeInput() {
    return [...document.querySelectorAll('#view label')].find(label => String(label.childNodes[0]?.textContent || label.textContent || '').trim().startsWith('Type'))?.querySelector('input');
  }
  function currentVendorId() {
    const hidden = String(document.getElementById('pVendorSearch')?.value || '').trim();
    const number = String(document.getElementById('pVendorNumber')?.value || '').trim();
    return (hidden || number).split(/\s+-\s+|\s+—\s+/)[0].trim();
  }
  async function loadDocumentForRoute() {
    const match = paymentDetailMatch(); if (!match || ['new', '__new__'].includes(match[1])) return null;
    const id = decodeURIComponent(match[1]);
    if (!documentCache.has(id)) documentCache.set(id, api(`/api/ap/documents/${encodeURIComponent(id)}`));
    return documentCache.get(id);
  }
  function hideLegacyApplications(tabLabel) {
    const docs = document.getElementById('docs'); if (!docs) return;
    document.getElementById('loadDocs')?.classList.add('hidden');
    document.getElementById('docsGrid')?.classList.add('hidden');
    const tab = document.querySelector("#view .tab[data-tab='docs']");
    if (tab && tab.textContent !== tabLabel) tab.textContent = tabLabel;
  }
  function fmtMoney(value) { return Number(value || 0).toLocaleString(undefined, { style:'currency', currency:'USD' }); }

  async function renderPrepaymentPos(documentData = null) {
    if (activeType() !== 'Prepayment') return;
    const host = document.getElementById('apPrepaymentPoPanel'); if (!host) return;
    const vendorId = currentVendorId(); const token = ++poRequestToken;
    const desiredPo = documentData?.poId || documentData?.poNumber || '';
    if (host.dataset.vendorId === vendorId && host.dataset.linkedPo === String(desiredPo) && host.dataset.loaded === '1') return;
    host.dataset.vendorId = vendorId; host.dataset.linkedPo = String(desiredPo); host.dataset.loaded = '0';
    if (!vendorId) { host.innerHTML = '<h4>Purchase Order</h4><p>Select a vendor to load its open purchase orders.</p>'; host.dataset.loaded = '1'; return; }
    host.innerHTML = '<h4>Purchase Order</h4><p>Loading open purchase orders…</p>';
    try {
      const rows = await api('/api/purchase-orders'); if (token !== poRequestToken || activeType() !== 'Prepayment') return;
      const open = (Array.isArray(rows) ? rows : []).filter(po => po.vendorId === vendorId && ['Open','Partially Received','Received'].includes(po.status) && Number(po.openPoBalance || 0) > 0);
      const previous = document.querySelector("input[name='apPrepaymentPo']:checked")?.dataset.poId || documentData?.poId || documentData?.poNumber || '';
      const locked = Boolean(documentData?.id && documentData.id !== '<NEW>');
      host.innerHTML = `<h4>Purchase Order</h4><p>This prepayment is held in <b>1960 - Vendor Deposit</b>. When goods are received, the receipt uses the available deposit before RNI.</p><div class='table-wrap'><table><thead><tr><th></th><th>PO Number</th><th>Status</th><th>PO Total</th><th>Open Balance</th><th>Prepayment Required</th><th>Prepaid</th></tr></thead><tbody>${open.map(po => `<tr><td><input type='radio' name='apPrepaymentPo' data-po-id='${String(po.id || '').replaceAll("'", '&#39;')}' data-po-number='${String(po.poNumber || po.id || '').replaceAll("'", '&#39;')}' ${String(previous) === String(po.id) || String(previous) === String(po.poNumber) ? 'checked' : ''} ${locked ? 'disabled' : ''}></td><td><a class='link' href='/purchase-orders/orders/${encodeURIComponent(po.poNumber || po.id)}'>${po.poNumber || po.id}</a></td><td>${po.status || ''}</td><td>${fmtMoney(po.poTotal)}</td><td>${fmtMoney(po.openPoBalance)}</td><td>${fmtMoney(po.prepaymentRequired)}</td><td>${fmtMoney(po.prepaymentTotal)}</td></tr>`).join('') || `<tr><td colspan='7'>No open purchase orders are available for this vendor.</td></tr>`}</tbody></table></div>`;
      host.dataset.loaded = '1';
    } catch (error) { host.innerHTML = `<h4>Purchase Order</h4><p>${error.message}</p>`; host.dataset.loaded = '1'; }
  }

  async function ensurePrepaymentPanel(documentData = null) {
    hideLegacyApplications('Purchase Order');
    const docs = document.getElementById('docs'); if (!docs) return;
    let panel = document.getElementById('apPrepaymentPoPanel');
    if (!panel) { panel = document.createElement('section'); panel.id = 'apPrepaymentPoPanel'; panel.className = 'panel'; docs.prepend(panel); }
    await renderPrepaymentPos(documentData);
    const fin = document.getElementById('fin');
    const finKey = `Prepayment|${documentData?.poNumber || documentData?.poId || ''}|${documentData?.jeNumber || documentData?.journalEntryNumber || ''}`;
    if (fin && fin.dataset.apPaymentFinKey !== finKey) { fin.dataset.apPaymentFinKey = finKey; fin.innerHTML = `<table><tr><td>Debit Account</td><td>1960 - Vendor Deposit</td></tr><tr><td>Credit Account</td><td>${document.getElementById('pCash')?.value || ''}</td></tr><tr><td>Linked PO</td><td>${documentData?.poNumber || documentData?.poId || document.querySelector("input[name='apPrepaymentPo']:checked")?.dataset.poNumber || ''}</td></tr><tr><td>Journal Entry Reference</td><td>${documentData?.jeNumber || documentData?.journalEntryNumber || ''}</td></tr></table>`; }
  }

  async function chartOfAccounts() { if (!coaPromise) coaPromise = api('/api/finance/chart-of-accounts'); return coaPromise; }
  async function ensureCashPaymentPanel(documentData = null) {
    hideLegacyApplications('GL Distribution');
    const docs = document.getElementById('docs'); if (!docs) return;
    let panel = document.getElementById('cashPaymentGlPanel');
    if (!panel) { panel = document.createElement('section'); panel.id = 'cashPaymentGlPanel'; panel.className = 'panel'; panel.innerHTML = `<h4>Cash Payment GL Distribution</h4><p>Debit the selected GL account and credit the selected cash account.</p><label>GL Account<select id='cashPaymentGlAccount'><option value=''>Select GL Account</option></select></label>`; docs.prepend(panel); }
    const select = document.getElementById('cashPaymentGlAccount');
    if (select && select.options.length <= 1) {
      try {
        const rows = await chartOfAccounts(); const saved = String(documentData?.glAccount || '');
        (Array.isArray(rows) ? rows : []).filter(account => account.active !== false).forEach(account => { const number=String(account.accountNumber||account.code||''), title=account.accountTitle||account.name||''; const option=document.createElement('option'); option.value=`${number} - ${title}`; option.textContent=`${number} - ${title}`; if(number===saved)option.selected=true; select.appendChild(option); });
      } catch (error) { console.error('Unable to load cash payment GL accounts', error); }
    }
    if (document.getElementById('pUnap')) document.getElementById('pUnap').value = '0.00';
    if (document.getElementById('pApplied')) document.getElementById('pApplied').value = '0.00';
    const fin = document.getElementById('fin'); const finKey=`Cash Payment|${documentData?.glAccount||''}|${documentData?.jeNumber||documentData?.journalEntryNumber||''}`;
    if (fin && fin.dataset.apPaymentFinKey !== finKey) { fin.dataset.apPaymentFinKey=finKey; fin.innerHTML=`<table><tr><td>Debit GL Account</td><td id='cashPaymentFinGl'>${documentData?.glAccount || select?.value || ''}</td></tr><tr><td>Credit Cash Account</td><td>${document.getElementById('pCash')?.value || ''}</td></tr><tr><td>Journal Entry Reference</td><td>${documentData?.jeNumber || documentData?.journalEntryNumber || ''}</td></tr></table>`; }
    if (select && select.dataset.financialListener !== '1') { select.dataset.financialListener='1'; select.addEventListener('change',()=>{const cell=document.getElementById('cashPaymentFinGl');if(cell)cell.textContent=select.value;}); }
  }

  function ensurePrepaymentApproval(documentData) {
    const existing=document.getElementById('pApprovePrepayment'), post=document.getElementById('pPost'); if(!post)return;
    if(documentData?.posted){post.disabled=true;existing?.remove();return;}
    if(documentData?.paymentApprovalStatus==='Pending Payment Approval'){
      post.disabled=true;if(existing)return;const button=document.createElement('button');button.type='button';button.id='pApprovePrepayment';button.textContent='Approve Prepayment';button.onclick=async()=>{if(!confirm('Approve this vendor prepayment for posting?'))return;button.disabled=true;try{await api(`/api/ap/documents/${encodeURIComponent(documentData.id)}/approval-action`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve',comments:'Approved for vendor prepayment posting.'})});documentCache.delete(documentData.id);location.reload();}catch(error){alert(error.message);button.disabled=false;}};post.parentElement?.insertBefore(button,post);
    }else{existing?.remove();post.disabled=false;}
  }

  async function enhancePaymentDetail() {
    const match=paymentDetailMatch(); if(!match||!document.getElementById('pAmount'))return;
    const isNew=['new','__new__'].includes(match[1]); let data=null,type=requestedType();
    if(!isNew){try{data=await loadDocumentForRoute();}catch(error){console.error('Unable to load AP payment type',error);return;}type=TYPES.has(data?.type)?data.type:'Payment';}
    type||='Payment'; const view=document.getElementById('view');view.dataset.apPaymentDocumentType=type;view.dataset.apPaymentRouteKey=routeKey();
    const input=typeInput();if(input)input.value=type==='Payment'?(document.getElementById('pMethod')?.value==='Check'?'Check':'Payment'):type;
    const title=document.getElementById('title');if(title&&type!=='Payment'){const nextTitle=`${type} ${isNew?'<NEW>':data?.id||''} - ${data?.vendorName||''}`;if(title.textContent!==nextTitle)title.textContent=nextTitle;}
    if(type==='Prepayment'){await ensurePrepaymentPanel(data);ensurePrepaymentApproval(data||{paymentApprovalStatus:'Pending Payment Approval',posted:false});}
    else if(type==='Cash Payment'){await ensureCashPaymentPanel(data);document.getElementById('pApprovePrepayment')?.remove();if(data?.posted&&document.getElementById('pPost'))document.getElementById('pPost').disabled=true;}
  }

  function rewriteVendorDocumentLinks(){document.querySelectorAll('#vendorDocsGrid tr').forEach(row=>{const cells=row.querySelectorAll('td');if(!cells.length)return;const type=[...cells].map(cell=>cell.textContent.trim()).find(text=>['Prepayment','Cash Payment'].includes(text));if(!type)return;const link=row.querySelector("a[href^='/ap/bills/']");if(link)link.href=link.getAttribute('href').replace('/ap/bills/','/ap/payments/');});}

  document.addEventListener('input',event=>{if(!isNewPayment())return;if(activeType()==='Prepayment'&&['pVendorNumber','pVendorName'].includes(event.target?.id))setTimeout(()=>renderPrepaymentPos(null),120);if(activeType()==='Cash Payment'&&event.target?.id==='pAmount'){if(document.getElementById('pUnap'))document.getElementById('pUnap').value='0.00';if(document.getElementById('pApplied'))document.getElementById('pApplied').value='0.00';}},true);
  document.addEventListener('change',event=>{if(isNewPayment()&&activeType()==='Prepayment'&&['pVendorNumber','pVendorName','pVendorSearch'].includes(event.target?.id))setTimeout(()=>renderPrepaymentPos(null),120);},true);
  document.addEventListener('click',event=>{if(isNewPayment()&&activeType()==='Prepayment'&&event.target?.closest?.('.erp-lookup-row'))setTimeout(()=>renderPrepaymentPos(null),160);},true);

  let queued=false;function schedule(){if(queued)return;queued=true;queueMicrotask(async()=>{queued=false;ensurePaymentButtons();rewriteVendorDocumentLinks();await enhancePaymentDetail();});}
  window.addEventListener('popstate',()=>setTimeout(schedule,0));new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});setTimeout(schedule,0);
})();
