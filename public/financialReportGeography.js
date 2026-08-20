(()=>{
  const isProfitLoss=()=>location.pathname==='/finance/reports/profit-loss';
  const style=document.createElement('style');
  style.dataset.financialReportGeography='1';
  style.textContent=`
    .financial-statement .statement-subgroup th{
      padding-left:24px!important;
      font-weight:600!important;
      font-size:12px!important;
      opacity:.82;
      border-top:1px solid rgba(0,0,0,.06);
    }
    .financial-statement .statement-subgroup + .statement-account td:first-child{
      padding-left:34px!important;
    }
  `;
  document.head.appendChild(style);

  let appliedKey='',running=false;
  const reportQuery=()=>{
    const params=new URLSearchParams(location.search),now=new Date().toISOString().slice(0,7),from=params.get('fromPeriod')||`${now.slice(0,4)}-01`,to=params.get('toPeriod')||now,asOf=params.get('asOf')||to,includeZero=params.get('includeZero')==='true',view=params.get('view')||'total';
    return new URLSearchParams({fromPeriod:from,toPeriod:to,asOf,includeZero,view});
  };

  async function enhance(){
    if(running||!isProfitLoss())return;
    const table=document.querySelector('.financial-statement table');
    if(!table)return;
    const key=`${location.pathname}${location.search}|${table.querySelectorAll('.statement-account').length}`;
    if(key===appliedKey&&table.querySelector('.statement-subgroup'))return;
    running=true;
    try{
      const response=await fetch(`/api/finance/reports/profit-loss?${reportQuery()}`,{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)return;
      const report=await response.json(),subgroupByCode=new Map(),subgroupTotals=new Map();
      (report.rows||[]).forEach(row=>subgroupByCode.set(String(row.accountCode||''),String(row.subgroup||'')));
      (report.sections||[]).forEach(section=>(section.groups||[]).forEach(group=>(group.subgroups||[]).forEach(subgroup=>subgroupTotals.set(`${group.name}|${subgroup.name}`,subgroup.total))));
      table.querySelectorAll('.statement-subgroup').forEach(row=>row.remove());
      const columnCount=table.querySelectorAll('thead th').length||2;
      table.querySelectorAll('tbody').forEach(body=>{
        let groupName='',lastSubgroup='';
        [...body.querySelectorAll('tr')].forEach(row=>{
          if(row.classList.contains('statement-group')){groupName=String(row.querySelector('th')?.textContent||'').trim();lastSubgroup='';return;}
          if(!row.classList.contains('statement-account'))return;
          const text=String(row.querySelector('td:first-child a')?.textContent||'').trim(),code=text.split('—')[0].trim(),subgroup=subgroupByCode.get(code)||'';
          if(!subgroup||subgroup===lastSubgroup)return;
          const heading=document.createElement('tr');heading.className='statement-subgroup';
          const cell=document.createElement('th');cell.colSpan=columnCount;cell.textContent=subgroup;
          const total=subgroupTotals.get(`${groupName}|${subgroup}`);if(Number.isFinite(Number(total)))cell.title=`${subgroup} total: ${Number(total).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
          heading.appendChild(cell);row.before(heading);lastSubgroup=subgroup;
        });
      });
      appliedKey=key;
    }catch{}finally{running=false;}
  }

  new MutationObserver(()=>queueMicrotask(enhance)).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('popstate',()=>setTimeout(()=>{appliedKey='';enhance();},0));
  setInterval(enhance,500);
  enhance();
})();
