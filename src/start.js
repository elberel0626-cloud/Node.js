import { glAccounts } from './data/seed.js';
import { applyStatementClassification } from './accountStatementClassification.js';

// Apply once to the seed before the server initializes, then again after the
// server has loaded any persisted chart-of-accounts file. The financial report
// service keeps the same glAccounts array reference, so the authoritative
// statement classification is visible everywhere without rewriting history.
applyStatementClassification(glAccounts);
await import('./server.js');
applyStatementClassification(glAccounts);
