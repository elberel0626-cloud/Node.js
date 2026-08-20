import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJournalCsv, validateJournalCsvRecords } from '../public/journalCsvImport.js';

test('parses quoted commas and escaped quotes', () => {
  const rows = parseJournalCsv('Branch,Branch Code,Account,Debit,Credit,Line Description\nMain,100,1010,"1,250.50",0,"Office, rent ""August"""');
  assert.deepEqual(rows[1], ['Main', '100', '1010', '1,250.50', '0', 'Office, rent "August"']);
});

test('validates required journal CSV columns and values', () => {
  const rows = validateJournalCsvRecords('Branch,Branch Code,Account,Debit,Credit,Line Description\nMain,100,1010,1250.50,0,Debit line\nMain,100,2010,0,1250.50,Credit line');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].debit, 1250.5);
  assert.equal(rows[1].credit, 1250.5);
});

test('rejects incorrect header order', () => {
  assert.throws(() => validateJournalCsvRecords('Branch,Account,Branch Code,Debit,Credit,Line Description\nMain,1010,100,5,0,Test'), /CSV columns must be exactly/);
});

test('rejects a line with both debit and credit', () => {
  assert.throws(() => validateJournalCsvRecords('Branch,Branch Code,Account,Debit,Credit,Line Description\nMain,100,1010,5,5,Test'), /either Debit or Credit/);
});
