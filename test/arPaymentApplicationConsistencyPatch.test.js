import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyArPaymentApplicationConsistencyServerPatch } from '../src/arPaymentApplicationConsistencyPatch.js';

test('saved AR payments validate that applications target posted open customer documents', () => {
  const source=`const arPaymentGlTotal=doc=>(doc.glApplications||[]).reduce((sum,row)=>sum+Number(row.amount||0),0);\nconst nextApplications=Array.isArray(b.applications)?b.applications:(d.applications||[]); const nextAvailable=Number(b.amount??d.amount??0)+Number(b.financeChargeAmount??d.financeChargeAmount??0)+Number(b.writeOffAmount??d.writeOffAmount??0);`;
  const patched=applyArPaymentApplicationConsistencyServerPatch(source);
  assert.match(patched,/validateArSavedPaymentApplications\(\{\.\.\.d,\.\.\.b\},nextApplications\)/);
  assert.match(patched,/Only posted open AR documents can be applied to a payment/);
  assert.match(patched,/invoice\.posted\|\|invoice\.status!=='Open'/);
});

test('payment UI consistency patch reconciles closed balances and filters invoice candidates', async () => {
  const source=await readFile(new URL('../public/arPaymentApplicationConsistency.js',import.meta.url),'utf8');
  assert.match(source,/payment\?\.posted&&status==='Closed'/);
  assert.match(source,/\/api\/ar\/open-invoices\?customerId=/);
  assert.match(source,/row\.posted&&row\.status==='Open'/);
  assert.match(source,/hydrateSavedApplications/);
});
