(()=>{
  const BILLS_PATH='/ap/bills';
  const SETTINGS_VERSION='apBillGridPoColumnsV2';

  const style=document.createElement('style');
  style.dataset.apBillsPoGrid='1';
  style.textContent=`
    #apBillGrid th[data-k='poNumbers']{min-width:150px}
    #apBillGrid th[data-k='poMatchStatus']{min-width:230px}
    #apBillGrid td[data-k='poNumbers']{white-space:normal;min-width:150px}
    #apBillGrid td[data-k='poNumbers'] a{display:inline-block;margin-right:8px}
    #apBillGrid td[data-k='poMatchStatus']{white-space:normal;min-width:230px}
    .ap-list-match-pill{display:inline-block;border:1px solid currentColor;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:700;line-height:1.5}
    .ap-list-match-good{color:#18794e}.ap-list-match-warn{color:#9a6700}.ap-list-match-bad{color:#b42318}.ap-list-match-neutral{color:inherit}
  `;
  document.head.appendChild(style);

  const currentUser=()=>localStorage.getItem('erpUserId')||localStorage.getItem('userId')||'local';
  const settingsKey=()=>`erpGridSettings[AP][apBillGrid][${currentUser()}]`;
  const versionKey=()=>`${SETTINGS_VERSION}:${currentUser()}`;

  function migrateGridSettings(){
    const key=settingsKey(),marker=versionKey();
    if(localStorage.getItem(marker)==='1')return;
    try{
      const settings=JSON.parse(localStorage.getItem(key)||'null');
      if(settings&&typeof settings==='object'){
        const required=['poNumbers','poMatchStatus'];
        if(Array.isArray(settings.visibleColumns)){
          required.forEach(column=>{if(!settings.visibleColumns.includes(column))settings.visibleColumns.push(column);});
        }
        if(Array.isArray(settings.columnOrder)){
          required.forEach(column=>{if(!settings.columnOrder.includes(column))settings.columnOrder.push(column);});
        }
        localStorage.setItem(key,JSON.stringify(settings));
      }
      localStorage.setItem(marker,'1');
    }catch(error){
      console.warn('Unable to migrate AP Bills grid PO columns',error);
    }
  }

  migrateGridSettings();

  document.addEventListener('click',event=>{
    if(event.target?.closest?.("a[href='/ap/bills']"))migrateGridSettings();
  },true);

  window.addEventListener('popstate',()=>{
    if(location.pathname===BILLS_PATH)migrateGridSettings();
  });
})();
