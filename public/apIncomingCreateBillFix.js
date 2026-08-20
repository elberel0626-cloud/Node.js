(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
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
  function reviewedPayload(doc) {
    const extracted={...(doc.extracted||{})};
    document.querySelectorAll('#invoiceReviewForm [data-field]').forEach(input=>{extracted[input.dataset.field]=input.value;});
    const lines=(extracted.lines||[]).map(line=>({...line}));
    document.querySelectorAll('#invoiceReviewForm [data-line][data-line-field]').forEach(input=>{
      const index=Number(input.dataset.line); lines[index]=lines[index]||{}; lines[index][input.dataset.lineField]=input.value;
    });
    extracted.lines=lines;
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
  document.addEventListener('click', async event => {
    const button=event.target.closest('#createBill');
    const route=location.pathname.match(/^\/ap\/incoming-documents\/([^/]+)\/review$/);
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
})();