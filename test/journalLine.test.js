import assert from 'node:assert/strict';
import test from 'node:test';

import { journalLineDescription, normalizeManualJournalLine } from '../src/journalLine.js';

test('manual journal line descriptions are saved independently from the JE reference', () => {
  const line = normalizeManualJournalLine({ account: '1000', debit: 25, lineDescription: 'Bank fee, July.' }, { jeNumber: 'JE000123' });
  assert.equal(line.lineDescription, 'Bank fee, July.');
  assert.equal(line.sourceReference, 'JE000123');
  assert.equal(journalLineDescription(line, 'JE000123'), 'Bank fee, July.');
});

test('older manual journal references remain available as description fallback', () => {
  assert.equal(journalLineDescription({ sourceReference: 'Legacy accrual explanation' }, 'JE000099'), 'Legacy accrual explanation');
});

test('manual descriptions cannot replace generated source references', () => {
  const generated = { sourceReference: 'BILL-1001', lineDescription: 'Inventory expense' };
  assert.equal(generated.sourceReference, 'BILL-1001');
  assert.equal(journalLineDescription(generated), 'Inventory expense');
});
