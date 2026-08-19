import { readFile, writeFile } from 'node:fs/promises';

async function patch(path, edits){
  let text=await readFile(path,'utf8');
  for(const {name,from,to,count=1} of edits){
    const hits=text.split(from).length-1;
    if(hits!==count)throw new Error(`${path}: ${name} expected ${count} match(es), found ${hits}`);
    text=text.split(from).join(to);
  }
  await writeFile(path,text);
  console.log(`patched ${path}`);
}

await patch('public/app.js',[
  {
    name:'empty party lookup displays active master records',
    from:"shown=q.length<1?[]:activeItems.filter(x=>String(x.id||'').toLowerCase().includes(q)||String(x.name||'').toLowerCase().includes(q)).slice(0,60);",
    to:"shown=q.length<1?activeItems.slice(0,60):activeItems.filter(x=>String(x.id||'').toLowerCase().includes(q)||String(x.name||'').toLowerCase().includes(q)).slice(0,60);"
  },
  {
    name:'SPA routing leaves API downloads and new-tab links to the browser',
    from:"document.addEventListener('click',e=>{const anchor=e.target.closest('a[href]');if(!anchor||!anchor.getAttribute('href').startsWith('/'))return;if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();history.pushState({},'',anchor.getAttribute('href'));router();});window.onpopstate=router;",
    to:"document.addEventListener('click',e=>{const anchor=e.target.closest('a[href]');if(!anchor)return;const href=anchor.getAttribute('href')||'';if(!href.startsWith('/')||href.startsWith('/api/')||anchor.hasAttribute('download')||String(anchor.target||'').toLowerCase()==='_blank')return;if(e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();history.pushState({},'',href);router();});window.onpopstate=router;"
  }
]);
