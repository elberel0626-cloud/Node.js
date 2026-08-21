(()=>{
  const HOTFIX_KEY='arProfessionalDocumentsHotfixV4';
  if(window[HOTFIX_KEY])return;
  window[HOTFIX_KEY]=true;

  const PRINTABLE_TYPES=new Set(['Invoice','Credit Memo','Debit Memo']);
  const money=value=>Number(value||0).toLocaleString('en-US',{style:'currency',currency:'USD'});
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function ensureStyles(){
    if(document.getElementById('arDocumentPdfParityStylesV4'))return;
    const style=document.createElement('style');
    style.id='arDocumentPdfParityStylesV4';
    style.textContent=`
      .ar-pdf-modal{width:min(980px,90vw)!important;height:min(760px,86vh)!important}
      .ar-parity-pdf-overlay{position:fixed;inset:0;background:rgba(15,23,42,.58);z-index:100000;display:flex;align-items:center;justify-content:center;padding:24px}
      .ar-parity-pdf-modal{width:min(980px,90vw);height:min(760px,86vh);background:#fff;border-radius:8px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.35)}
      .ar-parity-pdf-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #dbe2ea}
      .ar-parity-pdf-modal iframe{border:0;flex:1;width:100%;background:#fff}
      .ar-parity-customer-wrap{position:relative}.ar-parity-customer-results{position:absolute;z-index:1000;left:0;right:0;top:100%;max-height:260px;overflow:auto;background:#fff;border:1px solid #b9c3d2;box-shadow:0 8px 22px rgba(0,0,0,.14);display:none}
      .ar-parity-customer-results.open{display:block}.ar-parity-customer-option{padding:9px 10px;cursor:pointer;border-bottom:1px solid #edf0f4}.ar-parity-customer-option:hover{background:#eef4ff}.ar-parity-customer-option strong{display:block}.ar-parity-customer-option span{font-size:11px;color:#596579}
    `;
    document.head.appendChild(style);
  }

  async function getJson(url){
    const response=await fetch(url,{credentials:'same-origin'});
    const text=await response.text();let data={};
    try{data=text?JSON.parse(text):{};}catch{data={error:text};}
    if(!response.ok)throw new Error(data.error||data.message||text||`Request failed (${response.status})`);
    return data;
  }

  async function postJson(url,payload){
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),credentials:'same-origin'});
    const text=await response.text();let data={};
    try{data=text?JSON.parse(text):{};}catch{data={error:text};}
    if(!response.ok)throw new Error(data.error||data.message||text||`Request failed (${response.status})`);
    return data;
  }

  const documentPdfUrl=(id,download=false)=>`/api/ar/documents/${encodeURIComponent(id)}/pdf?download=${download?'1':'0'}`;
  const statementPdfUrl=(customerId,date,download=false)=>`/api/ar/reports/statement-pdf?customerId=${encodeURIComponent(customerId)}&statementDate=${encodeURIComponent(date)}&download=${download?'1':'0'}`;
  const fileName=(type,id)=>`${String(type||'AR Document').replace(/\s+/g,'-')}-${String(id||'document').replace(/[^a-zA-Z0-9._-]/g,'_')}.pdf`;

  function openPdfPreviewUrl(url,title){
    document.querySelector('.ar-parity-pdf-overlay')?.remove();
    const overlay=document.createElement('div');
    overlay.className='ar-parity-pdf-overlay';
    overlay.innerHTML=`<div class='ar-parity-pdf-modal'><div class='ar-parity-pdf-head'><strong>${esc(title)}</strong><button type='button' class='ar-parity-pdf-close'>Close</button></div><iframe title='${esc(title)}'></iframe></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('iframe').src=url;
    const close=()=>overlay.remove();
    overlay.querySelector('.ar-parity-pdf-close').onclick=close;
    overlay.onclick=event=>{if(event.target===overlay)close();};
  }

  function downloadUrl(url,name){
    const link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();
  }

  function printUrl(url){
    const frame=document.createElement('iframe');
    frame.style.position='fixed';frame.style.right='0';frame.style.bottom='0';frame.style.width='1px';frame.style.height='1px';frame.style.opacity='0';frame.src=url;
    document.body.appendChild(frame);
    frame.onload=()=>setTimeout(()=>{try{frame.contentWindow?.focus();frame.contentWindow?.print();}finally{setTimeout(()=>frame.remove(),3000);}},350);
  }

  function runDocumentPdfAction(action,id,type){
    if(action==='view')return openPdfPreviewUrl(documentPdfUrl(id,false),`${type} ${id}`);
    if(action==='download')return downloadUrl(documentPdfUrl(id,true),fileName(type,id));
    if(action==='print')return printUrl(documentPdfUrl(id,false));
  }

  function mountCustomerSearch(host,customers,onSelect){
    host.innerHTML="<div class='ar-parity-customer-wrap'><input class='ar-customer-search' autocomplete='off' placeholder='Type customer number or name'><div class='ar-parity-customer-results'></div></div>";
    const input=host.querySelector('input'),results=host.querySelector('.ar-parity-customer-results');
    const matches=()=>{const q=input.value.trim().toLowerCase();return customers.filter(customer=>!q||String(customer.id||'').toLowerCase().includes(q)||String(customer.name||'').toLowerCase().includes(q)||String(customer.email||'').toLowerCase().includes(q)).slice(0,30);};
    const render=()=>{const list=matches();results.innerHTML=list.length?list.map(customer=>`<div class='ar-parity-customer-option' data-id='${esc(customer.id)}'><strong>${esc(customer.id)} — ${esc(customer.name)}</strong><span>${esc(customer.email||'No email')}</span></div>`).join(''):"<div class='ar-parity-customer-option'><span>No matching customers</span></div>";results.classList.add('open');results.querySelectorAll('[data-id]').forEach(row=>row.onmousedown=event=>{event.preventDefault();const selected=customers.find(customer=>String(customer.id)===String(row.dataset.id));if(!selected)return;input.value=`${selected.id} — ${selected.name}`;results.classList.remove('open');onSelect(selected);});};
    input.onfocus=render;input.oninput=render;input.onkeydown=event=>{if(event.key==='Escape')results.classList.remove('open');if(event.key==='Enter'){event.preventDefault();const selected=matches()[0];if(selected){input.value=`${selected.id} — ${selected.name}`;results.classList.remove('open');onSelect(selected);}}};input.onblur=()=>setTimeout(()=>results.classList.remove('open'),120);
  }

  async function renderPrintArWorkspace(view){
    if(view.dataset.arPdfParityPrint==='v4')return;
    view.dataset.arPdfParityPrint='v4';
    ensureStyles();
    const customers=await getJson('/api/ar/customers');
    if(location.pathname!=='/ar/processes/print-ar')return;
    let customer=null,documents=[],selected=null;
    view.innerHTML=`<section class='ar-doc-workspace'><div class='ar-doc-card'><div class='header-row'><h3>Print AR Documents</h3><div class='ar-doc-toolbar'><button id='arParityView' disabled>View Document</button><button id='arParityDownload' disabled>Download PDF</button><button id='arParityEmail' disabled>Email</button><button id='arParityPrint' disabled>Print</button></div></div><div class='ar-doc-header'><label class='ar-doc-label'>Customer Search<div id='arParityCustomerSearch'></div></label><div class='ar-doc-message'>Select one posted invoice, credit memo, or debit memo below. Actions apply to the selected document only.</div></div></div><div id='arParityGrid' class='ar-doc-card'><div class='ar-doc-empty'>Select a customer to load AR documents.</div></div><div id='arParityMessage'></div></section>`;

    const message=(text,error=false)=>{const host=document.getElementById('arParityMessage');if(host)host.innerHTML=text?`<div class='ar-doc-message ${error?'error':''}'>${esc(text)}</div>`:'';};
    const syncButtons=()=>{
      ['arParityView','arParityDownload','arParityPrint'].forEach(id=>{const button=document.getElementById(id);if(button)button.disabled=!selected;});
      const email=document.getElementById('arParityEmail');if(email)email.disabled=!selected||!customer?.email;
      const view=document.getElementById('arParityView');if(view)view.textContent=selected?`View ${selected.type}`:'View Document';
    };
    const render=()=>{
      const grid=document.getElementById('arParityGrid');if(!grid)return;
      grid.innerHTML=documents.length?`<div class='header-row'><h4>${esc(customer.name)} — AR Documents</h4><span>${documents.length} document${documents.length===1?'':'s'}</span></div><div class='ar-doc-table-wrap'><table class='ar-doc-table'><thead><tr><th></th><th>Type</th><th>Reference #</th><th>Document Date</th><th>Due Date</th><th>Customer PO</th><th>Sales Order</th><th class='num'>Amount</th><th class='num'>Balance</th><th>Status</th></tr></thead><tbody>${documents.map(document=>`<tr data-id='${esc(document.id)}'><td><input type='radio' name='arParityPick' value='${esc(document.id)}'></td><td>${esc(document.type)}</td><td><a href='/ar/doc/${encodeURIComponent(document.id)}'>${esc(document.id)}</a></td><td>${esc(document.date||'')}</td><td>${esc(document.dueDate||'')}</td><td>${esc(document.customerPO||'')}</td><td>${esc(document.sourceSalesOrderNumber||document.orderNumber||'')}</td><td class='num'>${money(document.amount)}</td><td class='num'>${money(document.balance)}</td><td>${esc(document.status||'')}</td></tr>`).join('')}</tbody></table></div>`:"<div class='ar-doc-empty'>No posted invoices, credit memos, or debit memos were found for this customer.</div>";
      grid.querySelectorAll('input[name="arParityPick"]').forEach(radio=>radio.onchange=()=>{selected=documents.find(document=>String(document.id)===String(radio.value))||null;syncButtons();});
      grid.querySelectorAll('tbody tr').forEach(row=>row.onclick=event=>{if(event.target.closest('a'))return;const radio=row.querySelector('input[type=radio]');if(radio){radio.checked=true;radio.dispatchEvent(new Event('change'));}});
      selected=null;syncButtons();
    };
    const load=async selectedCustomer=>{
      customer=selectedCustomer;selected=null;syncButtons();message('Loading AR documents...');
      try{
        const all=await getJson('/api/ar/documents?customerId='+encodeURIComponent(selectedCustomer.id));
        documents=all.filter(document=>PRINTABLE_TYPES.has(document.type)&&document.posted===true&&document.status!=='Voided').sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.id||'').localeCompare(String(a.id||'')));
        message('');render();
      }catch(error){documents=[];render();message(error.message,true);}
    };
    mountCustomerSearch(document.getElementById('arParityCustomerSearch'),customers,load);

    document.getElementById('arParityView').onclick=()=>selected&&runDocumentPdfAction('view',selected.id,selected.type);
    document.getElementById('arParityDownload').onclick=()=>selected&&runDocumentPdfAction('download',selected.id,selected.type);
    document.getElementById('arParityPrint').onclick=()=>selected&&runDocumentPdfAction('print',selected.id,selected.type);
    document.getElementById('arParityEmail').onclick=async()=>{if(!selected||!customer?.email)return;if(!confirm(`Email ${selected.type.toLowerCase()} ${selected.id} to ${customer.email}?`))return;const button=document.getElementById('arParityEmail');button.disabled=true;try{const result=await postJson('/api/ar/invoices/send',{invoiceIds:[selected.id]});const failure=result.results?.find(row=>row.emailStatus==='Failed');if(result.failed||failure)throw new Error(failure?.errorMessage||'Email failed.');message(`${selected.type} ${selected.id} emailed to ${customer.email}.`);}catch(error){message(error.message,true);}finally{syncButtons();}};
  }

  function enhanceInvoiceMemoDetail(view){
    if(!location.pathname.startsWith('/ar/doc/'))return;
    view.querySelector('#arDetailPdfView')?.remove();
    const typeSelect=view.querySelector('#dtype'),inquiry=view.querySelector('#inqSel');
    const type=typeSelect?.value;
    if(!PRINTABLE_TYPES.has(type)||!inquiry||inquiry.dataset.arPdfParityBound==='v4')return;
    const id=decodeURIComponent(location.pathname.split('/').pop());if(!id||id==='<NEW>')return;
    ensureStyles();

    const replacement=inquiry.cloneNode(false);
    replacement.id='inqSel';replacement.dataset.arPdfParityBound='v4';replacement.dataset.professionalPdfBound='1';
    replacement.innerHTML=`<option value=''>Inquiry</option><option value='view'>View ${esc(type)}</option><option value='download'>Download ${esc(type)}</option><option value='print'>Print ${esc(type)}</option><option value='je'>View Journal Entry</option><option value='apps'>View Applications</option>`;
    inquiry.replaceWith(replacement);

    replacement.onchange=event=>{
      event.preventDefault();event.stopPropagation();
      const action=replacement.value;replacement.value='';
      if(['view','download','print'].includes(action))return runDocumentPdfAction(action,id,type);
      if(action==='apps')return view.querySelector("[data-tab='tab-app']")?.click();
      if(action==='je'){
        const link=view.querySelector("#tab-fin a[href^='/finance/journal/']");
        if(link)return link.click();
        return view.querySelector("[data-tab='tab-fin']")?.click();
      }
    };
  }

  function statementSelection(){
    const raw=document.querySelector('#arStmtCustomerSearch input')?.value||'';
    return {customerId:raw.split(' — ')[0].trim(),date:document.getElementById('arStmtDate')?.value||new Date().toISOString().slice(0,10)};
  }

  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.id==='arStmtView'){
      const {customerId,date}=statementSelection();if(!customerId)return;
      event.preventDefault();event.stopImmediatePropagation();openPdfPreviewUrl(statementPdfUrl(customerId,date,false),`Statement - ${customerId}`);
    }
    if(button.id==='arStmtPrint'){
      const {customerId,date}=statementSelection();if(!customerId)return;
      event.preventDefault();event.stopImmediatePropagation();printUrl(statementPdfUrl(customerId,date,false));
    }
  },true);

  async function enhance(){
    const view=document.getElementById('view');if(!view)return;
    try{
      if(location.pathname==='/ar/processes/print-ar')return await renderPrintArWorkspace(view);
      enhanceInvoiceMemoDetail(view);
    }catch(error){console.error('AR document PDF parity enhancement failed',error);}
  }

  function boot(){
    ensureStyles();
    const view=document.getElementById('view');
    if(view)new MutationObserver(()=>setTimeout(enhance,0)).observe(view,{childList:true,subtree:false});
    window.addEventListener('popstate',()=>setTimeout(enhance,0));
    setTimeout(enhance,0);
  }
  if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
