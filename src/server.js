import http from 'node:http';
import { parse } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { arSetup, customizations, customers, glAccounts, invoices, journalEntries } from './data/seed.js';

const publicDir = path.resolve('public');
const modules = ['Finance', 'Banking', 'AP', 'AR', 'Sales Order', 'Inventory', 'Purchase Order'];

const glImpactMap = {
  invoice: [{ dr: '1100', cr: '4000', note: 'Debit AR, Credit Revenue' }],
  debit_memo: [{ dr: '1100', cr: '4050', note: 'Debit AR, Credit Returns and Allowances' }],
  credit_memo: [{ dr: '4050', cr: '1100', note: 'Debit Returns and Allowances, Credit AR' }]
};

function sendJson(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
const account = (code) => glAccounts.find((a) => a.code === code);
const bump = (code, side, amount) => {
  const a = account(code); if (!a) return;
  a.balance += (a.normal === side ? amount : -amount);
};

function postJournal(source, lines) {
  const debit = lines.reduce((s, l) => s + (l.drAmount || 0), 0);
  const credit = lines.reduce((s, l) => s + (l.crAmount || 0), 0);
  if (debit !== credit) throw new Error('Journal is out of balance');
  lines.forEach((l) => { if (l.drAmount) bump(l.account, 'Debit', l.drAmount); if (l.crAmount) bump(l.account, 'Credit', l.crAmount); });
  journalEntries.push({ id: `JE${String(journalEntries.length + 1).padStart(6, '0')}`, source, at: new Date().toISOString(), lines, debit, credit });
}

async function readBody(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', (c) => raw += c); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } }); req.on('error', reject); }); }
async function serveStatic(pathname, res) { const m = { '/': 'index.html', '/index.html': 'index.html', '/styles.css': 'styles.css', '/app.js': 'app.js' }; if (!m[pathname]) return false; const c = await readFile(path.join(publicDir, m[pathname])); send(res, pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.js') ? 'application/javascript' : 'text/html', c, res); return true; }
function send(type, contentType, data, res) { res.writeHead(200, { 'Content-Type': contentType }); res.end(data); }

const server = http.createServer(async (req, res) => {
  const { pathname } = parse(req.url, true); const method = req.method || 'GET';
  try {
    if (method === 'GET' && await serveStatic(pathname, res)) return;
    if (method === 'POST' && pathname === '/api/auth/login') { const { username, password } = await readBody(req); return username === 'admin' && password === 'admin' ? sendJson(res, 200, { ok: true }) : sendJson(res, 401, { error: 'Invalid credentials' }); }
    if (method === 'GET' && pathname === '/api/erp/modules') return sendJson(res, 200, modules);
    if (method === 'GET' && pathname === '/api/ar/setup') return sendJson(res, 200, arSetup);
    if (method === 'GET' && pathname === '/api/ar/customers') return sendJson(res, 200, customers);
    if (method === 'GET' && pathname === '/api/gl/accounts') return sendJson(res, 200, glAccounts);
    if (method === 'GET' && pathname === '/api/gl/journal-entries') return sendJson(res, 200, journalEntries);
    if (method === 'GET' && pathname === '/api/admin/customize') return sendJson(res, 200, customizations);

    if (method === 'POST' && pathname === '/api/ar/invoices-memos') {
      const body = await readBody(req); const { docType = 'invoice', customerName, customerNumber, invoiceTotal, invoiceDate, dueDate, creditTerms } = body;
      if (!customerName || !invoiceTotal || !invoiceDate) return sendJson(res, 400, { error: 'customerName, invoiceTotal, invoiceDate required' });
      if (!glImpactMap[docType]) return sendJson(res, 400, { error: 'Invalid docType' });
      const invoiceNumber = `AR${String(invoices.length + 1).padStart(7, '0')}`;
      const inv = { invoiceNumber, docType, customerName, customerNumber, invoiceTotal, invoiceDate, dueDate, creditTerms, status: 'Open', applications: [], auditTrail: [{ action: 'Created', at: new Date().toISOString() }] };
      invoices.push(inv);
      const impact = glImpactMap[docType][0];
      postJournal(invoiceNumber, [
        { account: impact.dr, drAmount: Number(invoiceTotal), crAmount: 0 },
        { account: impact.cr, drAmount: 0, crAmount: Number(invoiceTotal) }
      ]);
      return sendJson(res, 201, inv);
    }

    if (method === 'GET' && pathname === '/api/ar/invoices-memos') return sendJson(res, 200, [...invoices].sort((a, b) => new Date(b.invoiceDate) - new Date(a.invoiceDate)));
    return sendJson(res, 404, { error: 'Route not found' });
  } catch (e) { return sendJson(res, 400, { error: e.message }); }
});

server.listen(process.env.PORT || 3000);
