(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const reviewRoute = () => location.pathname.match(/^\/ap\/incoming-documents\/([^/]+)\/review$/);
  const request = async (url, options = {}) => {
    const response = await fetch(url, { credentials:'same-origin', ...options });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error:text }; }
    if (!response.ok) { const error = new Error(data.error || data.message || `Request failed (${response.status})`); error.code=data.code||''; throw error; }
    return data;
  };
  const showError = message => {
    const overlay=document.createElement('div'); overlay.className='cn-overlay';
    overlay.innerHTML=`<div class='cn-modal'><div class='cn-head'><h3>Unable to Create AP Bill</h3></div><div class='cn-list'><p>${esc(message)}</p></div><div class='cn-foot'><button type='button' id='incomingCreateClose'>Close</button></div></div>`;
    document.body.appendChild(overlay); overlay.querySelector('#incomingCreateClose').onclick=()=>overlay.remove();
  };
  const navigate = url => { history.pushState({},'',url); window.dispatchEvent(new PopStateEvent('popstate')); };

  const reviewLineRows = () => [...document.querySelectorAll('#invoiceReviewForm table tr')]
    .filter(row => row.querySelector('[data-line][data-line-field]'));

  function ensureReviewLineSourceIndexes() {
    reviewLineRows().forEach((row, position) => {
      if (row.dataset.reviewSourceIndex !== undefined) return;
      const first = row.querySelector('[data-line]');
      row.dataset.reviewSourceIndex = String(first?.dataset.line ?? position);
    });
  }

  function collectReviewedLines(sourceLines = []) {
    ensureReviewLineSourceIndexes();
    return reviewLineRows().map((row, position) => {
      const sourceIndex = Number(row.dataset.reviewSourceIndex ?? position);
      const base = { ...(sourceLines[sourceIndex] || sourceLines[position] || {}) };
      row.querySelectorAll('[data-line-field]').forEach(input => {
        base[input.dataset.lineField] = input.value;
      });
      return base;
    });
  }

  const numeric = value => {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? number : 0;
  };

  function synchronizeReviewedTotals(extracted) {
    const lines = Array.isArray(extracted.lines) ? extracted.lines : [];
    const subtotal = lines.reduce((sum, line) => {
      const rawExtended = line.extendedAmount ?? line.extendedCost;
      if (rawExtended !== undefined && rawExtended !== null && String(rawExtended).trim() !== '') return sum + numeric(rawExtended);
      return sum + numeric(line.qty ?? line.quantity) * numeric(line.unitPrice ?? line.unitCost);
    }, 0);
    const tax = numeric(extracted.taxAmount);
    const freight = numeric(extracted.freightAmount);
    extracted.subtotal = Number(subtotal.toFixed(2));
    extracted.grossInvoiceAmount = Number((subtotal + tax + freight).toFixed(2));
    extracted.totalAmount = extracted.grossInvoiceAmount;
    return extracted;
  }

  function synchronizeReviewTotalsFromDom() {
    if (!reviewRoute()) return;
    const sourceLines = reviewLineRows().map(() => ({}));
    const extracted = { lines: collectReviewedLines(sourceLines) };
    document.querySelectorAll('#invoiceReviewForm [data-field]').forEach(input => { extracted[input.dataset.field] = input.value; });
    synchronizeReviewedTotals(extracted);
    const subtotal = document.querySelector("#invoiceReviewForm [data-field='subtotal']");
    const gross = document.querySelector("#invoiceReviewForm [data-field='grossInvoiceAmount']");
    if (subtotal) subtotal.value = Number(extracted.subtotal || 0).toFixed(2);
    if (gross) gross.value = Number(extracted.grossInvoiceAmount || 0).toFixed(2);
  }

  function enhanceReviewLineEditing() {
    if (!reviewRoute()) return;
    const rows = reviewLineRows();
    if (!rows.length) return;
    ensureReviewLineSourceIndexes();
    const table = rows[0].closest('table');
    const header = table?.querySelector('tr');
    if (header && !header.querySelector('.incoming-review-line-actions-head')) {
      const th = document.createElement('th');
      th.className = 'incoming-review-line-actions-head';
      th.textContent = 'Actions';
      header.appendChild(th);
    }
    rows.forEach(row => {
      if (row.querySelector('.incoming-review-line-delete')) return;
      const cell = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'incoming-review-line-delete';
      button.textContent = 'Delete';
      button.title = 'Remove this line from the reviewed invoice and created AP Bill.';
      cell.appendChild(button);
      row.appendChild(cell);
    });
  }

  function reviewedPayload(doc) {
    const extracted={...(doc.extracted||{})};
    document.querySelectorAll('#invoiceReviewForm [data-field]').forEach(input=>{extracted[input.dataset.field]=input.value;});
    extracted.lines=collectReviewedLines(extracted.lines||[]);
    synchronizeReviewedTotals(extracted);
    const poInput=document.querySelector("#invoiceReviewForm [data-field='purchaseOrderNumber']");
    if(poInput){const po=String(poInput.value||'').trim();extracted.purchaseOrderNumber=po;extracted.poNumber=po;}
    const vendorId=String(document.getElementById('reviewVendorId')?.value||document.getElementById('reviewVendorNumber')?.value||doc.vendorMatch?.vendorId||'').trim().split(/\s+—\s+|\s+-\s+/)[0].trim();
    const vendorName=String(document.getElementById('reviewVendorName')?.value||doc.vendorMatch?.vendorName||'').trim();
    return {
      status:doc.status==='Ready for Review'?'In Review':doc.status,
      extracted,
      vendorMatch:{...(doc.vendorMatch||{}),vendorId,vendorName},
      assignedProcurementPersonUserId:document.getElementById('reviewProcurementPerson')?.value||doc.assignedProcurementPersonUserId||'',
      approverUserId:doc.approverUserId||'',
      invoiceClassification:document.getElementById('reviewFinalClassification')?.value||doc.invoiceClassification||'',
      classificationOverrideReason:document.getElementById('reviewClassificationOverride')?.value.trim()||doc.classificationOverrideReason||'',
      user:'ap.clerk'
    };
  }

  function installIncomingReviewSaveInterceptor() {
    if (window.__incomingReviewLineSaveInterceptorInstalled) return;
    window.__incomingReviewLineSaveInterceptorInstalled = true;
    const priorFetch = window.fetch.bind(window);
    window.fetch = async (input, options = {}) => {
      try {
        const route = reviewRoute();
        const method = String(options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        const url = String(input instanceof Request ? input.url : input || '');
        if (route && method === 'PUT' && url.includes(`/api/ap/incoming-documents/${encodeURIComponent(decodeURIComponent(route[1]))}`) && typeof options.body === 'string') {
          const body = JSON.parse(options.body);
          if (body?.extracted && Array.isArray(body.extracted.lines) && document.querySelector('#invoiceReviewForm')) {
            body.extracted.lines = collectReviewedLines(body.extracted.lines);
            synchronizeReviewedTotals(body.extracted);
            options = { ...options, body: JSON.stringify(body) };
          }
        }
      } catch (error) {
        console.error('Unable to synchronize reviewed invoice lines before save', error);
      }
      return priorFetch(input, options);
    };
  }

  document.addEventListener('click', async event => {
    const deleteLine = event.target.closest('.incoming-review-line-delete');
    if (deleteLine && reviewRoute()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const row = deleteLine.closest('tr');
      if (!row) return;
      row.remove();
      synchronizeReviewTotalsFromDom();
      const dirtyMarker = document.querySelector("#invoiceReviewForm [data-field='description']") || document.querySelector('#invoiceReviewForm [data-field]');
      dirtyMarker?.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    const button=event.target.closest('#createBill');
    const route=reviewRoute();
    if(!button||!route)return;
    event.preventDefault(); event.stopImmediatePropagation();
    if(button.dataset.processing==='1')return;
    button.dataset.processing='1'; button.disabled=true; const original=button.textContent; button.textContent='Creating AP Bill…';
    const documentId=decodeURIComponent(route[1]);
    try {
      const current=await request(`/api/ap/incoming-documents/${encodeURIComponent(documentId)}`);
      await request(`/api/ap/incoming-documents/${encodeURIComponent(documentId)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(reviewedPayload(current))});
      let result;
      try { result=await request(`/api/ap/incoming-documents/${encodeURIComponent(documentId)}/create-bill`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({overrideDuplicate:false})}); }
      catch(error){
        if(/duplicate/i.test(error.message) && confirm(`${error.message}\n\nCreate the AP Bill anyway?`)) result=await request(`/api/ap/incoming-documents/${encodeURIComponent(documentId)}/create-bill`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({overrideDuplicate:true})});
        else throw error;
      }
      if(!result?.billId)throw new Error('The server did not return the new AP Bill reference.');
      navigate(`/ap/bills/${encodeURIComponent(result.billId)}`);
    } catch(error) { showError(error.message); }
    finally { if(button.isConnected){button.dataset.processing='';button.disabled=false;button.textContent=original;} }
  }, true);

  document.addEventListener('input', event => {
    if (!reviewRoute() || !event.target?.matches?.('#invoiceReviewForm [data-line][data-line-field]')) return;
    queueMicrotask(synchronizeReviewTotalsFromDom);
  }, true);

  let enhanceQueued = false;
  const scheduleLineEnhancement = () => {
    if (enhanceQueued) return;
    enhanceQueued = true;
    queueMicrotask(() => {
      enhanceQueued = false;
      enhanceReviewLineEditing();
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installIncomingReviewSaveInterceptor, { once:true });
  else installIncomingReviewSaveInterceptor();
  window.addEventListener('popstate', scheduleLineEnhancement);
  new MutationObserver(scheduleLineEnhancement).observe(document.documentElement, { childList:true, subtree:true });
  scheduleLineEnhancement();
})();
