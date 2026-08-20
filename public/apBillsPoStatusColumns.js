(()=>{
  const isBillsList=()=>location.pathname==='/ap/bills';
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

  function readRows(){
    try{return JSON.parse(document.getElementById('apBillGrid_meta')?.textContent||'{}').rows||[];}catch{return[];}
  }

  function header(label,key,extraClass){
    const th=document.createElement('th');
    th.className=`grid-sort ap-po-list-column ${extraClass||''}`.trim();
    th.dataset.k=key;
    th.innerHTML=`<div class='th-wrap'><span>${esc(label)}</span></div>`;
    return th;
  }

  function enhance(){
    if(!isBillsList())return;
    const table=document.getElementById('apBillGrid');
    if(!table)return;
    const rows=readRows(),head=table.rows[0];
    if(!head)return;
    if(!head.querySelector("th[data-k='poNumbers']"))head.appendChild(header('PO Number','poNumbers',''));
    if(!head.querySelector("th[data-k='poMatchStatus']"))head.appendChild(header('PO Match Status','poMatchStatus','ap-po-match-column'));

    [...table.querySelectorAll('tr[data-row]')].forEach(tr=>{
      const doc=rows[Number(tr.dataset.row)]||{};
      const pos=poNumbers(doc),status=matchStatus(doc);
      let poCell=tr.querySelector("td[data-k='poNumbers']");
      if(!poCell){poCell=document.createElement('td');poCell.dataset.k='poNumbers';poCell.className='ap-po-list-cell';tr.appendChild(poCell);}
      poCell.innerHTML=pos.length?pos.map(po=>`<a class='link' href='/purchase-orders/orders/${encodeURIComponent(po)}'>${esc(po)}</a>`).join(''):'—';
      let statusCell=tr.querySelector("td[data-k='poMatchStatus']");
      if(!statusCell){statusCell=document.createElement('td');statusCell.dataset.k='poMatchStatus';statusCell.className='ap-po-match-cell';tr.appendChild(statusCell);}
      statusCell.innerHTML=`<span class='ap-list-match-pill ${statusClass(status)}'>${esc(status)}</span>`;
      statusCell.title=doc?.threeWayMatch?.postable===false?'Posting is blocked by the PO matching control.':doc?.threeWayMatch?.postable===true?'PO matching control is satisfied.':'';
    });
  }

  let timer=null;
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(enhance,30);};
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('popstate',schedule);
  document.addEventListener('click',event=>{if(event.target?.closest?.("a[href='/ap/bills'],.grid-reset[data-grid='apBillGrid'],.grid-view-select[data-grid='apBillGrid']"))setTimeout(schedule,50);},true);
  schedule();
})();
