(()=>{
  const isInventory=()=>location.pathname==='/inventory'||location.pathname.startsWith('/inventory/');

  function syncInventoryModuleHighlight(){
    if(!isInventory())return;
    const nav=document.getElementById('module-nav');
    if(!nav)return;
    const inventoryLink=nav.querySelector("a[href='/inventory']");
    if(!inventoryLink)return;
    nav.querySelectorAll('a').forEach(link=>link.classList.toggle('active',link===inventoryLink));
  }

  document.addEventListener('click',event=>{
    const link=event.target?.closest?.("a[href^='/inventory']");
    if(link)setTimeout(syncInventoryModuleHighlight,0);
  },true);
  document.addEventListener('inventory-v2-runtime-loaded',()=>setTimeout(syncInventoryModuleHighlight,0));
  window.addEventListener('popstate',()=>setTimeout(syncInventoryModuleHighlight,0));
  new MutationObserver(()=>queueMicrotask(syncInventoryModuleHighlight)).observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(syncInventoryModuleHighlight,0);
})();
