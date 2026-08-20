import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { applyApBillsGridPatch } from '../src/apBillsGridPatch.js';

const routeStart="if(location.pathname==='/ap/bills'){ const rows=await api('/api/ap/documents?type=Bill');";
const routeEnd=" if(location.pathname.startsWith('/ap/bills/')||location.pathname.startsWith('/ap/approvals/'))";

test('AP Bills route makes PO number and PO match status native ERP grid columns',()=>{
  const source=`before ${routeStart} old grid implementation }${routeEnd}{ after }`;
  const patched=applyApBillsGridPatch(source);
  assert.match(patched,/key:'poNumbers',label:'PO Number'/);
  assert.match(patched,/key:'poMatchStatus',label:'PO Match Status'/);
  assert.match(patched,/ErpDataGrid\(\{id:'apBillGrid'/);
  assert.match(patched,/poNumbers:billPoNumbers\(doc\)\.join\(', '\)/);
  assert.match(patched,/poMatchStatus:billPoMatchStatus\(doc\)/);
  assert.equal(applyApBillsGridPatch(patched),patched);
});

test('current app.js Bills and Adjustments route is covered by the startup patch',async()=>{
  const appSource=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const patched=applyApBillsGridPatch(appSource);
  assert.notEqual(patched,appSource);
  assert.doesNotMatch(patched,/if\(location\.pathname==='\/ap\/bills'\)\{ const rows=await api\('\/api\/ap\/documents\?type=Bill'\);/);
  assert.match(patched,/key:'poNumbers',label:'PO Number'/);
  assert.match(patched,/key:'poMatchStatus',label:'PO Match Status'/);
});

test('AP Bills helper prepares and enriches PO columns before first grid render',async()=>{
  const helper=await readFile(new URL('../public/apBillsPoStatusColumns.js',import.meta.url),'utf8');
  assert.doesNotMatch(helper,/window\.location\.assign/);
  assert.doesNotMatch(helper,/stopImmediatePropagation/);
  assert.match(helper,/REQUIRED_COLUMNS=\['poNumbers','poMatchStatus'\]/);
  assert.match(helper,/DEFAULT_COLUMNS=\['id','vendorName','date','dueDate','status','amount','balance','poNumbers','poMatchStatus','journalEntryNumber'\]/);
  assert.match(helper,/const enrichBill=doc=>\(\{\.\.\.doc,poNumbers:poNumbers\(doc\)\.join\(', '\),poMatchStatus:poMatchStatus\(doc\)\}\)/);
  assert.match(helper,/url\.pathname==='\/api\/ap\/documents'&&url\.searchParams\.get\('type'\)==='Bill'/);
  assert.match(helper,/rows\.map\(enrichBill\)/);
  assert.match(helper,/migrateAllKnownSettings\(\);/);
  assert.match(helper,/settings\.visibleColumns\.push\(column\)/);
  assert.match(helper,/settings\.columnOrder\.push\(column\)/);
});

test('AP Bills filter popup remains inside the viewport',async()=>{
  const helper=await readFile(new URL('../public/apBillsPoStatusColumns.js',import.meta.url),'utf8');
  assert.match(helper,/keepFilterPopupInViewport/);
  assert.match(helper,/window\.innerWidth-rect\.width-margin/);
  assert.match(helper,/window\.innerHeight-rect\.height-margin/);
  assert.match(helper,/window\.dispatchEvent\(new PopStateEvent\('popstate'\)\)/);
});
