(()=>{
  const BILLS_PATH='/ap/bills';
  const REQUIRED_COLUMNS=['poNumbers','poMatchStatus'];
  const DEFAULT_COLUMNS=['id','vendorName','date','dueDate','status','amount','balance','poNumbers','poMatchStatus','journalEntryNumber'];
  const SETTINGS_PREFIX='erpGridSettings[AP][apBillGrid][';

  const style=document.createElement('style');
  style.dataset.apBillsPoGrid='1';
  style.textContent=`
    #apBillGrid th[data-k='poNumbers']{min-width:150px}
    #apBillGrid th[data-k='poMatchStatus']{min-width:230px}
    #apBillGrid td[data-k='poNumbers']{white-space:normal;min-width:150px}
    #apBillGrid td[data-k='poNumbers'] a{display:inline-block;margin-right:8px}
    #apBillGrid td[data-k='poMatchStatus']{white-space:normal;min-width:230px}
    #apBillGrid_filterPop{max-width:calc(100vw - 24px);box-sizing:border-box}
    .ap-list-match-pill{display:inline-block;border:1px solid currentColor;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:700;line-height:1.5}
    .ap-list-match-good{color:#18794e}.ap-list-match-warn{color:#9a6700}.ap-list-match-bad{color:#b42318}.ap-list-match-neutral{color:inherit}
  `;
  document.head.appendChild(style);

  const unique=values=>[...new Set((values||[]).map(value=>String(value||'').trim()).filter(Boolean))];
  const poNumbers=doc=>unique((doc?.lines||[]).map(line=>line.poNumber||line.sourcePoId||line.poId).concat(doc?.matchedPoNumber||doc?.poNumber||[]));
  const poMatchStatus=doc=>{
    const pos=poNumbers(doc);
    if(!pos.length)return'Non-PO';
    const match=doc?.threeWayMatch||{};
    const status=String(match.status||doc?.matchStatus||doc?.poMatchStatus||doc?.threeWayMatchStatus||(doc?.threeWayMatched?'Matched - Ready to Post':'Not Matched')).trim();
    return !status||status==='Not Applicable'?'Not Matched':status;
  };
  const enrichBill=doc=>({...doc,poNumbers:poNumbers(doc).join(', '),poMatchStatus:poMatchStatus(doc)});

  function isBillsListRequest(input,options={}){
    const method=String(options?.method||input?.method||'GET').toUpperCase();
    if(method!=='GET')return false;
    try{
      const raw=typeof input==='string'?input:input?.url;
      if(!raw)return false;
      const url=new URL(raw,location.origin);
      return url.origin===location.origin&&url.pathname==='/api/ap/documents'&&url.searchParams.get('type')==='Bill';
    }catch{return false;}
  }

  // Enrich the Bills list response before app.js renders the ERP grid. This makes
  // PO Number and PO Match Status available to the native grid even on the very
  // first visit, including deployments/browser sessions that still have the older
  // Bills route implementation in memory.
  const underlyingFetch=window.fetch.bind(window);
  window.fetch=async(input,options={})=>{
    const response=await underlyingFetch(input,options);
    if(!response.ok||!isBillsListRequest(input,options))return response;
    try{
      const rows=await response.clone().json();
      if(!Array.isArray(rows))return response;
      const headers=new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      headers.set('content-type','application/json; charset=utf-8');
      return new Response(JSON.stringify(rows.map(enrichBill)),{status:response.status,statusText:response.statusText,headers});
    }catch{return response;}
  };

  const currentUser=()=>localStorage.getItem('erpUserId')||localStorage.getItem('userId')||'local';
  const settingsKey=user=>`${SETTINGS_PREFIX}${user}]`;

  function ensureSettingsKey(key){
    let changed=false;
    try{
      let settings=JSON.parse(localStorage.getItem(key)||'null');
      if(!settings||typeof settings!=='object'){
        settings={visibleColumns:[...DEFAULT_COLUMNS],columnOrder:[...DEFAULT_COLUMNS],columnWidths:{},filters:{},sorting:null,pinnedColumns:[],savedViews:[]};
        changed=true;
      }else{
        if(!Array.isArray(settings.visibleColumns)){
          settings.visibleColumns=[...DEFAULT_COLUMNS];
          changed=true;
        }else{
          REQUIRED_COLUMNS.forEach(column=>{if(!settings.visibleColumns.includes(column)){settings.visibleColumns.push(column);changed=true;}});
        }
        if(!Array.isArray(settings.columnOrder)){
          settings.columnOrder=[...DEFAULT_COLUMNS];
          changed=true;
        }else{
          REQUIRED_COLUMNS.forEach(column=>{if(!settings.columnOrder.includes(column)){settings.columnOrder.push(column);changed=true;}});
        }
      }
      if(changed)localStorage.setItem(key,JSON.stringify(settings));
    }catch(error){
      console.warn('Unable to prepare AP Bills grid PO columns',error);
    }
    return changed;
  }

  function migrateAllKnownSettings(){
    let changed=false;
    const keys=[];
    for(let index=0;index<localStorage.length;index++){
      const key=localStorage.key(index);
      if(key?.startsWith(SETTINGS_PREFIX))keys.push(key);
    }
    keys.forEach(key=>{changed=ensureSettingsKey(key)||changed;});
    changed=ensureSettingsKey(settingsKey(currentUser()))||changed;
    return changed;
  }

  // Run synchronously. This classic script is intentionally loaded after the
  // app.js module tag, so it executes before the deferred module and prepares the
  // saved grid layout before the first Bills and Adjustments render.
  migrateAllKnownSettings();

  let rerenderQueued=false,lastUser=currentUser();
  function readGridMeta(){
    const meta=document.getElementById('apBillGrid_meta');
    if(!meta)return null;
    try{return JSON.parse(meta.textContent||'{}');}catch{return null;}
  }

  function repairBillsGrid(){
    const user=currentUser();
    if(user!==lastUser){lastUser=user;ensureSettingsKey(settingsKey(user));}
    if(location.pathname!==BILLS_PATH)return;
    const changed=migrateAllKnownSettings();
    const meta=readGridMeta();
    const table=document.getElementById('apBillGrid');
    if(!meta||!table)return;
    const allColumns=(meta.allColumns||[]).map(column=>column.key);
    const nativeReady=REQUIRED_COLUMNS.every(column=>allColumns.includes(column));
    const missingDom=REQUIRED_COLUMNS.some(column=>!table.querySelector(`th[data-k='${column}']`));
    if(!nativeReady||(!changed&&!missingDom)||rerenderQueued)return;
    rerenderQueued=true;
    setTimeout(()=>{
      try{
        if(location.pathname===BILLS_PATH&&REQUIRED_COLUMNS.some(column=>!document.querySelector(`#apBillGrid th[data-k='${column}']`))){
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      }finally{
        setTimeout(()=>{rerenderQueued=false;},150);
      }
    },0);
  }

  function keepFilterPopupInViewport(){
    if(location.pathname!==BILLS_PATH)return;
    const pop=document.getElementById('apBillGrid_filterPop');
    if(!pop||pop.classList.contains('hidden'))return;
    const margin=12,rect=pop.getBoundingClientRect();
    let left=Number.parseFloat(pop.style.left)||rect.left;
    let top=Number.parseFloat(pop.style.top)||rect.top;
    if(rect.right>window.innerWidth-margin)left=Math.max(margin,window.innerWidth-rect.width-margin);
    if(rect.left<margin)left=margin;
    if(rect.bottom>window.innerHeight-margin)top=Math.max(margin,window.innerHeight-rect.height-margin);
    if(rect.top<margin)top=margin;
    pop.style.left=`${left}px`;
    pop.style.top=`${top}px`;
  }

  function scheduleFilterClamp(){requestAnimationFrame(()=>requestAnimationFrame(keepFilterPopupInViewport));}

  document.addEventListener('click',event=>{
    if(event.target?.closest?.("a[href='/ap/bills']")){
      migrateAllKnownSettings();
      setTimeout(repairBillsGrid,0);
    }
    if(event.target?.closest?.("#apBillGrid .grid-filter-btn"))scheduleFilterClamp();
  },true);

  window.addEventListener('resize',keepFilterPopupInViewport);
  window.addEventListener('popstate',()=>setTimeout(repairBillsGrid,0));
  new MutationObserver(()=>{
    queueMicrotask(()=>{
      repairBillsGrid();
      keepFilterPopupInViewport();
    });
  }).observe(document.body,{childList:true,subtree:true});

  const userWatch=setInterval(()=>{
    const user=currentUser();
    if(user!==lastUser){lastUser=user;ensureSettingsKey(settingsKey(user));repairBillsGrid();}
    if(document.readyState==='complete'&&Date.now()-(window.__apBillsPoStatusStartedAt||0)>10000)clearInterval(userWatch);
  },250);
  window.__apBillsPoStatusStartedAt=Date.now();
  setTimeout(repairBillsGrid,0);
})();
