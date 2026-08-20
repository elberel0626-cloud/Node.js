import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const defaultAppPath=path.resolve(here,'../public/app.js');
const START_MARKER="if(location.pathname==='/ap/bills'){ const rows=await api('/api/ap/documents?type=Bill');";
const END_MARKER=" if(location.pathname.startsWith('/ap/bills/')||location.pathname.startsWith('/ap/approvals/'))";
const PATCH_MARKER="const billPoNumbers=doc=>";

export function applyApBillsGridPatch(source){
  if(source.includes(PATCH_MARKER))return source;
  const start=source.indexOf(START_MARKER);
  const end=source.indexOf(END_MARKER,start);
  if(start<0||end<0)throw new Error('AP Bills grid integration failed: Bills and Adjustments route was not found.');
  const replacement=`if(location.pathname==='/ap/bills'){
 const sourceRows=await api('/api/ap/documents?type=Bill');
 const uniqueValues=values=>[...new Set((values||[]).map(value=>String(value||'').trim()).filter(Boolean))];
 const billPoNumbers=doc=>uniqueValues((doc?.lines||[]).map(line=>line.poNumber||line.sourcePoId||line.poId).concat(doc?.matchedPoNumber||doc?.poNumber||[]));
 const billPoMatchStatus=doc=>{
  const pos=billPoNumbers(doc);
  if(!pos.length)return'Non-PO';
  const match=doc?.threeWayMatch||{};
  const status=String(match.status||doc?.matchStatus||doc?.poMatchStatus||doc?.threeWayMatchStatus||(doc?.threeWayMatched?'Matched - Ready to Post':'Not Matched')).trim();
  return !status||status==='Not Applicable'?'Not Matched':status;
 };
 const billMatchClass=status=>{
  const value=String(status||'');
  if(/^(Posted|Matched - Ready to Post|Approved Match Exception - Ready to Post)$/i.test(value))return'ap-list-match-good';
  if(/Waiting for Receipt|Partially Received|Pending/i.test(value))return'ap-list-match-warn';
  if(/Exception|Variance|Not Matched|Blocked|Vendor Credit/i.test(value))return'ap-list-match-bad';
  return'ap-list-match-neutral';
 };
 const rows=sourceRows.map(doc=>({...doc,poNumbers:billPoNumbers(doc).join(', '),poMatchStatus:billPoMatchStatus(doc)}));
 configureRecordNavigationList({contextKey:'AP_BILLS',module:'AP',listUrl:'/ap/bills',gridId:'apBillGrid',records:rows.map(r=>({id:r.id,type:r.type||'Bill',detailUrl:\`/ap/bills/\${encodeURIComponent(r.id)}\`}))});
 v.innerHTML=\`<div class='header-row'><h3>Bills and Adjustments</h3><a href='/ap/bills/new'><button>New Bill</button></a></div>\${ErpDataGrid({id:'apBillGrid',columns:[
  {key:'id',label:'Reference Number',render:r=>\`<a class='link' href='/ap/bills/\${encodeURIComponent(r.id)}'>\${esc(r.id)}</a>\`},
  {key:'vendorName',label:'Vendor',render:r=>\`<a class='link' href='/ap/bills/\${encodeURIComponent(r.id)}'>\${esc(r.vendorName||'')}</a>\`},
  {key:'date',label:'Date'},
  {key:'dueDate',label:'Due Date'},
  {key:'status',label:'Status'},
  {key:'amount',label:'Amount'},
  {key:'balance',label:'Balance'},
  {key:'poNumbers',label:'PO Number',render:r=>r.poNumbers?String(r.poNumbers).split(',').map(po=>po.trim()).filter(Boolean).map(po=>\`<a class='link' href='/purchase-orders/orders/\${encodeURIComponent(po)}'>\${esc(po)}</a>\`).join(' '):'—'},
  {key:'poMatchStatus',label:'PO Match Status',render:r=>\`<span class='ap-list-match-pill \${billMatchClass(r.poMatchStatus)}'>\${esc(r.poMatchStatus||'Non-PO')}</span>\`},
  {key:'journalEntryNumber',label:'Journal Entry',render:r=>r.journalEntryNumber?\`<a class='link ap-view-journal' href='/finance/journal/\${encodeURIComponent(r.journalEntryNumber)}'>View Journal Entry</a>\`:'Journal Entry: Not Posted'}
 ],rows})}\`;
 bindGrid('apBillGrid');
 return;
}`;
  return source.slice(0,start)+replacement+source.slice(end);
}

export async function patchApBillsGridFile(appPath=defaultAppPath){
  const source=await readFile(appPath,'utf8');
  const patched=applyApBillsGridPatch(source);
  if(patched!==source)await writeFile(appPath,patched,'utf8');
  return appPath;
}
