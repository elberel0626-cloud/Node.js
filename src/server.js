import http from 'node:http';
import { parse } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { arSetup, customizations, glAccounts, invoices } from './data/seed.js';


const publicDir = path.resolve('public');

async function serveStatic(pathname, res) {
  const fileMap = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/styles.css': 'styles.css',
    '/app.js': 'app.js'
  };
  const file = fileMap[pathname];
  if (!file) return false;
  const fullPath = path.join(publicDir, file);
  const content = await readFile(fullPath);
  const contentType = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'text/html';
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(content);
  return true;
}

const glImpactMap = {
  invoice: [{ dr: '1100', cr: '4000', note: 'Debit AR, Credit Revenue' }],
  debit_memo: [{ dr: '1100', cr: '4050', note: 'Debit AR, Credit Returns and Allowances' }],
  credit_memo: [{ dr: '4050', cr: '1100', note: 'Debit Returns and Allowances, Credit AR' }]
};

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        return resolve(JSON.parse(raw));
      } catch {
        return reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function handleCreateInvoice(body, res) {
  const { docType, customerName, customerNumber, orderNumber, invoiceTotal, invoiceDate, dueDate, creditTerms, lines = [] } = body;
  if (!docType || !customerName || !invoiceDate || !invoiceTotal) {
    return sendJson(res, 400, { error: 'docType, customerName, invoiceDate, and invoiceTotal are required' });
  }
  const normalizedType = String(docType).toLowerCase();
  if (!glImpactMap[normalizedType]) {
    return sendJson(res, 400, { error: 'docType must be invoice, debit_memo, or credit_memo' });
  }

  const invoiceNumber = `AR${String(invoices.length + 1).padStart(7, '0')}`;
  const doc = {
    invoiceNumber,
    docType: normalizedType,
    customerName,
    customerNumber,
    orderNumber,
    invoiceTotal,
    invoiceDate,
    dueDate,
    creditTerms,
    lines,
    applications: [],
    discount: 0,
    status: 'Open',
    glImpact: glImpactMap[normalizedType],
    auditTrail: [{ action: 'Created', at: new Date().toISOString() }]
  };

  invoices.push(doc);
  return sendJson(res, 201, doc);
}

const server = http.createServer(async (req, res) => {
  const { pathname } = parse(req.url, true);
  const method = req.method || 'GET';

  try {
    if (method === 'GET' && (await serveStatic(pathname, res))) return;

    if (method === 'POST' && pathname === '/api/auth/login') {
      const { username, password } = await readBody(req);
      if (username === 'admin' && password === 'admin') return sendJson(res, 200, { ok: true, user: { name: 'Admin' } });
      return sendJson(res, 401, { error: 'Invalid credentials. Use admin/admin for demo.' });
    }

    if (method === 'GET' && pathname === '/api/erp/modules') {
      return sendJson(res, 200, ['Finance', 'Banking', 'AP', 'AR', 'Sales Order', 'Purchase Order', 'Inventory', 'Manufacturing']);
    }

    if (method === 'GET' && pathname === '/api/gl/accounts') return sendJson(res, 200, glAccounts);
    if (method === 'GET' && pathname === '/api/ar/setup') return sendJson(res, 200, arSetup);
    if (method === 'GET' && pathname === '/api/admin/customize') return sendJson(res, 200, customizations);

    if (method === 'POST' && pathname === '/api/admin/customize') {
      const body = await readBody(req);
      const { target, key, value } = body;
      if (!target || !key) return sendJson(res, 400, { error: 'target and key are required' });
      if (!customizations[target]) customizations[target] = {};
      customizations[target][key] = value;
      return sendJson(res, 200, { message: 'Customization saved', customizations });
    }

    if (method === 'GET' && pathname === '/api/ar/invoices-memos') {
      const sorted = [...invoices].sort((a, b) => new Date(b.invoiceDate) - new Date(a.invoiceDate));
      return sendJson(res, 200, sorted);
    }

    if (method === 'POST' && pathname === '/api/ar/invoices-memos') {
      const body = await readBody(req);
      return handleCreateInvoice(body, res);
    }

    const invoiceMatch = pathname.match(/^\/api\/ar\/invoices-memos\/([^/]+)$/);
    if (method === 'GET' && invoiceMatch) {
      const doc = invoices.find((x) => x.invoiceNumber === decodeURIComponent(invoiceMatch[1]));
      if (!doc) return sendJson(res, 404, { error: 'Invoice not found' });
      return sendJson(res, 200, doc);
    }

    const appMatch = pathname.match(/^\/api\/ar\/invoices-memos\/([^/]+)\/applications$/);
    if (method === 'POST' && appMatch) {
      const invoiceNumber = decodeURIComponent(appMatch[1]);
      const doc = invoices.find((x) => x.invoiceNumber === invoiceNumber);
      if (!doc) return sendJson(res, 404, { error: 'Invoice not found' });
      const { applyType, referenceNumber, amount, discount = 0 } = await readBody(req);
      if (!applyType || !referenceNumber || !amount) {
        return sendJson(res, 400, { error: 'applyType, referenceNumber, and amount are required' });
      }
      doc.applications.push({ applyType, referenceNumber, amount, discount, at: new Date().toISOString() });
      doc.auditTrail.push({ action: `Application added (${applyType})`, at: new Date().toISOString() });
      return sendJson(res, 200, doc);
    }

    return sendJson(res, 404, { error: 'Route not found' });
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`ERP skeleton listening on port ${port}`);
});
