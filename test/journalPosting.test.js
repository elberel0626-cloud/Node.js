import assert from 'node:assert/strict';
import test from 'node:test';
import { isManualJournal, journalTotals, validateJournalForPosting } from '../src/journalPosting.js';

const valid = (overrides = {}) => ({ jeNumber: 'JE900001', module: 'GL', sourceRef: 'JE900001', status: 'Saved', postPeriod: '2026-08', lines: [{ account: '1079', branch: '100', debit: 25, credit: 0 }, { account: '2010', branch: '100', debit: 0, credit: 25 }], ...overrides });

test('posting validation accepts a balanced saved manual journal and reports authoritative totals', () => {
  const seen = [];
  const result = validateJournalForPosting(valid(), { validatePeriod: period => assert.equal(period, '2026-08'), validateAccount: (account, context) => seen.push([account, context.manual]), validateBranch: branch => assert.equal(branch, '100') });
  assert.deepEqual(journalTotals(valid()), { totalDebit: 25, totalCredit: 25, difference: 0 });
  assert.equal(result.manual, true);
  assert.deepEqual(seen, [['1079', true], ['2010', true]]);
});

test('posting validation rejects ineligible, empty, unbalanced, closed-period and invalid-account journals', () => {
  assert.throws(() => validateJournalForPosting(valid({ status: 'Posted' })), /already been posted/);
  assert.throws(() => validateJournalForPosting(valid({ lines: [] })), /at least one line/);
  assert.throws(() => validateJournalForPosting(valid({ lines: [{ account: '1079', debit: 10 }] })), /Out-of-balance/);
  assert.throws(() => validateJournalForPosting(valid(), { validatePeriod: () => { throw new Error('GL period is closed'); } }), /closed/);
  assert.throws(() => validateJournalForPosting(valid(), { validateAccount: () => { throw new Error('inactive account'); } }), /inactive account/);
});

test('manual-account restriction is not applied to system-generated journals', () => {
  const generated = valid({ module: 'AP', sourceRef: 'BILL-1001' });
  const flags = [];
  validateJournalForPosting(generated, { validateAccount: (_account, context) => flags.push(context.manual) });
  assert.equal(isManualJournal(generated), false);
  assert.deepEqual(flags, [false, false]);
});

test('generated reversing journals retain manual account restrictions', () => {
  const journal=valid({reversalOf:'JE000001',generatedFromReversingJournal:true,sourceRef:'JE000002'});
  assert.throws(()=>validateJournalForPosting(journal,{validateAccount:(_code,{manual})=>{if(manual)throw new Error('manual restriction');}}),/manual restriction/);
});
