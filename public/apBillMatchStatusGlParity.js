(()=>{
  const route=()=>location.pathname.match(/^\/ap\/(bills|approvals)\/([^/]+)$/);
  const isNew=()=>['new','__new__'].includes(decodeURIComponent(route()?.[2]||''));
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money=value=>Number(value||0).toLocaleString(undefined,{style:'currency',currency:'USD'});
  const num=value=>Number(value||0);
  const api=async(path,options={})=>{const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options}),text=await response.text();let body={};try{body=text?JSON.parse(text):{}}catch{body={error:text}}if(!response.ok)throw new Error(body.error||body.message||text||`Request failed (${response.status})`);return body};
  const style=document.createElement('style');
  style.textContent=`
    .ap-match-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin:10px 0;padding:10px;border:1px solid var(--border,#d0d5dd);border-radius:6px;background:var(--panel,#fff)}
    .ap-match-strip>div{min-width:0}.ap-match-strip span{display:block;font-size:11px;opacity:.72;margin-bottom:2px}.ap-match-strip b{font-size:13px}
    .ap-match-good{color:#18794e}.ap-match-warn{color:#9a6700}.ap-match-bad{color:#b42318}.ap-match-neutral{color:inherit}
    .ap-unsaved-match-table{margin-top:10px}.ap-unsaved-match-table table{width:100%;border-collapse:collapse}.ap-unsaved-match-table th,.ap-unsaved-match-table td{padding:7px 8px;white-space:nowrap;vertical-align:top}.ap-unsaved-match-table td.wrap{white-space:normal}
    .ap-effective-gl{display:block;font-size:11px;opacity:.72;margin-top:3px;white-space:nowrap}
  `;
  document.head.appendChild(style);

  let chartPromise=null,preferencesPromise=null,lastSignature='',timer=null,savedToken='';
  let lastPreviewMatch=null,lastPreviewLines=[],lastPreviewAccounts=[],lastPreviewPrefs={};
  const chart=()=>chartPromise||(chartPromise=api('/api/finance/chart-of-accounts').catch(()=>[]));
  const preferences=()=>preferencesPromise||(preferencesPromise=api('/api/purchase-orders/preferences').catch(()=>({preferences:{}})));
  const accountLabel=(code,accounts)=>{const row=(accounts||[]).find(account=>String(account.accountNumber||account.code)===String(code||''));return code?`${code}${row?` — ${row.accountTitle||row.name||''}`:''}`:'—'};
  const statusClass=status=>/Matched - Ready|Approved Match Exception - Ready|Posted/i.test(status)?'ap-match-good':/Waiting for Receipt|Partially Received|Pending|Variance|Exception|Blocked/i.test(status)?(/Approved Match Exception/i.test(status)?'ap-match-good':/Waiting|Partially|Pending/i.test(status)?'ap-match-warn':'ap-match-bad'):'ap-match-neutral';

  function readLines(){
    return [...document.querySelectorAll('#billLines .compact-ap-lines tr')].slice(1).map((row,index)=>({
      lineIndex:index,
      branch:row.querySelector('.ln-br')?.value||document.getElementById('bbranch')?.value||'100',
      inventoryId:row.querySelector('.ln-inv')?.value||'',
      description:row.querySelector('.ln-desc')?.value||'',
      qty:num(row.querySelector('.ln-qty')?.value),
      uom:row.querySelector('.ln-uom')?.value||'EA',
      unitCost:num(row.querySelector('.ln-cost')?.value),
      discountAmount:num(row.querySelector('.ln-disc')?.value),
      expenseAccount:row.querySelector('.ln-exp')?.value||'',
      accountDescription:row.querySelector('.ln-account-description')?.textContent?.trim()||'',
      poNumber:row.querySelector('.ln-po')?.value||'',
      receiptNumber:row.querySelector('.ln-rcpt')?.value||'',
      warehouse:row.querySelector('.ln-wh')?.value||'',
      location:row.querySelector('.ln-loc')?.value||'',
      taxCategory:row.querySelector('.ln-tax')?.value||''
    }));
  }

  function normalizeLineGrid(accounts=[],prefs={}){
    const table=document.querySelector('#billLines .compact-ap-lines');
    if(!table)return;
    const headers=[...table.querySelectorAll('tr:first-child th')];
    headers.forEach(header=>{
      const text=header.textContent.trim();
      if(text==='Account')header.textContent='GL Code';
      if(text==='Account Description')header.textContent='GL Account Description';
    });
    const rni=String(prefs.general?.receiptNotInvoicedAccount||'2020');
    [...table.querySelectorAll('tr')].slice(1).forEach(row=>{
      const select=row.querySelector('.ln-exp');
      if(!select)return;
      const po=String(row.querySelector('.ln-po')?.value||'').trim();
      const selected=String(select.value||'').trim();
      const effective=po?rni:selected;
      const label=accountLabel(selected,accounts);
      if(select.title!==label)select.title=label;
      let note=select.parentElement?.querySelector('.ap-effective-gl');
      if(!note){note=document.createElement('small');note.className='ap-effective-gl';select.after(note);}
      const noteText=po?`PO posting basis: ${accountLabel(effective,accounts)}`:`GL: ${accountLabel(effective,accounts)}`;
      if(note.textContent!==noteText)note.textContent=noteText;
      const description=row.querySelector('.ln-account-description');
      if(description&&!description.textContent.trim()&&selected){const found=accounts.find(account=>String(account.accountNumber||account.code)===selected);if(found)description.textContent=found.accountTitle||found.name||'';}
    });
  }

  function ensureStrip(){
    const workspace=document.querySelector('.erp-workspace');
    if(!workspace||!workspace.querySelector('#billLines'))return null;
    let strip=document.getElementById('apMatchStatusStrip');
    if(!strip){strip=document.createElement('section');strip.id='apMatchStatusStrip';strip.className='ap-match-strip';const header=workspace.querySelector('.new-ap-bill-header,.ap-pay-grid');if(header)header.after(strip);else workspace.prepend(strip);}
    return strip;
  }

  function renderStrip(match,{preview=false}={}){
    const strip=ensureStrip();if(!strip)return;
    const hasPo=match?.hasPo===true,status=hasPo?(match.status||'Match Exception'):(preview?'Non-PO – No 3-Way Match Required':(match?.status==='Posted'?'Posted':'Non-PO – No 3-Way Match Required'));
    const postable=!hasPo||match?.postable===true;
    strip.innerHTML=`
      <div><span>PO / Match Status</span><b id='apMatchStatusValue' class='${statusClass(status)}'>${esc(status)}</b></div>
      <div><span>Posting Control</span><b class='${postable?'ap-match-good':'ap-match-bad'}'>${postable?'Ready to Post':'Posting Blocked'}</b></div>
      <div><span>Matched Quantity</span><b>${num(match?.totals?.matchedQty)} / ${num(match?.totals?.invoiceQty)}</b></div>
      <div><span>Missing Receipt Quantity</span><b class='${num(match?.totals?.shortQty)>0?'ap-match-warn':''}'>${num(match?.totals?.shortQty)}</b></div>
      <div><span>Estimated PPV</span><b>${money(match?.totals?.priceVariance)}</b></div>
      <div><span>Status Source</span><b>${preview?'Live Unsaved Preview':'Saved AP Bill'}</b></div>`;
  }

  function renderUnsavedMatch(match,lines,accounts,prefs){
    const host=document.getElementById('newMatchV2');
    if(!host)return false;
    [...host.children].forEach(child=>{if(child.querySelector?.('h4')?.textContent?.includes('Current 3-Way Match'))child.style.display='none';});
    let section=host.querySelector('.ap-unsaved-match-table');
    if(!section){section=document.createElement('section');section.className='panel ap-unsaved-match-table';host.prepend(section);}
    const rni=String(prefs.general?.receiptNotInvoicedAccount||'2020');
    const rows=(match.lines||[]).map(result=>{const source=lines[result.lineIndex]||{},gl=source.poNumber?rni:source.expenseAccount;return `<tr>
      <td>${result.lineIndex+1}</td><td>${esc(result.poNumber||source.poNumber||'')}</td><td>${esc(result.inventoryId||source.inventoryId||'')}</td><td class='wrap'>${esc(source.description||result.description||'')}</td>
      <td>${num(result.orderedQty)}</td><td>${num(result.receivedQty)}</td><td>${num(result.previouslyBilledQty)}</td><td>${num(result.availableReceiptQty)}</td><td>${num(result.invoiceQty)}</td>
      <td>${money(result.poUnitCost)}</td><td>${money(result.invoiceUnitCost)}</td><td><b class='${statusClass(result.status)}'>${esc(result.status)}</b></td>
      <td>${esc(gl)}</td><td class='wrap'>${esc(accountLabel(gl,accounts))}</td>
    </tr>`}).join('');
    section.innerHTML=`<h4>Current 3-Way Match</h4><p><b class='${statusClass(match.status)}'>${esc(match.status)}</b> · <span class='${match.postable?'ap-match-good':'ap-match-bad'}'>${match.postable?'Matched – Ready to Post':'Posting Blocked'}</span></p>
      <div class='table-wrap'><table><tr><th>Line</th><th>PO</th><th>Item</th><th>Description</th><th>Ordered</th><th>Received</th><th>Prev Vouched</th><th>Available</th><th>Invoice Qty</th><th>PO Cost</th><th>Invoice Cost</th><th>Status</th><th>GL Code</th><th>GL Account</th></tr>${rows||"<tr><td colspan='14'>No PO-linked invoice lines.</td></tr>"}</table></div>`;
    return true;
  }

  function rememberPreview(match,lines,accounts,prefs){
    lastPreviewMatch=match;
    lastPreviewLines=(lines||[]).map(line=>({...line}));
    lastPreviewAccounts=accounts||[];
    lastPreviewPrefs=prefs||{};
  }

  function restorePreviewIfOverwritten(){
    if(!isNew()||!lastPreviewMatch)return;
    const host=document.getElementById('newMatchV2');
    if(host&&!host.querySelector('.ap-unsaved-match-table'))renderUnsavedMatch(lastPreviewMatch,lastPreviewLines,lastPreviewAccounts,lastPreviewPrefs);
  }

  async function previewNew(){
    if(!route()||!isNew())return;
    const [accounts,prefResult]=await Promise.all([chart(),preferences()]);
    const prefs=prefResult.preferences||prefResult||{};
    normalizeLineGrid(accounts,prefs);
    const lines=readLines();
    const signature=JSON.stringify(lines.map(line=>[line.poNumber,line.inventoryId,line.qty,line.unitCost,line.expenseAccount]));
    if(signature===lastSignature){restorePreviewIfOverwritten();return;}lastSignature=signature;
    if(!lines.some(line=>String(line.poNumber||'').trim())){lastPreviewMatch=null;lastPreviewLines=[];const match={hasPo:false,status:'Not Applicable',postable:true,lines:[],totals:{invoiceQty:lines.reduce((sum,line)=>sum+num(line.qty),0),matchedQty:0,shortQty:0,priceVariance:0}};renderStrip(match,{preview:true});document.querySelector('#newMatchV2 .ap-unsaved-match-table')?.remove();return;}
    try{
      const vendorId=String(document.getElementById('bvend')?.value||'').trim();
      const match=await api('/api/ap/po-match-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'Bill',status:'Draft',vendorId,lines})});
      rememberPreview(match,lines,accounts,prefs);
      renderStrip(match,{preview:true});
      renderUnsavedMatch(match,lines,accounts,prefs);
    }catch(error){lastPreviewMatch=null;const strip=ensureStrip();if(strip)strip.innerHTML=`<div><span>PO / Match Status</span><b class='ap-match-bad'>Unable to calculate match</b></div><div><span>Details</span><b>${esc(error.message)}</b></div>`;}
  }

  async function showSaved(){
    const matchRoute=route();if(!matchRoute||isNew())return;
    const id=decodeURIComponent(matchRoute[2]);
    const token=`${location.pathname}|${id}`;if(savedToken===token)return;savedToken=token;
    const [accounts,prefResult]=await Promise.all([chart(),preferences()]);normalizeLineGrid(accounts,prefResult.preferences||prefResult||{});
    try{const doc=await api(`/api/ap/documents/${encodeURIComponent(id)}`),match=doc.threeWayMatch||await api('/api/ap/po-match-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(doc)});renderStrip(match,{preview:false});}catch{}
  }

  function schedule(){clearTimeout(timer);timer=setTimeout(()=>{if(!route())return;Promise.resolve(isNew()?previewNew():showSaved()).catch(()=>{});},100);}
  new MutationObserver(()=>{
    if(!route())return;
    Promise.all([chart(),preferences()]).then(([accounts,prefResult])=>{normalizeLineGrid(accounts,prefResult.preferences||prefResult||{});restorePreviewIfOverwritten();}).catch(()=>{});
    schedule();
  }).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('input',event=>{if(event.target?.closest?.('#billLines')||['bvend','bVendorNumber','bVendorName'].includes(event.target?.id)){lastSignature='';schedule();}},true);
  document.addEventListener('change',event=>{if(event.target?.closest?.('#billLines')||['bvend','bVendorNumber','bVendorName'].includes(event.target?.id)){lastSignature='';schedule();}},true);
  document.addEventListener('click',event=>{if(event.target?.closest?.('#poApplyNewV2,.poPickNewV2,[data-tab="purchaseOrder"],[data-tab="billLines"]')){lastSignature='';setTimeout(schedule,80);}},true);
  document.addEventListener('erp:ap-vendor-selected',()=>{lastSignature='';schedule();},true);
  window.addEventListener('popstate',()=>{lastSignature='';savedToken='';lastPreviewMatch=null;lastPreviewLines=[];schedule();});
  schedule();
})();
