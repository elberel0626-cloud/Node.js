import test from 'node:test';
import assert from 'node:assert/strict';
import { server, db } from './server.js';

function request(path, options = {}) {
  return fetch(`http://127.0.0.1:${server.address().port}${path}`, options).then((r) => r.json());
}

test('AR dashboard has quick actions', async (t) => {
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());

  const dashboard = await request('/api/ar/dashboard');
  assert.deepEqual(dashboard.quickActions, ['New Invoice', 'New Payment', 'New Customer']);
});

test('Posting credit memo creates expected GL impact', async (t) => {
  if (!server.listening) {
    await new Promise((resolve) => server.listen(0, resolve));
    t.after(() => server.close());
  }
  const customerId = db.ar.customers[0].id;
  const doc = await request('/api/ar/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      number: 'CM0001',
      orderNumber: 'SO1001',
      customerId,
      type: 'CreditMemo',
      total: 500,
      invoiceDate: '2026-04-29',
      dueDate: '2026-04-29'
    })
  });

  assert.equal(doc.type, 'CreditMemo');
  const glImpact = db.ar.glEntries.find((g) => g.documentNo === 'CM0001');
  assert.equal(glImpact.lines[0].side, 'Credit');
  assert.equal(glImpact.lines[1].side, 'Debit');
});
