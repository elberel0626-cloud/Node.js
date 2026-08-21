(()=>{
  const KEY='arInvoiceBalanceFixV1';
  if(window[KEY])return;
  window[KEY]=true;

  const TYPES=new Set(['Invoice','Credit Memo','Debit Memo']);
  const POSTED_STATUSES=new Set(['Open','Closed','Voided']);
  let timer=null;

  const headerInput=(labelText)=>{
    const grid=document.querySelector('#invoiceMemoForm .erp-header-grid');
    if(!grid)return null;
    const label=[...grid.querySelectorAll(':scope > label')].find(item=>{
      const first=item.childNodes[0];
      return String(first?.textContent||'').trim()===labelText;
    });
    return label?.querySelector('input')||null;
  };

  async function syncPostedDocumentAmounts(){
    if(!location.pathname.startsWith('/ar/doc/'))return;
    const form=document.getElementById('invoiceMemoForm');
    const type=document.getElementById('dtype')?.value||'';
    if(!form||!TYPES.has(type))return;

    const id=decodeURIComponent(location.pathname.split('/').pop()||'');
    if(!id||id==='<NEW>')return;
    const routeAtStart=location.pathname;

    try{
      const response=await fetch(`/api/ar/documents/${encodeURIComponent(id)}`,{credentials:'same-origin'});
      if(!response.ok)return;
      const doc=await response.json();
      if(location.pathname!==routeAtStart||!TYPES.has(doc.type)||!POSTED_STATUSES.has(doc.status))return;

      const amountInput=headerInput('Amount');
      const balanceInput=headerInput('Balance');
      if(amountInput)amountInput.value=Number(doc.amount??doc.grandTotal??0).toFixed(2);
      if(balanceInput)balanceInput.value=Number(doc.balance??doc.amount??doc.grandTotal??0).toFixed(2);
    }catch(error){
      console.warn('Unable to synchronize AR document amount and balance.',error);
    }
  }

  function queueSync(){
    clearTimeout(timer);
    timer=setTimeout(syncPostedDocumentAmounts,60);
  }

  function boot(){
    const view=document.getElementById('view');
    if(view)new MutationObserver(queueSync).observe(view,{childList:true,subtree:true});
    window.addEventListener('popstate',queueSync);
    queueSync();
  }

  if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
