export const creditTerms = [
  { id: 'NET30', name: 'Net 30', days: 30 },
  { id: 'NET15', name: 'Net 15', days: 15 },
  { id: 'DUE', name: 'Due on Receipt', days: 0 },
  { id: 'NET45', name: 'Net 45', days: 45 }
];

export const customers = [
  { id: 'CUST-1001', name: 'ABC Industries', terms: 'NET30', status: 'Active' },
  { id: 'CUST-1002', name: 'Global Tech Solutions', terms: 'NET15', status: 'Active' },
  { id: 'CUST-1003', name: 'Midwest Distribution', terms: 'DUE', status: 'Active' },
  { id: 'CUST-1004', name: 'Northern Supply Co', terms: 'NET45', status: 'Active' }
];

export const glAccounts = [
  { code: '1000', name: 'Cash', normal: 'Debit', balance: 100000 },
  { code: '1100', name: 'Accounts Receivable', normal: 'Debit', balance: 0 },
  { code: '4000', name: 'Revenue', normal: 'Credit', balance: 0 },
  { code: '4050', name: 'Returns and Allowances', normal: 'Debit', balance: 0 }
];

export const arDocuments = [
  { id: 'INV-1001', type: 'Invoice', customerId: 'CUST-1001', customerName: 'ABC Industries', date: '2026-05-01', dueDate: '2026-05-31', terms: 'NET30', amount: 12500, balance: 12500, status: 'Saved', posted: false, createdDate: '2026-05-01', lines:[{item:'Services',qty:1,unitPrice:12500,lineTotal:12500}], applications: [] },
  { id: 'INV-1002', type: 'Invoice', customerId: 'CUST-1002', customerName: 'Global Tech Solutions', date: '2026-05-03', dueDate: '2026-05-18', terms: 'NET15', amount: 8250, balance: 0, status: 'Posted', posted: true, createdDate: '2026-05-03', lines:[{item:'Subscription',qty:1,unitPrice:8250,lineTotal:8250}], applications: [] },
  { id: 'INV-1003', type: 'Invoice', customerId: 'CUST-1003', customerName: 'Midwest Distribution', date: '2026-05-04', dueDate: '2026-05-04', terms: 'DUE', amount: 4900, balance: 4900, status: 'Saved', posted: false, createdDate: '2026-05-04', lines:[{item:'Equipment',qty:1,unitPrice:4900,lineTotal:4900}], applications: [] },
  { id: 'INV-1004', type: 'Invoice', customerId: 'CUST-1004', customerName: 'Northern Supply Co', date: '2026-05-06', dueDate: '2026-06-20', terms: 'NET45', amount: 15100, balance: 0, status: 'Posted', posted: true, createdDate: '2026-05-06', lines:[{item:'Parts',qty:1,unitPrice:15100,lineTotal:15100}], applications: [] },
  { id: 'CM-1001', type: 'Credit Memo', customerId: 'CUST-1001', customerName: 'ABC Industries', amount: 1200, balance: 0, reason:'Pricing Adjustment', status: 'Posted', posted: true, createdDate: '2026-05-07' },
  { id: 'CM-1002', type: 'Credit Memo', customerId: 'CUST-1003', customerName: 'Midwest Distribution', amount: 450, balance: 450, reason:'Returned Goods', status: 'Saved', posted: false, createdDate: '2026-05-07' },
  { id: 'DM-1001', type: 'Debit Memo', customerId: 'CUST-1002', customerName: 'Global Tech Solutions', amount: 300, balance: 300, reason:'Freight Charge', status: 'Saved', posted: false, createdDate: '2026-05-08' },
  { id: 'DM-1002', type: 'Debit Memo', customerId: 'CUST-1004', customerName: 'Northern Supply Co', amount: 175, balance: 0, reason:'Late Fee', status: 'Posted', posted: true, createdDate: '2026-05-08' },
  { id: 'PAY-1001', type: 'Payment', customerId: 'CUST-1001', customerName: 'ABC Industries', method: 'ACH/Wire', amount: 5000, status: 'Posted', posted: true, createdDate: '2026-05-09', applications:[{invoiceId:'INV-1001',amount:5000}] },
  { id: 'PAY-1002', type: 'Payment', customerId: 'CUST-1002', customerName: 'Global Tech Solutions', method: 'Check', checkNumber:'CHK1002', amount: 8250, status: 'Saved', posted: false, createdDate: '2026-05-09', applications:[{invoiceId:'INV-1002',amount:8250}] },
  { id: 'PAY-1003', type: 'Payment', customerId: 'CUST-1003', customerName: 'Midwest Distribution', method: 'Credit Card', amount: 2500, status: 'Posted', posted: true, createdDate: '2026-05-09', applications:[{invoiceId:'INV-1003',amount:2500}] }
];

export const journalEntries = [];