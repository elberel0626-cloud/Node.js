const marker='arProfessionalDocumentsV1';
const managedRoutes=new Set(['/ar/processes/statements','/ar/processes/print-ar']);
function resetMarkerOutsideManagedRoutes(){
  const view=document.getElementById('view');
  if(view&&!managedRoutes.has(location.pathname))delete view.dataset[marker];
}
function boot(){
  const view=document.getElementById('view');
  if(view)new MutationObserver(resetMarkerOutsideManagedRoutes).observe(view,{childList:true,subtree:false});
  window.addEventListener('popstate',resetMarkerOutsideManagedRoutes);
  resetMarkerOutsideManagedRoutes();
}
if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
