export const JOURNAL_ROUNDING_TOLERANCE = 0.01;

export function isManualJournal(je) {
  return je?.module === 'GL' && !je.reclassOf && (je.generatedFromReversingJournal || (!je.reversalOf && (!je.sourceRef || je.sourceRef === je.jeNumber)));
}

export function journalTotals(je) {
  const totalDebit = (je?.lines || []).reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const totalCredit = (je?.lines || []).reduce((sum, line) => sum + Number(line.credit || 0), 0);
  return { totalDebit, totalCredit, difference: totalDebit - totalCredit };
}

export function validateJournalForPosting(je, { validatePeriod, validateAccount, validateBranch } = {}) {
  if (!je) throw Object.assign(new Error('Journal entry was not found'), { statusCode: 404 });
  if (je.status === 'Posted' || je.postedAt) throw Object.assign(new Error(`Journal entry ${je.jeNumber} has already been posted`), { statusCode: 409, code: 'ALREADY_POSTED' });
  if (je.status === 'Reversed') throw Object.assign(new Error(`Journal entry ${je.jeNumber} has been reversed and cannot be posted`), { statusCode: 409 });
  if (!['Saved', 'Draft'].includes(je.status)) throw Object.assign(new Error(`Journal status ${je.status} is not eligible for posting`), { statusCode: 400 });
  if (!(je.lines || []).length) throw Object.assign(new Error('Journal entry must have at least one line'), { statusCode: 400 });
  const totals = journalTotals(je);
  if (totals.totalDebit <= 0) throw Object.assign(new Error('Journal entry must contain a debit and credit greater than zero'), { statusCode: 400 });
  if (Math.abs(totals.difference) > JOURNAL_ROUNDING_TOLERANCE) throw Object.assign(new Error(`Out-of-balance JE: difference ${totals.difference.toFixed(2)}`), { statusCode: 400 });
  const period = je.postPeriod || je.financialPeriod || String(je.transactionDate || '').slice(0, 7);
  validatePeriod?.(period);
  const manual = isManualJournal(je);
  for (const [index, line] of je.lines.entries()) {
    if (Number(line.debit || 0) < 0 || Number(line.credit || 0) < 0 || (Number(line.debit || 0) > 0 && Number(line.credit || 0) > 0)) throw Object.assign(new Error(`Journal line ${index + 1} has invalid debit or credit values`), { statusCode: 400 });
    validateAccount?.(line.account, { manual, lineNumber: index + 1 });
    validateBranch?.(line.branch || '100', { lineNumber: index + 1 });
  }
  return { ...totals, period, manual };
}
