(() => {
  const money=value=>Number(value||0).toFixed(2);
  const appFetch=globalThis.fetch.bind(globalThis);
  let documentCacheKey='';
  let documentCache=null;
  let eligibilityKey='';
  let reconcileQueued=false;
  let reconciling=false;
  let activeForm=null;

  const paymentForm=()=>document.getElementById('paymentForm');
  const paymentStatus=()=>{
    const form=paymentForm();
    if(!form)return '';
    const label=[...form.querySelectorAll('label')].find(node=>node.textContent.trim().startsWith('Status'));
    return String(label?.querySelector('input')?.value||'').trim();
  };
  const customerId=()=>String(document.getElementById('paymentCustomerNumber')?.value||document.getElementById('customerLookupPay')?.value||'').trim().split(/\s+/)[0];
  const domArApplied=()=>[...document.querySelectorAll('#paymentForm .doc-amt,#paymentForm .so-amt')].reduce((sum,input)=>sum+Number(input.value||0),0);
  const domGlApplied=()=>[...document.querySelectorAll('#paymentGlApplicationsTbl .payment-gl-amount')].reduce((sum,input)=>sum+Number(input.value||0),0);
  const headerTotal=()=>Number(document.getElementById('paymentAmount')?.value||0)+Number(document.getElementById('financeChargeAmount')?.value||0)+Number(document.getElementById('writeOffAmount')?.value||0);

  async function readCurrentPayment(){
    const match=location.pathname.match(/^\/ar\/doc\/([^/]+)$/);
    if(!match||!paymentForm())return null;
    const key=decodeURIComponent(match[1]);
    if(documentCacheKey===key&&documentCache)return documentCache;
    try{
      const response=await appFetch(`/api/ar/documents/${encodeURIComponent(key)}`,{credentials:'same-origin'});
      if(!response.ok)return null;
      const row=await response.json();
      if(row.type!=='Payment')return null;
      documentCacheKey=key;
      documentCache=row;
      return row;
    }catch{return null;}
  }

  function hydrateSavedApplications(payment){
    const form=paymentForm();
    if(!form||form.dataset.paymentSavedApplicationsHydrated==='1'||!payment||payment.posted||paymentStatus()!=='Saved')return;
    form.dataset.paymentSavedApplicationsHydrated='1';
    for(const application of payment.applications||[]){
      const id=application.invoiceId||application.salesOrderId;
      if(!id)continue;
      const selector=application.salesOrderId?'#ordersApplyTbl tbody tr':'#docsApplyTbl tbody tr';
      const row=[...document.querySelectorAll(selector)].find(node=>node.dataset.id===String(id));
      if(!row)continue;
      const checkbox=row.querySelector(application.salesOrderId?'.so-pick':'.doc-pick');
      const amount=row.querySelector(application.salesOrderId?'.so-amt':'.doc-amt');
      if(checkbox)checkbox.checked=Number(application.amount||0)>0;
      if(amount)amount.value=money(application.amount||0);
      const remaining=row.querySelector(application.salesOrderId?'.so-rem':'.doc-rem');
      if(remaining)remaining.textContent=money(Math.max(0,Number(amount?.dataset.bal||0)-Number(application.amount||0)));
    }
  }

  async function pruneIneligibleInvoices(payment){
    const table=document.getElementById('docsApplyTbl');
    const cid=customerId();
    if(!table||!cid)return;
    const rowIds=[...table.querySelectorAll('tbody tr[data-id]')].map(row=>row.dataset.id).sort();
    const key=`${cid}|${rowIds.join(',')}`;
    if(key===eligibilityKey)return;
    eligibilityKey=key;
    try{
      const response=await appFetch(`/api/ar/open-invoices?customerId=${encodeURIComponent(cid)}`,{credentials:'same-origin'});
      if(!response.ok)return;
      const eligibleRows=await response.json();
      const eligible=new Set(eligibleRows.filter(row=>row.posted&&row.status==='Open'&&Number(row.balance||0)>0).map(row=>String(row.id)));
      let removedSavedApplication=false;
      table.querySelectorAll('tbody tr[data-id]').forEach(row=>{
        if(eligible.has(String(row.dataset.id)))return;
        if((payment?.applications||[]).some(application=>String(application.invoiceId||'')===String(row.dataset.id)&&Number(application.amount||0)>0))removedSavedApplication=true;
        row.remove();
      });
      const body=table.querySelector('tbody');
      if(body&&!body.querySelector('tr[data-id]'))body.innerHTML="<tr><td colspan='11'>No eligible posted open invoices.</td></tr>";
      let warning=document.getElementById('paymentApplicationEligibilityWarning');
      if(removedSavedApplication){
        if(!warning){warning=document.createElement('div');warning.id='paymentApplicationEligibilityWarning';warning.className='panel err';table.closest('.tab-pane')?.prepend(warning);}
        warning.textContent='A saved application is no longer eligible because the AR document is not posted and open. Remove or correct the application before posting.';
      }else warning?.remove();
    }catch{}
  }

  function syncHeaderTotals(payment){
    const applied=document.getElementById('appliedAmount');
    const available=document.getElementById('availableBal');
    if(!applied||!available)return;
    const status=paymentStatus();
    if(payment?.posted&&status==='Closed'){
      const total=Number(payment.amount||0)+Number(payment.financeChargeAmount||0)+Number(payment.writeOffAmount||0);
      const remaining=Math.max(0,Number(payment.unappliedBalance||0));
      applied.value=money(Math.max(0,total-remaining));
      available.value=money(remaining);
      return;
    }
    if(payment?.posted&&status==='Open'){
      const starting=Math.max(0,Number(payment.unappliedBalance||0));
      const newlyApplied=domArApplied();
      applied.value=money(newlyApplied);
      available.value=money(Math.max(0,starting-newlyApplied));
      return;
    }
    const total=headerTotal();
    const totalApplied=domArApplied()+domGlApplied();
    applied.value=money(totalApplied);
    available.value=money(Math.max(0,total-totalApplied));
  }

  async function reconcile(){
    const form=paymentForm();
    if(reconciling||!form)return;
    if(form!==activeForm){
      activeForm=form;
      documentCacheKey='';
      documentCache=null;
      eligibilityKey='';
    }
    reconciling=true;
    try{
      const payment=await readCurrentPayment();
      if(form!==paymentForm())return;
      hydrateSavedApplications(payment);
      await pruneIneligibleInvoices(payment);
      syncHeaderTotals(payment);
    }finally{reconciling=false;}
  }

  function schedule(){
    if(reconcileQueued)return;
    reconcileQueued=true;
    queueMicrotask(()=>{reconcileQueued=false;reconcile();});
  }

  document.addEventListener('input',event=>{
    if(event.target.matches?.('#paymentAmount,#financeChargeAmount,#writeOffAmount,.doc-amt,.so-amt,.payment-gl-amount'))schedule();
  });
  document.addEventListener('change',event=>{
    if(event.target.matches?.('#paymentCustomerNumber,#customerLookupPay,.doc-pick,.so-pick,#paymentCashAccount')){
      if(event.target.matches?.('#paymentCustomerNumber,#customerLookupPay'))eligibilityKey='';
      schedule();
    }
  });
  document.addEventListener('click',event=>{
    if(event.target.closest?.('#paymentForm'))setTimeout(schedule,0);
  });

  const observer=new MutationObserver(()=>schedule());
  observer.observe(document.body,{childList:true,subtree:true});
  if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',schedule,{once:true});
  else schedule();
})();
