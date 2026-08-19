import { readFile, writeFile } from 'node:fs/promises';

async function patch(path, edits) {
  let text = await readFile(path, 'utf8');
  for (const { name, from, to, count = 1 } of edits) {
    const hits = text.split(from).length - 1;
    if (hits !== count) throw new Error(`${path}: ${name} expected ${count} match(es), found ${hits}`);
    text = text.split(from).join(to);
  }
  await writeFile(path, text);
  console.log(`patched ${path}`);
}

await patch('public/app.js', [
  {
    name: 'update local vendor suggestions immediately and invalidate stale selection',
    from: "const changed=input=>{setValidity(`Select a valid active ${kind}.`);clearTimeout(timer);timer=setTimeout(()=>render(input.value,input),180);};",
    to: "const changed=input=>{selected=null;hidden.value='';setValidity(`Select a valid active ${kind}.`);clearTimeout(timer);render(input.value,input);};"
  },
  {
    name: 'mark shared attachment links for authenticated binary viewer',
    from: "<a class='link' target='_blank' rel='noopener' href='${esc(item.viewUrl)}'>${esc(item.fileName)}</a>",
    to: "<a class='link attachment-view' href='${esc(item.viewUrl)}'>${esc(item.fileName)}</a>"
  },
  {
    name: 'open shared PDF attachments through authenticated fetch and blob URL',
    from: "const load=async()=>{const rows=await api(`/api/attachments/${entityType}/${encodeURIComponent(entityId)}`);button.textContent=`📎 Attachments${rows.length?` ${rows.length}`:''}`;",
    to: "host.addEventListener('click',async event=>{const link=event.target.closest('.attachment-view');if(!link)return;event.preventDefault();event.stopPropagation();const popup=window.open('about:blank','_blank');if(!popup)return showErpDialog({title:'Unable to open PDF',message:'Allow pop-ups for this ERP to view attachments.',type:'error'});try{popup.document.title='Opening PDF';popup.document.body.textContent='Loading PDF…';const response=await fetch(link.getAttribute('href'),{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw new Error(`PDF could not be opened (${response.status}).`);const type=response.headers.get('content-type')||'';if(!type.toLowerCase().includes('application/pdf'))throw new Error('The attachment response was not a PDF.');const pdf=await response.blob(),url=URL.createObjectURL(pdf);popup.opener=null;popup.location.href=url;setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(error){popup.close();showErpDialog({title:'Unable to open PDF',message:error.message,details:error.message,type:'error'});}});const load=async()=>{const rows=await api(`/api/attachments/${entityType}/${encodeURIComponent(entityId)}`);button.textContent=`📎 Attachments${rows.length?` ${rows.length}`:''}`;"
  }
]);
