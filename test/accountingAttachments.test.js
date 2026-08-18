import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AccountingAttachmentStore } from '../src/accountingAttachments.js';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
const user = { id: 'accountant', name: 'Alex Accountant' };

test('shared accounting attachments persist multiple PDFs and append audit events', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'erp-attachments-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AccountingAttachmentStore({ directory }); await store.init();
  const first = await store.add({ entityType:'JournalEntry', entityId:'JE000001', documentNumber:'JE000001', fileName:'support.pdf', mimeType:'application/pdf', content:pdf, user });
  await store.add({ entityType:'JournalEntry', entityId:'JE000001', documentNumber:'JE000001', fileName:'approval.pdf', mimeType:'application/pdf', content:pdf, user });
  assert.equal(store.list('JournalEntry','JE000001').length, 2);
  assert.match(store.list('JournalEntry','JE000001')[0].viewUrl, /^\/api\/attachments\/ATT-.+\/file$/);
  assert.equal('storageReference' in store.list('JournalEntry','JE000001')[0], false);
  const reloaded = new AccountingAttachmentStore({ directory }); await reloaded.init();
  assert.deepEqual(reloaded.list('JournalEntry','JE000001').map(item=>item.fileName), ['support.pdf','approval.pdf']);
  await reloaded.remove(first.attachmentId, user);
  assert.equal(reloaded.list('JournalEntry','JE000001').length, 1);
  assert.deepEqual(reloaded.audit.map(event=>event.action), ['Attachment Removed','Attachment Added','Attachment Added']);
  assert.equal((await readFile(path.join(directory,'audit.json'),'utf8')).includes('JE000001'), true);
});

test('shared accounting attachments reject spoofed PDFs and unsupported entities', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'erp-attachments-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new AccountingAttachmentStore({ directory }); await store.init();
  await assert.rejects(store.add({ entityType:'JournalEntry', entityId:'JE1', documentNumber:'JE1', fileName:'fake.pdf', mimeType:'application/pdf', content:Buffer.from('not a pdf'), user }), /not a valid PDF/);
  await assert.rejects(store.add({ entityType:'Unknown', entityId:'1', documentNumber:'1', fileName:'real.pdf', mimeType:'application/pdf', content:pdf, user }), /Unsupported/);
});
