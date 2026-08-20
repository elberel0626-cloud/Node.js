(() => {
  const money=value=>Number(value||0).toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const join=value=>Array.isArray(value)?value.join(', '):String(value||'');
  const reportPaths=new Set([
    '/purchase-orders/reports/received-not-vouched',
    '/purchase-orders/reports/receipts-not-billed',
    '/purchase-orders/reports/reconciliation',
    '/purchase-orders/reports/prepayment-exposure',
    '/purchase-orders/reports/exceptions'
  ]);
  const styles=document.createElement('style');
  styles.textContent=`
    .po-report-toolbar{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:0 0 12px}
    .po-report-toolbar .po-report-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .po-report-toolbar input{min-width:280px}
    .po-report-note{margin:0 0 14px;padding:10px 12px;border:1px solid var(--border,#d0d5dd);border-radius:8px;background:var(--panel,#fff);font-size:13px;line-height:1.45}
    .po-report-table-wrap{overflow:auto;border:1px solid var(--border,#d0d5dd);border-radius:8px;background:var(--panel,#fff)}
    .po-report-table{width:100%;border-collapse:collapse;min-width:1120px;font-size:13px}
    .po-report-table th,.po-report-table td{padding:8px 10px;border-bottom:1px solid var(--border,#e4e7ec);text-align:left;white-space:nowrap;vertical-align:top}
    .po-report-table th{position:sticky;top:0;background:var(--panel,#fff);z-index:1;font-weight:700}
    .po-report-table td.wrap{white-space:normal;min-width:260px}
    .po-report-table tr:last-child td{border-bottom:0}
    .po-report-status{display:inline-block;padding:2px 7px;border:1px solid currentColor;border-radius:999px;font-size:12px;white-space:nowrap}
    .po-report-empty{padding:24px;text-align:center;color:#667085}
  `;
  document.head.appendChild(styles);

  async function getReport(){
    const response=await fetch('/api/purchase-orders/reports/operational',{credentials:'same-origin'});
    if(!response.ok){let message=`Request failed (${response.status})`;try{const body=await response.json();message=body.error||body.message||message;}catch{}throw new Error(message);}
    return response.json();
  }
  const poLink=row=>row.poNumber?`<a class='link' href='/purchase-orders/orders/${encodeURIComponent(row.poNumber)}'>${esc(row.poNumber)}</a>`:'';
  const status=value=>`<span class='po-report-status'>${esc(value||'')}</span>`;
  const fmt=(value,type,row)=>{
    if(type==='money')return money(value);
    if(type==='list')return esc(join(value));
    if(type==='po')return poLink(row);
    if(type==='status')return status(value);
    return esc(value??'');
  };
  const definitions={
    '/purchase-orders/reports/received-not-vouched':{
      title:'Goods Received Not Vouched (GRNI)',dataset:'receivedNotVouched',note:'Shows received value that has not yet been cleared by a posted AP voucher. Vendor prepayments are shown for completeness but do not reduce GRNI until a vendor bill/voucher is posted, because the prepayment remains a vendor deposit asset.',
      kpis:data=>[['GRNI / RNV',money(data.totals.receivedNotVouchedAmount)],['POs with RNV',data.totals.poCountWithRnv],['Available Prepayments',money(data.totals.prepaymentAvailable)],['Exceptions',data.totals.exceptionCount]],
      columns:[['poNumber','PO Number','po'],['vendorName','Vendor'],['poStatus','PO Status','status'],['receiptNumbers','Receipt(s)','list'],['firstReceiptDate','First Receipt'],['lastReceiptDate','Last Receipt'],['receivedAmount','Received Amount','money'],['vouchedAtReceiptCost','Vouched at Receipt Cost','money'],['receivedNotVouchedAmount','Received Not Vouched','money'],['prepaymentTotal','Prepayment Total','money'],['prepaymentApplied','Prepayment Applied','money'],['prepaymentAvailable','Prepayment Available','money'],['invoiceNumbers','Voucher / Invoice(s)','list'],['oldestRnvAgeDays','Oldest RNV Age (Days)'],['rnvStatus','RNV Status','status']]
    },
    '/purchase-orders/reports/receipts-not-billed':null,
    '/purchase-orders/reports/reconciliation':{
      title:'PO Receipt / Voucher Reconciliation',dataset:'reconciliation',note:'Reconciles purchase order commitment, receipts, posted vouchers and vendor deposits in one view. Vouched at receipt cost is the GRNI-clearing basis; invoice amount is shown separately so purchase-price variance is visible instead of distorting GRNI.',
      kpis:data=>[['Total Received',money(data.totals.receivedAmount)],['Vouched at Receipt Cost',money(data.totals.vouchedAtReceiptCost)],['GRNI / RNV',money(data.totals.receivedNotVouchedAmount)],['Available Prepayments',money(data.totals.prepaymentAvailable)]],
      columns:[['poNumber','PO Number','po'],['vendorName','Vendor'],['poStatus','Status','status'],['poTotal','PO Total','money'],['receivedAmount','Received','money'],['invoiceAmount','Voucher Amount','money'],['vouchedAtReceiptCost','Vouched at Receipt Cost','money'],['receivedNotVouchedAmount','RNV','money'],['unreceivedCommitment','Unreceived Commitment','money'],['prepaymentTotal','Prepayment Total','money'],['prepaymentApplied','Prepayment Applied','money'],['prepaymentAvailable','Prepayment Available','money'],['receiptNumbers','Receipt(s)','list'],['invoiceNumbers','Voucher / Invoice(s)','list'],['rnvStatus','RNV Status','status']]
    },
    '/purchase-orders/reports/prepayment-exposure':{
      title:'PO Prepayment Exposure',dataset:'prepaymentExposure',note:'Tracks vendor deposits by PO and shows whether the related goods have been received and vouched. This highlights deposits still outstanding, including prepaid POs that are waiting for receipt or have received-not-vouched balances.',
      kpis:data=>[['Prepayment Total',money(data.totals.prepaymentTotal)],['Available Prepayments',money(data.totals.prepaymentAvailable)],['GRNI / RNV',money(data.totals.receivedNotVouchedAmount)],['POs with Prepayments',data.prepaymentExposure.length]],
      columns:[['poNumber','PO Number','po'],['vendorName','Vendor'],['poStatus','PO Status','status'],['prepaymentNumbers','Prepayment(s)','list'],['prepaymentTotal','Prepayment Total','money'],['prepaymentApplied','Applied','money'],['prepaymentAvailable','Available','money'],['receivedAmount','Received','money'],['invoiceAmount','Voucher Amount','money'],['receivedNotVouchedAmount','RNV','money'],['receiptNumbers','Receipt(s)','list'],['invoiceNumbers','Voucher / Invoice(s)','list'],['exposureStatus','Exposure Status','status']]
    },
    '/purchase-orders/reports/exceptions':{
      title:'PO Exceptions',dataset:'exceptions',note:'Action list for purchasing and accounting: received-not-vouched balances, partial receipts, over-receipts, unused prepayments on closed POs, and posted voucher values that exceed receipts beyond tolerance.',
      kpis:data=>[['Exceptions',data.totals.exceptionCount],['GRNI / RNV',money(data.totals.receivedNotVouchedAmount)],['Available Prepayments',money(data.totals.prepaymentAvailable)],['POs',data.totals.poCount]],
      columns:[['severity','Severity','status'],['exceptionType','Exception'],['poNumber','PO Number','po'],['vendorName','Vendor'],['poStatus','PO Status','status'],['receiptReferences','Receipt(s)'],['invoiceReferences','Voucher / Invoice(s)'],['amount','Amount','money'],['details','Details']]
    }
  };
  definitions['/purchase-orders/reports/receipts-not-billed']=definitions['/purchase-orders/reports/received-not-vouched'];

  function csvValue(value){const text=Array.isArray(value)?value.join(', '):String(value??'');return `"${text.replaceAll('"','""')}"`;}
  function downloadCsv(title,columns,rows){
    const csv=[columns.map(column=>csvValue(column[1])).join(','),...rows.map(row=>columns.map(column=>csvValue(row[column[0]])).join(','))].join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'.csv';document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);
  }
  function tableHtml(columns,rows){
    if(!rows.length)return `<div class='po-report-empty'>No records meet the report criteria.</div>`;
    return `<table class='po-report-table'><thead><tr>${columns.map(column=>`<th>${esc(column[1])}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(column=>`<td class='${column[0]==='details'?'wrap':''}'>${fmt(row[column[0]],column[2],row)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  let requestSequence=0;
  async function renderOperationalReport(){
    const path=location.pathname;if(!reportPaths.has(path))return;
    const view=document.getElementById('view'),title=document.getElementById('title');if(!view||!title)return;
    const definition=definitions[path];if(!definition)return;
    if(view.dataset.poOperationalRoute===path)return;
    const seq=++requestSequence;view.dataset.poOperationalRoute=path;title.textContent=definition.title;view.innerHTML=`<div class='panel'>Loading ${esc(definition.title)}…</div>`;
    try{
      const data=await getReport();if(seq!==requestSequence||location.pathname!==path)return;
      const allRows=Array.isArray(data[definition.dataset])?data[definition.dataset]:[],kpis=definition.kpis(data);
      title.textContent=definition.title;
      view.innerHTML=`<div class='kpi-row'>${kpis.map(([label,value])=>`<div class='kpi'><b>${esc(value)}</b><span>${esc(label)}</span></div>`).join('')}</div><p class='po-report-note'>${esc(definition.note)}</p><div class='po-report-toolbar'><div class='po-report-actions'><input id='poReportSearch' type='search' placeholder='Filter this report…'><span id='poReportCount'></span></div><button type='button' id='poReportCsv'>Export CSV</button></div><div class='po-report-table-wrap' id='poReportTable'></div>`;
      const search=view.querySelector('#poReportSearch'),count=view.querySelector('#poReportCount'),table=view.querySelector('#poReportTable'),exportButton=view.querySelector('#poReportCsv');
      let filtered=allRows;
      const draw=()=>{const q=String(search.value||'').trim().toLowerCase();filtered=q?allRows.filter(row=>definition.columns.some(column=>join(row[column[0]]).toLowerCase().includes(q))):allRows;count.textContent=`${filtered.length} record${filtered.length===1?'':'s'}`;table.innerHTML=tableHtml(definition.columns,filtered);};
      search.addEventListener('input',draw);exportButton.addEventListener('click',()=>downloadCsv(definition.title,definition.columns,filtered));draw();
    }catch(error){if(seq!==requestSequence)return;view.innerHTML=`<div class='panel'><strong>Unable to load report.</strong><p>${esc(error.message)}</p></div>`;}
  }
  function ensureNavLinks(){
    if(!(location.pathname.startsWith('/purchase-orders')||location.pathname.startsWith('/purchasing')))return;
    const nav=document.getElementById('ar-nav');if(!nav)return;
    const reportGroup=[...nav.querySelectorAll('.nav-group')].find(group=>group.querySelector('.nav-group-title')?.textContent.trim()==='Reports');if(!reportGroup)return;
    const old=reportGroup.querySelector("a[href='/purchase-orders/reports/receipts-not-billed']");if(old){old.textContent='Goods Received Not Vouched (GRNI)';old.setAttribute('href','/purchase-orders/reports/received-not-vouched');}
    const links=[['/purchase-orders/reports/received-not-vouched','Goods Received Not Vouched (GRNI)'],['/purchase-orders/reports/reconciliation','PO Receipt / Voucher Reconciliation'],['/purchase-orders/reports/prepayment-exposure','Prepayment Exposure'],['/purchase-orders/reports/exceptions','PO Exceptions']];
    for(const [href,label] of links){let anchor=reportGroup.querySelector(`a[href='${href}']`);if(!anchor){anchor=document.createElement('a');anchor.href=href;anchor.textContent=label;reportGroup.appendChild(anchor);}anchor.classList.toggle('active',location.pathname===href||(href==='/purchase-orders/reports/received-not-vouched'&&location.pathname==='/purchase-orders/reports/receipts-not-billed'));}
  }
  let queued=false;
  function scan(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;ensureNavLinks();renderOperationalReport();});}
  new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('popstate',scan);document.addEventListener('click',()=>setTimeout(scan,0),true);scan();
})();
