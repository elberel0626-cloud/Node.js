if (req.method === 'GET' && url.pathname === '/') {
  return json(res, 200, {
    message: 'ERP AR system is running 🚀',
    status: 'OK',
    version: '1.0'
  });
}

if (req.method === 'GET' && url.pathname === '/health') {
  return json(res, 200, { status: 'healthy' });
}
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const db = {
  glAccounts: [
    { code: '1000', name: 'Cash', type: 'Asset' },
    { code: '1100', name: 'Accounts Receivable', type: 'Asset', subledger: 'AR' },
    { code: '1200', name: 'Inventory', type: 'Asset', subledger: 'IN' },
    { code: '2000', name: 'Accounts Payable', type: 'Liability', subledger: 'AP' },
    { code: '3000', name: 'Retained Earnings', type: 'Equity' },
    { code: '4000', name: 'Sales Revenue', type: 'Revenue' },
    { code: '4050', name: 'Sales Returns and Allowances', type: 'Contra Revenue' },
    { code: '5000', name: 'Cost of Goods Sold', type: 'Expense' }
  ],
  ar: {
    customers: [],
    creditTerms: [
      { id: 'NET30', description: 'Net 30 Days', days: 30 },
      { id: 'NET15', description: 'Net 15 Days', days: 15 }
    ],
    documents: [],
    payments: [],
    glEntries: []
  },
  configuration: {
    ui: {},
    workflows: {},
    accounting: { baseCurrency: 'USD', fiscalCalendar: 'Monthly' }
  }
};

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function postGLForAR(doc) {
  const map = {
    Invoice: [
      { account: '1100', side: 'Debit', amount: doc.total },
      { account: '4000', side: 'Credit', amount: doc.total }
    ],
    DebitMemo: [
      { account: '1100', side: 'Debit', amount: doc.total },
      { account: '4050', side: 'Credit', amount: doc.total }
    ],
    CreditMemo: [
      { account: '1100', side: 'Credit', amount: doc.total },
      { account: '4050', side: 'Debit', amount: doc.total }
    ]
  };

  const lines = map[doc.type];
  if (!lines) throw new Error(`Unknown AR type: ${doc.type}`);

  db.ar.glEntries.push({
    id: randomUUID(),
    source: 'AR',
    documentId: doc.id,
    documentNo: doc.number,
    postedAt: new Date().toISOString(),
    lines
  });
}

function seed() {
  if (db.ar.customers.length) return;
  const c = { id: randomUUID(), customerNumber: 'C0001', name: 'ABC Studios Inc', termId: 'NET30', creditHold: false };
  db.ar.customers.push(c);
  const invoice = {
    id: randomUUID(),
    number: 'AR010304',
    orderNumber: 'SO1001',
    customerId: c.id,
    type: 'Invoice',
    total: 125000,
    invoiceDate: '2021-10-05',
    dueDate: '2021-11-04',
    termId: 'NET30',
    status: 'Open',
    applications: [{ reference: 'PMT003760', appliedAmount: 25000 }]
  };
  db.ar.documents.push(invoice);
}
seed();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/api/gl-accounts') {
    return json(res, 200, db.glAccounts);
  }

  if (req.method === 'GET' && url.pathname === '/api/modules') {
    return json(res, 200, {
      modules: ['Finance', 'Banking', 'AP', 'AR', 'SalesOrder', 'PurchaseOrder', 'Inventory', 'Manufacturing']
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/ar/dashboard') {
    return json(res, 200, {
      quickActions: ['New Invoice', 'New Payment', 'New Customer'],
      transactions: ['InvoicesAndMemos', 'PaymentsAndApplications'],
      profiles: ['Customers', 'CreditTerms'],
      processes: ['ReleaseARDocuments', 'PrintInvoiceAndMemos', 'WriteOffBalanceAndCredits', 'PrepareClientStatement', 'CloseFinancialPeriods', 'ManageCreditHolds'],
      reports: ['ARAgingReport', 'ARBalanceByCustomer', 'ARDetailedTransactionsByPeriod', 'ARCashReceiptsByPeriod']
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/ar/invoices') {
    const customerById = Object.fromEntries(db.ar.customers.map((c) => [c.id, c]));
    const result = db.ar.documents
      .slice()
      .sort((a, b) => (a.invoiceDate < b.invoiceDate ? 1 : -1))
      .map((d) => ({
        customerName: customerById[d.customerId]?.name,
        customerNumber: customerById[d.customerId]?.customerNumber,
        invoiceNumber: d.number,
        orderNumber: d.orderNumber,
        invoiceTotal: d.total,
        invoiceDate: d.invoiceDate,
        dueDate: d.dueDate,
        creditTerms: d.termId,
        type: d.type,
        status: d.status
      }));
    return json(res, 200, result);
  }

  if (req.method === 'POST' && url.pathname === '/api/ar/customers') {
    const body = await parseBody(req);
    const customer = {
      id: randomUUID(),
      customerNumber: body.customerNumber,
      name: body.name,
      termId: body.termId ?? 'NET30',
      creditHold: false
    };
    db.ar.customers.push(customer);
    return json(res, 201, customer);
  }

  if (req.method === 'POST' && url.pathname === '/api/ar/invoices') {
    const body = await parseBody(req);
    const doc = {
      id: randomUUID(),
      number: body.number,
      orderNumber: body.orderNumber,
      customerId: body.customerId,
      type: body.type,
      total: body.total,
      invoiceDate: body.invoiceDate,
      dueDate: body.dueDate,
      termId: body.termId ?? 'NET30',
      status: 'Open',
      applications: body.applications ?? []
    };

    db.ar.documents.push(doc);
    postGLForAR(doc);
    return json(res, 201, doc);
  }

  if (req.method === 'GET' && url.pathname === '/api/ar/gl-impact') {
    return json(res, 200, db.ar.glEntries);
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/admin/config/')) {
    const key = url.pathname.split('/').pop();
    const body = await parseBody(req);
    db.configuration[key] = { ...db.configuration[key], ...body };
    return json(res, 200, db.configuration[key]);
  }

  return json(res, 404, { error: 'Not found' });
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`ERP skeleton listening on :${port}`);
  });
}

export { server, db, postGLForAR };
