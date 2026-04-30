export const glAccounts = [
  { code: '1000', name: 'Cash - Operating', type: 'Asset', category: 'Balance Sheet', normal: 'Debit', balance: 150000 },
  { code: '1100', name: 'Accounts Receivable - Trade', type: 'Asset', category: 'Balance Sheet', normal: 'Debit', balance: 25000, subledger: 'AR' },
  { code: '1190', name: 'Allowance for Doubtful Accounts', type: 'Contra Asset', category: 'Balance Sheet', normal: 'Credit', balance: 1000 },
  { code: '1200', name: 'Inventory - Finished Goods', type: 'Asset', category: 'Balance Sheet', normal: 'Debit', balance: 50000, subledger: 'Inventory' },
  { code: '2000', name: 'Accounts Payable - Trade', type: 'Liability', category: 'Balance Sheet', normal: 'Credit', balance: 18000, subledger: 'AP' },
  { code: '3000', name: 'Retained Earnings', type: 'Equity', category: 'Balance Sheet', normal: 'Credit', balance: 76000 },
  { code: '4000', name: 'Revenue - Product Sales', type: 'Revenue', category: 'P&L', normal: 'Credit', balance: 45000 },
  { code: '4050', name: 'Sales Returns and Allowances', type: 'Contra Revenue', category: 'P&L', normal: 'Debit', balance: 1200 },
  { code: '5000', name: 'Cost of Goods Sold', type: 'Expense', category: 'P&L', normal: 'Debit', balance: 19000 }
];

export const customers = [
  { customerNumber: 'C0001', customerName: 'ABC Studios Inc', creditTerms: '30D', status: 'Active', balance: 15000 },
  { customerNumber: 'C0002', customerName: 'Northwind Foods', creditTerms: '15D', status: 'Active', balance: 6200 },
  { customerNumber: 'C0003', customerName: 'Summit Retail Group', creditTerms: '45D', status: 'Credit Hold', balance: 3800 }
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

export const invoices = [
  { invoiceNumber: 'AR0000001', docType: 'invoice', customerNumber: 'C0001', customerName: 'ABC Studios Inc', invoiceTotal: 12000, invoiceDate: '2026-04-05', dueDate: '2026-05-05', creditTerms: '30D', status: 'Open', applications: [], auditTrail: [{ action: 'Created', at: '2026-04-05T09:00:00Z' }] },
  { invoiceNumber: 'AR0000002', docType: 'invoice', customerNumber: 'C0002', customerName: 'Northwind Foods', invoiceTotal: 6200, invoiceDate: '2026-04-12', dueDate: '2026-04-27', creditTerms: '15D', status: 'Open', applications: [], auditTrail: [{ action: 'Created', at: '2026-04-12T12:10:00Z' }] }
];

export const journalEntries = [];
export const customizations = { forms: {}, features: {} };
