(() => {
  // Compatibility cleanup only. apProfessionalMatchingV2.js is the single owner
  // of AP Bill > Purchase Order matching UI and data loading.
  const isApBill = () => /^\/ap\/(?:bills|approvals)\/[^/]+$/.test(location.pathname);
  function cleanLegacyPoActions() {
    if (!isApBill()) return;
    const panel=document.getElementById('purchaseOrder');
    if (!panel) return;
    panel.querySelector('.po-match-actions')?.classList.add('hidden');
    document.getElementById('apPoProfessionalWorkspace')?.remove();
    const actions=document.getElementById('bActions');
    if (actions) [...actions.options].forEach(option=>{
      if (['add-po','add-receipt','add-receipt-line'].includes(option.value)) option.remove();
    });
  }
  let queued=false;
  const scan=()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;cleanLegacyPoActions();});};
  new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('popstate',scan);
  scan();
})();
