import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

test('AP bill status and GL parity UI previews server 3-way status before save',async()=>{
  const url=new URL('../public/apBillMatchStatusGlParity.js',import.meta.url),file=fileURLToPath(url),source=await readFile(url,'utf8');
  assert.match(source,/\/api\/ap\/po-match-preview/);
  assert.match(source,/Live Unsaved Preview/);
  assert.match(source,/Waiting for Receipt/);
  assert.match(source,/Partially Received/);
  assert.match(source,/Matched - Ready/);
  assert.match(source,/Price Variance/);
  assert.match(source,/GL Code/);
  assert.match(source,/GL Account Description/);
  assert.match(source,/receiptNotInvoicedAccount/);
  assert.match(source,/Posting Control/);
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
});
