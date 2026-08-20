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

test('AP Bills helper no longer forces a full-page navigation to the login shell',async()=>{
  const helper=await readFile(new URL('../public/apBillsPoStatusColumns.js',import.meta.url),'utf8');
  assert.doesNotMatch(helper,/window\.location\.assign/);
  assert.doesNotMatch(helper,/stopImmediatePropagation/);
  assert.match(helper,/poNumbers/);
  assert.match(helper,/poMatchStatus/);
});
