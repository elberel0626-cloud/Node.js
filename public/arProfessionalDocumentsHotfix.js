(()=>{
  const HOTFIX_KEY='arProfessionalDocumentsHotfixV2';
  if(window[HOTFIX_KEY])return;
  window[HOTFIX_KEY]=true;

  const nativeFetch=window.fetch.bind(window);
  window.fetch=async(input,options={})=>{
    const response=await nativeFetch(input,options);
    try{
      const rawUrl=typeof input==='string'?input:(input?.url||String(input||''));
      const url=new URL(rawUrl,location.origin);
      const method=String(options?.method||input?.method||'GET').toUpperCase();
      if(method==='GET'&&location.pathname==='/ar/processes/print-ar'&&url.pathname==='/api/ar/documents'&&response.ok){
        const data=await response.clone().json();
        if(Array.isArray(data)){
          const postedOnly=data.filter(document=>document?.type==='Invoice'&&document?.posted===true&&document?.status!=='Voided');
          return new Response(JSON.stringify(postedOnly),{
            status:response.status,
            statusText:response.statusText,
            headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
          });
        }
      }
    }catch(error){
      console.warn('AR posted-document filter hotfix could not inspect response.',error);
    }
    return response;
  };

  const statementCustomerId=()=>{
    const value=document.querySelector('#arStmtCustomerSearch input')?.value||'';
    return value.split(' — ')[0].trim();
  };
  const statementDate=()=>document.getElementById('arStmtDate')?.value||new Date().toISOString().slice(0,10);
  const selectedInvoiceId=()=>document.querySelector('input[name="arInvPick"]:checked')?.value||'';
  const appendInline=url=>url+(url.includes('?')?'&':'?')+'download=0';

  function openPdfTopLevel(url,title){
    const popup=window.open(appendInline(url),'_blank');
    if(!popup){
      alert(`Unable to open ${title}. Please allow pop-ups for this ERP site and try again.`);
      return null;
    }
    try{popup.opener=null;}catch{}
    return popup;
  }

  function printPdfTopLevel(url,title){
    const popup=openPdfTopLevel(url,title);
    if(!popup)return;
    setTimeout(()=>{
      try{popup.focus();popup.print();}
      catch{ /* Browser PDF viewers still expose their own Print control. */ }
    },1400);
  }

  document.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if(!button)return;

    if(button.id==='arStmtView'){
      const customerId=statementCustomerId();
      if(!customerId)return;
      event.preventDefault();event.stopImmediatePropagation();
      openPdfTopLevel(`/api/ar/reports/statement-pdf?customerId=${encodeURIComponent(customerId)}&statementDate=${encodeURIComponent(statementDate())}`,'statement');
      return;
    }
    if(button.id==='arStmtPrint'){
      const customerId=statementCustomerId();
      if(!customerId)return;
      event.preventDefault();event.stopImmediatePropagation();
      printPdfTopLevel(`/api/ar/reports/statement-pdf?customerId=${encodeURIComponent(customerId)}&statementDate=${encodeURIComponent(statementDate())}`,'statement');
      return;
    }
    if(button.id==='arInvView'){
      const invoiceId=selectedInvoiceId();
      if(!invoiceId)return;
      event.preventDefault();event.stopImmediatePropagation();
      openPdfTopLevel(`/api/ar/documents/${encodeURIComponent(invoiceId)}/pdf`,'invoice');
      return;
    }
    if(button.id==='arInvPrint'){
      const invoiceId=selectedInvoiceId();
      if(!invoiceId)return;
      event.preventDefault();event.stopImmediatePropagation();
      printPdfTopLevel(`/api/ar/documents/${encodeURIComponent(invoiceId)}/pdf`,'invoice');
    }
  },true);
})();
