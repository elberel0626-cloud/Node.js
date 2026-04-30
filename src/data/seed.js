export const glAccounts = [
  { code: '1000', name: 'Cash - Operating', type: 'Asset' },
  { code: '1100', name: 'Accounts Receivable - Trade', type: 'Asset', subledger: 'AR' },
  { code: '1190', name: 'Allowance for Doubtful Accounts', type: 'Asset Contra' },
  { code: '1200', name: 'Inventory - Raw Materials', type: 'Asset', subledger: 'Inventory' },
  { code: '1210', name: 'Inventory - WIP', type: 'Asset', subledger: 'Inventory' },
  { code: '1220', name: 'Inventory - Finished Goods', type: 'Asset', subledger: 'Inventory' },
  { code: '2000', name: 'Accounts Payable - Trade', type: 'Liability', subledger: 'AP' },
  { code: '2100', name: 'Accrued Expenses', type: 'Liability' },
  { code: '3000', name: 'Retained Earnings', type: 'Equity' },
  { code: '4000', name: 'Revenue - Product Sales', type: 'Revenue' },
  { code: '4050', name: 'Sales Returns and Allowances', type: 'Revenue Contra' },
  { code: '5000', name: 'Cost of Goods Sold', type: 'Expense' }
];

export const arSetup = {
  quickActions: ['New Invoice', 'New Payment', 'New Customer'],
  menu: {
    transactions: ['Invoices and Memos', 'Payments and Applications'],
    profiles: ['Customers', 'Credit Terms'],
    processes: [
      'Release AR Documents',
      'Print Invoice and Memos',
      'Write Off Balances and Credits',
      'Prepare Client Statements',
      'Close Financial Periods',
      'Manage Credit Holds'
    ],
    reports: [
      'AR Aging Report',
      'AR Balance by Customer',
      'AR Detailed Transactions by Period',
      'AR Cash Receipts by Period'
    ]
  }
};

export const invoices = [];

export const customizations = {
  forms: {},
  features: {}
};
