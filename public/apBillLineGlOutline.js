(()=>{
  const isApBill=()=>/^\/ap\/(?:bills|approvals)\/[^/]+$/.test(location.pathname);
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let accountPromise=null,accounts=[],accountByCode=new Map();

  const parityStyle=document.createElement('style');
  parityStyle.dataset.apBillLineParity='1';
  parityStyle.textContent=`
    .new-ap-bill .ap-bill-lines-scroll{display:block!important;width:100%!important;max-width:100%!important;overflow-x:auto!important;overflow-y:visible!important}
    .new-ap-bill .compact-ap-lines{width:100%!important;min-width:1500px!important;table-layout:auto!important}
    .new-ap-bill .compact-ap-lines th,.new-ap-bill .compact-ap-lines td{display:table-cell!important}
    #billLines .ap-gl-native-select{display:none!important}
    #billLines .ap-gl-search-input{width:100%!important;min-width:115px!important;background-image:none!important}
    .ap-gl-account-suggestions{z-index:32000!important;max-height:310px;overflow:auto}
    .ap-gl-account-suggestions .erp-lookup-row{grid-template-columns:90px 1fr!important}
  `;
  document.head.appendChild(parityStyle);

  const loadAccounts=()=>{
    if(!accountPromise){
      accountPromise=fetch('/api/finance/chart-of-accounts',{credentials:'same-origin',cache:'no-store'}).then(async response=>{
        if(!response.ok)throw new Error(`Unable to load GL accounts (${response.status})`);
        const rows=await response.json();
        accounts=(Array.isArray(rows)?rows:[]).map(row=>({code:String(row.accountNumber??row.code??'').trim(),name:String(row.accountTitle??row.name??'').trim(),active:row.active!==false})).filter(row=>row.active&&row.code);
        accountByCode=new Map(accounts.map(row=>[row.code.toLowerCase(),row]));
        return accounts;
      }).catch(error=>{accountPromise=null;throw error;});
    }
    return accountPromise;
  };

  const closeAll=except=>document.querySelectorAll('.ap-gl-account-suggestions').forEach(panel=>{if(panel!==except)panel.classList.add('hidden');});

  function enhanceGlSelect(select){
    if(!select||select.dataset.apGlSearchEnhanced==='1')return;
    select.dataset.apGlSearchEnhanced='1';
    select.classList.add('ap-gl-native-select');
    const input=document.createElement('input');
    input.type='text';
    input.className='ap-gl-search-input';
    input.autocomplete='off';
    input.spellcheck=false;
    input.placeholder='Type code or account name';
    input.disabled=select.disabled;
    select.before(input);

    const panel=document.createElement('div');
    panel.className='erp-lookup-panel hidden ap-gl-account-suggestions';
    const list=document.createElement('div');
    list.className='erp-lookup-list';
    panel.appendChild(list);
    document.body.appendChild(panel);
    let shown=[],active=-1,choosing=false;

    const allowedCodes=()=>new Set([...select.options].map(option=>String(option.value||'').trim()).filter(Boolean));
    const eligibleAccounts=()=>{const allowed=allowedCodes();return accounts.filter(account=>allowed.has(account.code));};
    const selectedAccount=()=>accountByCode.get(String(select.value||'').trim().toLowerCase())||null;
    const labelFor=account=>account?`${account.code} — ${account.name}`:String(select.value||'');
    const syncDisplay=()=>{if(choosing)return;const account=selectedAccount();input.value=labelFor(account);input.title=account?labelFor(account):'';input.disabled=select.disabled;};
    const place=()=>{if(!input.isConnected){panel.remove();return;}const rect=input.getBoundingClientRect();panel.style.left=`${Math.max(4,rect.left)}px`;panel.style.top=`${rect.bottom+2}px`;panel.style.width=`${Math.max(rect.width,390)}px`;};
    const close=()=>{panel.classList.add('hidden');active=-1;};
    const markActive=()=>list.querySelectorAll('.erp-lookup-row').forEach((row,index)=>row.classList.toggle('active',index===active));
    const pick=account=>{
      choosing=true;
      select.value=account.code;
      input.value=labelFor(account);
      input.title=labelFor(account);
      const desc=select.closest('tr')?.querySelector('.ln-account-description');if(desc)desc.textContent=account.name;
      close();
      select.dispatchEvent(new Event('input',{bubbles:true}));
      select.dispatchEvent(new Event('change',{bubbles:true}));
      choosing=false;
    };
    const render=query=>{
      closeAll(panel);
      const q=String(query||'').trim().toLowerCase();
      shown=eligibleAccounts().filter(account=>!q||account.code.toLowerCase().includes(q)||account.name.toLowerCase().includes(q)).slice(0,60);
      list.innerHTML=shown.length?shown.map((account,index)=>`<button type='button' class='erp-lookup-row ${index===active?'active':''}' data-index='${index}'><span class='erp-lookup-id'>${esc(account.code)}</span><span class='erp-lookup-name'>${esc(account.name)}</span></button>`).join(''):"<div class='erp-lookup-empty'>No matching GL accounts found</div>";
      list.querySelectorAll('button').forEach((button,index)=>{button.onpointerdown=event=>event.preventDefault();button.onclick=()=>pick(shown[index]);});
      panel.classList.remove('hidden');place();
    };

    input.addEventListener('focus',async()=>{if(input.disabled)return;try{await loadAccounts();syncDisplay();input.select();render('');}catch{}});
    input.addEventListener('input',async()=>{if(choosing||input.disabled)return;active=-1;try{await loadAccounts();render(input.value);}catch{}});
    input.addEventListener('keydown',event=>{
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();
        if(panel.classList.contains('hidden'))render(input.value);
        if(!shown.length)return;
        active=event.key==='ArrowDown'?Math.min(active+1,shown.length-1):Math.max(active<=0?shown.length-1:active-1,0);markActive();
      }else if(event.key==='Enter'){
        if(active>=0&&shown[active]){event.preventDefault();pick(shown[active]);}
        else if(shown.length===1){event.preventDefault();pick(shown[0]);}
      }else if(event.key==='Escape'){event.preventDefault();close();syncDisplay();}
    });
    input.addEventListener('blur',()=>setTimeout(()=>{close();syncDisplay();},120));
    select.addEventListener('change',syncDisplay);
    window.addEventListener('resize',place);
    window.addEventListener('scroll',place,true);
    loadAccounts().then(syncDisplay).catch(syncDisplay);
  }

  function normalize(){
    if(!isApBill()){closeAll();return;}
    const table=document.querySelector('#billLines .compact-ap-lines');
    if(!table)return;
    const headers=[...table.querySelectorAll('tr:first-child th')];
    headers.forEach(header=>{
      const label=header.textContent.trim();
      if(label==='Account')header.textContent='GL Code';
      else if(label==='Account Description')header.textContent='GL Account Description';
      else if(label==='Lookup')header.textContent='Receipt Lookup';
    });
    table.querySelectorAll('.ln-po-pick').forEach(button=>button.remove());
    [...table.querySelectorAll('tr')].slice(1).forEach(row=>{
      const select=row.querySelector('.ln-exp');if(!select)return;
      enhanceGlSelect(select);
      const code=String(select.value||'').trim();
      const account=accountByCode.get(code.toLowerCase());
      const description=account?.name||String(row.querySelector('.ln-account-description')?.textContent||'').trim();
      const po=String(row.querySelector('.ln-po')?.value||'').trim();
      let note=select.parentElement.querySelector('.ap-effective-gl');
      if(!note){note=document.createElement('small');note.className='ap-effective-gl';select.after(note);}
      const text=`${po?'PO posting basis':'GL'}: ${code||'—'}${description?` — ${description}`:''}`;
      if(note.textContent!==text)note.textContent=text;
      note.style.display='block';note.style.fontSize='11px';note.style.opacity='.72';note.style.marginTop='3px';
      if(code)select.title=description?`${code} — ${description}`:code;
    });
  }

  let queued=false;
  const scan=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;normalize();});};
  new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('input',event=>{if(event.target?.closest?.('#billLines'))scan();},true);
  document.addEventListener('change',event=>{if(event.target?.closest?.('#billLines'))scan();},true);
  document.addEventListener('click',event=>{if(event.target?.closest?.('[data-tab="billLines"]'))setTimeout(normalize,0);},true);
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('.ap-gl-account-suggestions')&&!event.target.closest('.ap-gl-search-input'))closeAll();},true);
  window.addEventListener('popstate',()=>setTimeout(normalize,0));
  setInterval(normalize,240);
  loadAccounts().catch(()=>{});
  normalize();
})();
