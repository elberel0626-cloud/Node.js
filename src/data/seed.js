export const creditTerms = [
  { id: 'NET15', name: 'Net 15', days: 15 },
  { id: 'NET30', name: 'Net 30', days: 30 }
];

export const customers = [
  { id: 'CUS001', name: 'ABC Studios Inc', email: 'ap@abc.com', creditLimit: 20000, terms: 'NET30', status: 'Active' },
  { id: 'CUS002', name: 'Northwind Foods', email: 'finance@northwind.com', creditLimit: 10000, terms: 'NET15', status: 'Active' }
];

export const invoices = [];
export const payments = [];
export const glAccounts = [
  { code: '1000', name: 'Cash', normal: 'Debit', balance: 150000 },
  { code: '1100', name: 'Accounts Receivable', normal: 'Debit', balance: 0 },
  { code: '4000', name: 'Revenue', normal: 'Credit', balance: 0 }
];
export const journalEntries = [];
