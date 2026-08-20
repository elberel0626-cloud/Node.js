(()=>{
  const BILLS_PATH='/ap/bills';
  const SETTINGS_VERSION='apBillGridPoColumnsV3';
  const REQUIRED_COLUMNS=['poNumbers','poMatchStatus'];

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

  const currentUser=()=>localStorage.getItem('erpUserId')||localStorage.getItem('userId')||'local';
  const fallbackSettingsKey=()=>`erpGridSettings[AP][apBillGrid][${currentUser()}]`;
  const versionKey=()=>`${SETTINGS_VERSION}:${currentUser()}`;
  let rerenderQueued=false;

  function readGridMeta(){
    const meta=document.getElementById('apBillGrid_meta');
    if(!meta)return null;
    try{return JSON.parse(meta.textContent||'{}');}catch{return null;}
  }

  function migrateGridSettings(){
    if(location.pathname!==BILLS_PATH)return false;
    const meta=readGridMeta(),key=meta?.storageKey||fallbackSettingsKey(),marker=versionKey();
    let changed=false;
    try{
      const settings=JSON.parse(localStorage.getItem(key)||'null');
      if(settings&&typeof settings==='object'){
        if(Array.isArray(settings.visibleColumns)){
          REQUIRED_COLUMNS.forEach(column=>{if(!settings.visibleColumns.includes(column)){settings.visibleColumns.push(column);changed=true;}});
        }
        if(Array.isArray(settings.columnOrder)){
          REQUIRED_COLUMNS.forEach(column=>{if(!settings.columnOrder.includes(column)){settings.columnOrder.push(column);changed=true;}});
        }
        if(changed)localStorage.setItem(key,JSON.stringify(settings));
      }
      localStorage.setItem(marker,'1');
    }catch(error){
      console.warn('Unable to migrate AP Bills grid PO columns',error);
    }
    return changed;
  }

  function ensureNativeColumnsVisible(){
    if(location.pathname!==BILLS_PATH)return;
    const meta=readGridMeta();
    if(!meta)return;
    const allColumns=(meta.allColumns||[]).map(column=>column.key);
    if(!REQUIRED_COLUMNS.every(column=>allColumns.includes(column)))return;
    const changed=migrateGridSettings();
    const table=document.getElementById('apBillGrid');
    const missingDom=REQUIRED_COLUMNS.some(column=>!table?.querySelector(`th[data-k='${column}']`));
    if(!(changed||missingDom)||rerenderQueued)return;
    rerenderQueued=true;
    setTimeout(()=>{
      try{
        if(location.pathname===BILLS_PATH&&REQUIRED_COLUMNS.some(column=>!document.querySelector(`#apBillGrid th[data-k='${column}']`))){
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      }finally{
        setTimeout(()=>{rerenderQueued=false;},100);
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

  function scheduleFilterClamp(){
    requestAnimationFrame(()=>requestAnimationFrame(keepFilterPopupInViewport));
  }

  document.addEventListener('click',event=>{
    if(event.target?.closest?.("a[href='/ap/bills']"))setTimeout(ensureNativeColumnsVisible,0);
    if(event.target?.closest?.("#apBillGrid .grid-filter-btn"))scheduleFilterClamp();
  },true);

  window.addEventListener('resize',keepFilterPopupInViewport);
  window.addEventListener('popstate',()=>setTimeout(ensureNativeColumnsVisible,0));
  new MutationObserver(()=>{
    if(location.pathname!==BILLS_PATH)return;
    queueMicrotask(()=>{
      ensureNativeColumnsVisible();
      keepFilterPopupInViewport();
    });
  }).observe(document.body,{childList:true,subtree:true});

  setTimeout(ensureNativeColumnsVisible,0);
})();
