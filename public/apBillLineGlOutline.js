(()=>{
  const isApBill=()=>/^\/ap\/(?:bills|approvals)\/[^/]+$/.test(location.pathname);

  // Keep the AP Bill line grid identical on new and saved bills.  The base
  // stylesheet used to hide Branch, Extended Cost, Discount, GL, PO/receipt,
  // warehouse/location, tax, and lookup columns only while the bill was new.
  // That made the entry screen materially different from the saved document.
  const parityStyle=document.createElement('style');
  parityStyle.dataset.apBillLineParity='1';
  parityStyle.textContent=`
    .new-ap-bill .ap-bill-lines-scroll{
      display:block!important;
      width:100%!important;
      max-width:100%!important;
      overflow-x:auto!important;
      overflow-y:visible!important;
    }
    .new-ap-bill .compact-ap-lines{
      width:100%!important;
      min-width:1500px!important;
      table-layout:auto!important;
    }
    .new-ap-bill .compact-ap-lines th,
    .new-ap-bill .compact-ap-lines td{
      display:table-cell!important;
    }
  `;
  document.head.appendChild(parityStyle);

  function normalize(){
    if(!isApBill())return;
    const table=document.querySelector('#billLines .compact-ap-lines');
    if(!table)return;
    const headers=[...table.querySelectorAll('tr:first-child th')];
    headers.forEach(header=>{
      const label=header.textContent.trim();
      if(label==='Account')header.textContent='GL Code';
      else if(label==='Account Description')header.textContent='GL Account Description';
    });
    [...table.querySelectorAll('tr')].slice(1).forEach(row=>{
      const select=row.querySelector('.ln-exp');if(!select)return;
      const code=String(select.value||'').trim();
      const description=String(row.querySelector('.ln-account-description')?.textContent||'').trim();
      const po=String(row.querySelector('.ln-po')?.value||'').trim();
      let note=select.parentElement.querySelector('.ap-effective-gl');
      if(!note){note=document.createElement('small');note.className='ap-effective-gl';select.after(note);}
      const text=`${po?'PO posting basis':'GL'}: ${code||'—'}${description?` — ${description}`:''}`;
      if(note.textContent!==text)note.textContent=text;
      note.style.display='block';note.style.fontSize='11px';note.style.opacity='.72';note.style.marginTop='3px';
      if(code&&!select.title)select.title=description?`${code} — ${description}`:code;
    });
  }
  let queued=false;
  const scan=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;normalize();});};
  new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('input',event=>{if(event.target?.closest?.('#billLines'))scan();},true);
  document.addEventListener('change',event=>{if(event.target?.closest?.('#billLines'))scan();},true);
  document.addEventListener('click',event=>{if(event.target?.closest?.('[data-tab="billLines"]'))setTimeout(normalize,0);},true);
  window.addEventListener('popstate',()=>setTimeout(normalize,0));
  setInterval(normalize,180);
  normalize();
})();
