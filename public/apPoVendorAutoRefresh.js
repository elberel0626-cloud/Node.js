(()=>{
  const isNewBill=()=>/^\/ap\/bills\/(?:new|__new__)$/.test(location.pathname);
  let lastVendor='';
  let lastPath='';
  function currentVendor(){
    return String(document.getElementById('bvend')?.value||'').trim().split(/\s+—\s+|\s+-\s+/)[0].trim();
  }
  function clearOldPoLinks(){
    const poFields=[...document.querySelectorAll('#billLines .ln-po')];
    const receiptFields=[...document.querySelectorAll('#billLines .ln-rcpt')];
    let changed=false;
    poFields.forEach(input=>{if(input.value){input.value='';changed=true;}});
    receiptFields.forEach(input=>{if(input.value){input.value='';changed=true;}});
    if(changed){
      const sync=poFields[0]||receiptFields[0];
      sync?.dispatchEvent(new Event('input',{bubbles:true}));
    }
  }
  function refreshForVendorChange(){
    if(!isNewBill()){
      lastPath=location.pathname;
      lastVendor='';
      return;
    }
    if(lastPath!==location.pathname){
      lastPath=location.pathname;
      lastVendor=currentVendor();
      return;
    }
    const vendor=currentVendor();
    if(vendor===lastVendor)return;
    const previous=lastVendor;
    lastVendor=vendor;
    if(previous&&previous!==vendor)clearOldPoLinks();
    const hidden=document.getElementById('bvend');
    if(hidden){
      hidden.dispatchEvent(new Event('input',{bubbles:true}));
      hidden.dispatchEvent(new CustomEvent('erp:ap-vendor-selected',{bubbles:true,detail:{vendorId:vendor,previousVendorId:previous}}));
    }
  }
  setInterval(refreshForVendorChange,120);
  window.addEventListener('popstate',()=>{lastPath='';lastVendor='';setTimeout(refreshForVendorChange,0)});
})();
