import http from 'node:http';
import { parse } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { arSetup, closedPeriods, creditTerms, customers, glAccounts, invoices, journalEntries, payments } from './data/seed.js';

const publicDir = path.resolve('public');
const modules = ['Finance', 'Banking', 'AP', 'AR', 'Sales Order', 'Inventory', 'Purchase Order'];
const json = (res, c, d) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
const acct = (code) => glAccounts.find((a) => a.code === code);
const addDays = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
const termDays = (code) => creditTerms.find((t) => t.code === code)?.days ?? 30;

function postJE(source, lines) {
  const debit = lines.reduce((s, l) => s + l.drAmount, 0), credit = lines.reduce((s, l) => s + l.crAmount, 0);
  if (debit !== credit) throw new Error('Unbalanced journal');
  lines.forEach((l) => { const a = acct(l.account); if (!a) return; if (l.drAmount) a.balance += (a.normal === 'Debit' ? l.drAmount : -l.drAmount); if (l.crAmount) a.balance += (a.normal === 'Credit' ? l.crAmount : -l.crAmount); });
  journalEntries.push({ id: `JE${String(journalEntries.length + 1).padStart(6, '0')}`, source, at: new Date().toISOString(), lines, debit, credit });
}
const readBody = (req) => new Promise((resolve, reject) => { let raw=''; req.on('data', c => raw += c); req.on('end', () => { try{ resolve(raw?JSON.parse(raw):{});}catch{reject(new Error('Invalid JSON'));}}); req.on('error', reject); });
async function serveStatic(p, res){ const m={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/app.js':'app.js'}; if(!m[p]) return false; const c=await readFile(path.join(publicDir,m[p])); res.writeHead(200, {'Content-Type': p.endsWith('.css')?'text/css':p.endsWith('.js')?'application/javascript':'text/html'}); res.end(c); return true; }

const server = http.createServer(async (req,res)=>{
  const { pathname, query } = parse(req.url,true); const method=req.method||'GET';
  try {
    if (method==='GET' && await serveStatic(pathname,res)) return;
    if (method==='POST' && pathname==='/api/auth/login') { const b=await readBody(req); return b.username==='admin'&&b.password==='admin'?json(res,200,{ok:true}):json(res,401,{error:'Invalid credentials'}); }
    if (method==='GET' && pathname==='/api/erp/modules') return json(res,200,modules);
    if (method==='GET' && pathname==='/api/ar/setup') return json(res,200,arSetup);
    if (method==='GET' && pathname==='/api/ar/customers') return json(res,200,customers);
    if (method==='POST' && pathname==='/api/ar/customers') { const b=await readBody(req); const c={ customerNumber:`C${String(customers.length+1).padStart(4,'0')}`,...b }; customers.push(c); return json(res,201,c); }
    if (method==='GET' && pathname==='/api/ar/credit-terms') return json(res,200,creditTerms);
    if (method==='GET' && pathname==='/api/ar/invoices-memos') return json(res,200,[...invoices].sort((a,b)=>new Date(b.invoiceDate)-new Date(a.invoiceDate)));
    if (method==='POST' && pathname==='/api/ar/invoices-memos') {
      const b=await readBody(req); const customer = customers.find(c=>c.customerNumber===b.customerNumber);
      if (!customer) return json(res,400,{error:'Customer not found'});
      if (customer.status==='On Hold') return json(res,400,{error:'Customer is on credit hold'});
      const openBal = invoices.filter(i=>i.customerNumber===customer.customerNumber).reduce((s,i)=>s+i.balance,0);
      if (openBal + Number(b.totalAmount||0) > customer.creditLimit) return json(res,400,{error:'Credit limit exceeded'});
      const date = b.invoiceDate || new Date().toISOString().slice(0,10); const terms = b.terms || customer.creditTerms;
      const inv = { invoiceNumber:`AR${String(invoices.length+1).padStart(7,'0')}`, status:'Open', released:false, docType:b.docType||'invoice', customerNumber:customer.customerNumber, customerName:customer.name, location:b.location||'MAIN', currency:b.currency||'USD', invoiceDate:date, dueDate:addDays(date,termDays(terms)), terms, subtotal:Number(b.subtotal||0), tax:Number(b.tax||0), totalAmount:Number(b.totalAmount||0), amountPaid:0, balance:Number(b.totalAmount||0), lineItems:b.lineItems||[], applications:[] };
      invoices.push(inv); return json(res,201,inv);
    }
    if (method==='POST' && pathname==='/api/ar/release') { const { refNbr,type }=await readBody(req); if(type==='invoice'){ const i=invoices.find(x=>x.invoiceNumber===refNbr); if(!i) return json(res,404,{error:'Invoice not found'}); if(i.released) return json(res,200,i); postJE(i.invoiceNumber,[{account:'1100',drAmount:i.totalAmount,crAmount:0},{account:'4000',drAmount:0,crAmount:i.subtotal},{account:'4000',drAmount:0,crAmount:i.tax}]); i.released=true; return json(res,200,i);} if(type==='payment'){ const p=payments.find(x=>x.paymentRef===refNbr); if(!p) return json(res,404,{error:'Payment not found'}); if(p.released) return json(res,200,p); postJE(p.paymentRef,[{account:'1000',drAmount:p.amount,crAmount:0},{account:'1100',drAmount:0,crAmount:p.amount}]); p.released=true; return json(res,200,p);} }
    if (method==='GET' && pathname==='/api/ar/payments') return json(res,200,payments);
    if (method==='POST' && pathname==='/api/ar/payments') { const b=await readBody(req); const p={ paymentRef:`PMT${String(payments.length+1).padStart(6,'0')}`, customerNumber:b.customerNumber, amount:Number(b.amount), date:b.date||new Date().toISOString().slice(0,10), released:false, applications:[] }; for(const a of (b.applications||[])){ const i=invoices.find(x=>x.invoiceNumber===a.invoiceNumber); if(!i) continue; const apply=Math.min(Number(a.amount),i.balance); i.amountPaid += apply; i.balance -= apply; i.status = i.balance===0?'Closed':'Partially Paid'; i.applications.push({ paymentRef:p.paymentRef, amount:apply, date:p.date }); p.applications.push({ invoiceNumber:i.invoiceNumber, amount:apply }); } payments.push(p); return json(res,201,p); }
    if (method==='POST' && pathname==='/api/ar/writeoff') { const b=await readBody(req); const i=invoices.find(x=>x.invoiceNumber===b.invoiceNumber); if(!i) return json(res,404,{error:'Invoice not found'}); const amt=Math.min(Number(b.amount),i.balance); i.balance-=amt; i.status=i.balance===0?'Closed':'Partially Paid'; return json(res,200,i); }
    if (method==='GET' && pathname==='/api/ar/reports/aging') { const today=new Date(); const rows=invoices.map(i=>{const d=Math.floor((today-new Date(i.dueDate))/86400000); return {invoiceNumber:i.invoiceNumber,customer:i.customerName,balance:i.balance,bucket:d<=0?'Current':d<=30?'1-30':d<=60?'31-60':'60+'};}); return json(res,200,rows);}
    if (method==='GET' && pathname==='/api/ar/reports/balance-by-customer') { const map={}; invoices.forEach(i=>map[i.customerName]=(map[i.customerName]||0)+i.balance); return json(res,200,Object.entries(map).map(([customer,balance])=>({customer,balance}))); }
    if (method==='GET' && pathname==='/api/ar/reports/transactions') { const from=query.from?new Date(query.from):new Date('1900-01-01'); const to=query.to?new Date(query.to):new Date('2999-12-31'); return json(res,200,invoices.filter(i=>new Date(i.invoiceDate)>=from&&new Date(i.invoiceDate)<=to)); }
    if (method==='GET' && pathname==='/api/ar/reports/cash-receipts') return json(res,200,payments.map(p=>({paymentRef:p.paymentRef,date:p.date,amount:p.amount})));
    if (method==='GET' && pathname==='/api/gl/accounts') return json(res,200,glAccounts);
    if (method==='GET' && pathname==='/api/gl/journal-entries') return json(res,200,journalEntries);
    if (method==='POST' && pathname==='/api/ar/close-period') { const b=await readBody(req); const unreleased=[...invoices.filter(i=>!i.released),...payments.filter(p=>!p.released)]; if(unreleased.length) return json(res,400,{error:'Release all AR docs first',unreleased}); closedPeriods.push(b.period); return json(res,200,{closedPeriods}); }
    return json(res,404,{error:'Route not found'});
  } catch(e){ return json(res,400,{error:e.message}); }
});
server.listen(process.env.PORT||3000);
