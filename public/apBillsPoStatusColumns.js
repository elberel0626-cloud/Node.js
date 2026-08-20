(()=>{
  const BILLS_PATH='/ap/bills';
  const isBillsList=()=>location.pathname===BILLS_PATH;
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const unique=values=>[...new Set((values||[]).map(value=>String(value||'').trim()).filter(Boolean))];
  const poNumbers=doc=>unique((doc?.lines||[]).map(line=>line.poNumber||line.sourcePoId||line.poId).concat(doc?.matchedPoNumber||doc?.poNumber||[]));
  const matchStatus=doc=>{
    const pos=poNumbers(doc);
    if(!pos.length)return'Non-PO';
    const match=doc?.threeWayMatch||{};
    const status=String(match.status||doc?.matchStatus||doc?.threeWayMatchStatus||(doc?.threeWayMatched?'Matched - Ready to Post':'Not Matched')).trim();
    if(!status||status==='Not Applicable')return'Not Matched';
    return status;
  };
  const statusClass=status=>{
    const value=String(status||'');
    if(/^(Posted|Matched - Ready to Post|Approved Match Exception - Ready to Post)$/i.test(value))return'ap-list-match-good';
    if(/Waiting for Receipt|Partially Received|Pending/i.test(value))return'ap-list-match-warn';
    if(/Exception|Variance|Not Matched|Blocked|Vendor Credit/i.test(value))return'ap-list-match-bad';
    return'ap-list-match-neutral';
  };

  const style=document.createElement('style');
  style.textContent=`
    #apBillGrid th.ap-po-list-column{min-width:150px}
    #apBillGrid th.ap-po-match-column{min-width:230px}
    #apBillGrid td.ap-po-list-cell{white-space:normal;min-width:150px}
    #apBillGrid td.ap-po-list-cell a{display:inline-block;margin-right:8px}
    #apBillGrid td.ap-po-match-cell{white-space:normal;min-width:230px}
    .ap-list-match-pill{display:inline-block;border:1px solid currentColor;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:700;line-height:1.5}
    .ap-list-match-good{color:#18794e}.ap-list-match-warn{color:#9a6700}.ap-list-match-bad{color:#b42318}.ap-list-match-neutral{color:inherit}
  `;
  document.head.appendChild(style);

  let latestDocs=[],loadSequence=0,renderTimer=null,lastPath=location.pathname;

  async function fetchBills(){
    const sequence=++loadSequence;
    try{
      const response=await fetch('/api/ap/documents?type=Bill',{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw new Error(`Bills request failed (${response.status})`);
      const rows=await response.json();
      if(sequence!==loadSequence||!isBillsList())return;
      latestDocs=Array.isArray(rows)?rows:[];
      enhance();
    }catch(error){
      console.error('Unable to refresh AP Bills PO status columns',error);
    }
  }

  function setActiveNavigation(){
    if(!isBillsList())return;
    const nav=document.getElementById('ar-nav');
    if(!nav)return;
    nav.querySelectorAll('a.active').forEach(link=>link.classList.remove('active'));
    nav.querySelector("a[href='/ap/bills']")?.classList.add('active');
  }

  function billIdForRow(tr){
    const href=tr.querySelector("a[href^='/ap/bills/']")?.getAttribute('href')||'';
    return href.startsWith('/ap/bills/')?decodeURIComponent(href.slice('/ap/bills/'.length)):'';
  }

  function header(label,key,extraClass=''){
    const th=document.createElement('th');
    th.className=`ap-po-list-column ${extraClass}`.trim();
    th.dataset.k=key;
    th.innerHTML=`<div class='th-wrap'><span>${esc(label)}</span></div>`;
    return th;
  }

  function enhance(){
    if(!isBillsList())return false;
    setActiveNavigation();
    const table=document.getElementById('apBillGrid'),head=table?.rows?.[0];
    if(!table||!head)return false;
    if(!head.querySelector("th[data-k='poNumbers']"))head.appendChild(header('PO Number','poNumbers'));
    if(!head.querySelector("th[data-k='poMatchStatus']"))head.appendChild(header('PO Match Status','poMatchStatus','ap-po-match-column'));

    const byId=new Map(latestDocs.map(doc=>[String(doc.id),doc]));
    [...table.querySelectorAll('tr[data-row]')].forEach(tr=>{
      const doc=byId.get(billIdForRow(tr));
      if(!doc)return;
      const pos=poNumbers(doc),status=matchStatus(doc),poSignature=pos.join('|')||'—',statusSignature=`${status}|${doc?.threeWayMatch?.postable}`;
      let poCell=tr.querySelector("td[data-k='poNumbers']");
      if(!poCell){poCell=document.createElement('td');poCell.dataset.k='poNumbers';poCell.className='ap-po-list-cell';tr.appendChild(poCell);}
      if(poCell.dataset.value!==poSignature){
        poCell.dataset.value=poSignature;
        poCell.innerHTML=pos.length?pos.map(po=>`<a class='link' href='/purchase-orders/orders/${encodeURIComponent(po)}'>${esc(po)}</a>`).join(' '):'—';
      }
      let statusCell=tr.querySelector("td[data-k='poMatchStatus']");
      if(!statusCell){statusCell=document.createElement('td');statusCell.dataset.k='poMatchStatus';statusCell.className='ap-po-match-cell';tr.appendChild(statusCell);}
      if(statusCell.dataset.value!==statusSignature){
        statusCell.dataset.value=statusSignature;
        statusCell.innerHTML=`<span class='ap-list-match-pill ${statusClass(status)}'>${esc(status)}</span>`;
        statusCell.title=doc?.threeWayMatch?.postable===false?'Posting is blocked by the PO matching control.':doc?.threeWayMatch?.postable===true?'PO matching control is satisfied.':'';
      }
    });
    return true;
  }

  function scheduleRender(delay=30){clearTimeout(renderTimer);renderTimer=setTimeout(()=>{if(!enhance()&&isBillsList())scheduleRender(80);},delay);}

  function enterBillsRoute(){
    if(!isBillsList())return;
    setActiveNavigation();
    scheduleRender(20);
    fetchBills();
  }

  function observeRoute(){
    const path=location.pathname;
    if(path!==lastPath){lastPath=path;if(isBillsList())enterBillsRoute();}
    else if(isBillsList())scheduleRender(20);
  }

  new MutationObserver(observeRoute).observe(document.getElementById('app')||document.body,{childList:true,subtree:true});
  window.addEventListener('popstate',()=>setTimeout(enterBillsRoute,0));
  document.addEventListener('click',event=>{
    const billsLink=event.target?.closest?.("#ar-nav a[href='/ap/bills']");
    if(billsLink&&!isBillsList()&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(BILLS_PATH);
      return;
    }
    if(event.target?.closest?.(".grid-reset[data-grid='apBillGrid'],.grid-view-select[data-grid='apBillGrid']"))setTimeout(()=>{scheduleRender(30);fetchBills();},80);
  },true);
  enterBillsRoute();
})();
