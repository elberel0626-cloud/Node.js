export const glAccounts = [
  { code: '1000', name: 'Cash - Operating', type: 'Asset', category: 'Balance Sheet', normal: 'Debit', balance: 150000 },
  { code: '1100', name: 'Accounts Receivable - Trade', type: 'Asset', category: 'Balance Sheet', normal: 'Debit', balance: 25000, subledger: 'AR' },
  { code: '4000', name: 'Revenue - Product Sales', type: 'Revenue', category: 'P&L', normal: 'Credit', balance: 45000 },
  { code: '4050', name: 'Sales Returns and Allowances', type: 'Contra Revenue', category: 'P&L', normal: 'Debit', balance: 1200 }
];

export const creditTerms = [
  { code: 'NET15', description: 'Net 15', days: 15 },
  { code: 'NET30', description: 'Net 30', days: 30 },
  { code: 'NET45', description: 'Net 45', days: 45 }
];

export const customers = [
  { customerNumber: 'C0001', name: 'ABC Studios Inc', email: 'ap@abc.com', creditLimit: 20000, creditTerms: 'NET30', status: 'Active' },
  { customerNumber: 'C0002', name: 'Northwind Foods', email: 'finance@northwind.com', creditLimit: 10000, creditTerms: 'NET15', status: 'Active' }
];

export const arSetup = {
  quickActions: ['New Invoice', 'New Payment', 'New Customer'],
  groups: {
    Transactions: ['Invoices and Memos', 'Payments and Applications'],
    Profiles: ['Customers', 'Credit Terms'],
    Processes: ['Release AR Documents', 'Print Invoice and Memos', 'Write Off Balances and Credits', 'Prepare Client Statement', 'Close Financial Periods', 'Manage Credit Holds'],
    Reports: ['AR Aging Report', 'AR Balance by Customer', 'AR Detailed Transactions by Period', 'AR Cash Receipts by Period']
  }
};

export const invoices = [];
export const payments = [];
export const journalEntries = [];
export const customizations = { forms: {}, features: {} };
export const closedPeriods = [];
