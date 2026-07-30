const MAX_LINE_DESCRIPTION_LENGTH = 255;

export function journalLineDescription(line = {}, manualReference = '') {
  const legacyReference = line.sourceReference && line.sourceReference !== manualReference
    ? line.sourceReference
    : '';
  return String(line.lineDescription || line.description || legacyReference || '').slice(0, MAX_LINE_DESCRIPTION_LENGTH);
}

export function normalizeManualJournalLine(line = {}, { jeNumber, branchName = 'Custom Branch' } = {}) {
  return {
    branch: line.branch || '100',
    branchName,
    account: line.account,
    debit: Number(line.debit || 0),
    credit: Number(line.credit || 0),
    sourceReference: jeNumber,
    lineDescription: journalLineDescription(line, jeNumber),
    description: journalLineDescription(line, jeNumber),
    department: line.department || line.costCenter || '',
    costCenter: line.costCenter || line.department || '',
  };
}
