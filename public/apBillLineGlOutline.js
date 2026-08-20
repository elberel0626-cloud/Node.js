(()=>{
  const isApBill=()=>/^\/ap\/(?:bills|approvals)\/[^/]+$/.test(location.pathname);
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
