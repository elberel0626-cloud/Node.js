import { readFile, writeFile } from 'node:fs/promises';

async function patchFile(path, edits) {
  let text = await readFile(path, 'utf8');
  for (const { name, from, to, count = 1 } of edits) {
    const hits = text.split(from).length - 1;
    if (hits !== count) throw new Error(`${path}: ${name} expected ${count} match(es), found ${hits}`);
    text = text.split(from).join(to);
  }
  await writeFile(path, text);
  console.log(`patched ${path}`);
}

await patchFile('src/server.js', [
  {
    name: 'serve compatibility JavaScript as JavaScript',
    from: "if(['/app.js','/styles.css','/responsive.css'].includes(p))",
    to: "if(['/app.js','/apBillCompatibility.js','/styles.css','/responsive.css'].includes(p))"
  },
  {
    name: 'sales-order prepared invoice owns quantity release once',
    from: "shipmentNumber:shipmentId||'',applications:[]}; applyTaxToArDocument(inv",
    to: "shipmentNumber:shipmentId||'',applications:[],salesQuantitiesReleased:true}; applyTaxToArDocument(inv"
  }
]);

await patchFile('src/security.js', [
  {
    name: 'allow application inline style attributes while retaining self-only scripts',
    from: "script-src 'self'; style-src 'self'; img-src",
    to: "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src"
  }
]);

await patchFile('public/app.js', [
  {
    name: 'supply JSON content type for direct mutating string fetch bodies',
    from: "const method=String(options.method||'GET').toUpperCase(),headers=new Headers(options.headers||{});if(['POST','PUT','PATCH','DELETE'].includes(method)&&!String(input).endsWith('/api/auth/login'))",
    to: "const method=String(options.method||'GET').toUpperCase(),headers=new Headers(options.headers||{});if(['POST','PUT','PATCH','DELETE'].includes(method)&&typeof options.body==='string'&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');if(['POST','PUT','PATCH','DELETE'].includes(method)&&!String(input).endsWith('/api/auth/login'))"
  },
  {
    name: 'clear stale ERP dialogs on every routed render',
    from: "async function router(){if(location.pathname==='/')history.replaceState({},'','/ar');",
    to: "async function router(){document.querySelectorAll('.erp-dialog-overlay').forEach(overlay=>overlay.remove());if(location.pathname==='/')history.replaceState({},'','/ar');"
  },
  {
    name: 'reserve chart-of-accounts manager for explicit manage route',
    from: "if(location.pathname==='/finance/chart-of-accounts/manage'||(location.pathname==='/finance/chart-of-accounts'&&!location.search)){await renderChartOfAccountsManager(v);return;}",
    to: "if(location.pathname==='/finance/chart-of-accounts/manage'){await renderChartOfAccountsManager(v);return;}"
  },
  {
    name: 'hide AP payment branch selector while preserving posting value',
    from: "<label>Branch<select id='pBranch'",
    to: "<label class='hidden'>Branch<select id='pBranch'"
  },
  {
    name: 'mount shared attachments on AR payments',
    from: "if(v==='customer'){history.pushState({},'',`/ar/customers/${doc.customerId}`); router(); return;} iSel.value='';}; bindRecordNavigationControls(); return; } if(doc.type==='Invoice' || doc.type==='Credit Memo' || doc.type==='Debit Memo')",
    to: "if(v==='customer'){history.pushState({},'',`/ar/customers/${doc.customerId}`); router(); return;} iSel.value='';}; if(doc.id!=='<NEW>')await mountAccountingAttachments({entityType:'ARPayment',entityId:doc.id,toolbar:$('.erp-toolbar')}); bindRecordNavigationControls(); return; } if(doc.type==='Invoice' || doc.type==='Credit Memo' || doc.type==='Debit Memo')"
  },
  {
    name: 'give financial report cards exact accessible names',
    from: "`<a class='panel report-card' href='${href}'><h3>${name}</h3><p>${description}</p></a>`",
    to: "`<a class='panel report-card' aria-label='${esc(name)}' href='${href}'><h3>${name}</h3><p>${description}</p></a>`"
  },
  {
    name: 'sales order description fallback does not reference journal state',
    from: "<input class='sl-desc' value='${esc(l.lineDescription||l.description||(je.module==='GL'&&l.sourceReference!==je.jeNumber?l.sourceReference:'')||'')}'",
    to: "<input class='sl-desc' value='${esc(l.lineDescription||l.description||l.itemId||l.inventoryId||'')}'"
  },
  {
    name: 'purchase order description fallback does not reference journal state',
    from: "<input data-k='description' value='${esc(l.lineDescription||l.description||(je.module==='GL'&&l.sourceReference!==je.jeNumber?l.sourceReference:'')||'')}'",
    to: "<input data-k='description' value='${esc(l.lineDescription||l.description||l.inventoryId||l.itemId||'')}'"
  },
  {
    name: 'incoming inline review description fallback does not reference journal state',
    from: "<td><input value='${esc(l.lineDescription||l.description||(je.module==='GL'&&l.sourceReference!==je.jeNumber?l.sourceReference:'')||'')}' maxlength='255'></td>",
    to: "<td><input value='${esc(l.lineDescription||l.description||l.itemCode||l.inventoryId||'')}' maxlength='255'></td>"
  },
  {
    name: 'incoming full review description fallback does not reference journal state',
    from: "data-line-field='description' value='${esc(l.lineDescription||l.description||(je.module==='GL'&&l.sourceReference!==je.jeNumber?l.sourceReference:'')||'')}'",
    to: "data-line-field='description' value='${esc(l.lineDescription||l.description||l.itemCode||l.inventoryId||'')}'"
  },
  {
    name: 'AP bill inquiry accepts either serialized JE field',
    from: "if(action==='view-journal'&&state.jeNumber)window.open(`/finance/journal/${encodeURIComponent(state.jeNumber)}`,'_blank','noopener');",
    to: "if(action==='view-journal'&&(state.journalEntryNumber||state.jeNumber))window.open(`/finance/journal/${encodeURIComponent(state.journalEntryNumber||state.jeNumber)}`,'_blank','noopener');"
  },
  {
    name: 'AP bill details accepts either serialized JE field',
    from: "<p><b>JE Reference:</b> ${state.jeNumber?`<a class='link' href='/finance/journal/${encodeURIComponent(state.journalEntryNumber||state.jeNumber)}'>${state.jeNumber}</a>`:'Not posted'}</p>",
    to: "<p><b>JE Reference:</b> ${state.journalEntryNumber||state.jeNumber?`<a class='link' href='/finance/journal/${encodeURIComponent(state.journalEntryNumber||state.jeNumber)}'>${state.journalEntryNumber||state.jeNumber}</a>`:'Not posted'}</p>"
  }
]);

console.log('ERP regression repair patch completed.');
