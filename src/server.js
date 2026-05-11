import http from 'node:http';
import { parse } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { arDocuments, creditTerms, customers, glAccounts, journalEntries } from './data/seed.js';

const publicDir = path.resolve('public');
const json=(res,c,d)=>{res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(d));};
const body=(req)=>new Promise((resolve,reject)=>{let r='';req.on('data',c=>r+=c);req.on('end',()=>{try{resolve(r?JSON.parse(r):{});}catch{reject(new Error('Invalid JSON'));}});req.on('error',reject);});
const acct=(code)=>glAccounts.find(a=>a.code===code); const bump=(code,side,amt)=>{const a=acct(code);if(!a)return;a.balance+=(a.normal===side?amt:-amt)};
const nextId=(prefix)=>`${prefix}-${String(arDocuments.filter(d=>d.id.startsWith(prefix+'-')).length+1001).padStart(4,'0')}`;
function postJE(doc,reverse=false){
  const amt=Number(doc.amount||0); let lines=[];
  if(doc.type==='Invoice') lines=[{a:'1100',dr:amt,cr:0},{a:'4000',dr:0,cr:amt}];
  if(doc.type==='Debit Memo') lines=[{a:'1100',dr:amt,cr:0},{a:'4050',dr:0,cr:amt}];
  if(doc.type==='Credit Memo') lines=[{a:'1100',dr:0,cr:amt},{a:'4050',dr:amt,cr:0}];
  if(doc.type==='Payment') lines=[{a:'1000',dr:amt,cr:0},{a:'1100',dr:0,cr:amt}];
  if(reverse) lines=lines.map(l=>({a:l.a,dr:l.cr,cr:l.dr}));
  lines.forEach(l=>{if(l.dr)bump(l.a,'Debit',l.dr);if(l.cr)bump(l.a,'Credit',l.cr);});
  journalEntries.push({id:`JE${String(journalEntries.length+1).padStart(6,'0')}`,docId:doc.id,type:doc.type,reversing:reverse,entries:lines.map(l=>({account:l.a,debit:l.dr,credit:l.cr}))});
}
async function serve(p,res){ if(p==='/app.js'||p==='/styles.css'){const c=await readFile(path.join(publicDir,p.slice(1)));res.writeHead(200,{'Content-Type':p.endsWith('.css')?'text/css':'application/javascript'});res.end(c);return true;} if(!p.startsWith('/api')){const c=await readFile(path.join(publicDir,'index.html'));res.writeHead(200,{'Content-Type':'text/html'});res.end(c);return true;} return false; }

const server=http.createServer(async(req,res)=>{const {pathname,query}=parse(req.url,true); const method=req.method||'GET'; try{
 if(method==='GET'&&await serve(pathname,res)) return;
 if(method==='POST'&&pathname==='/api/auth/login'){const b=await body(req); return b.username==='admin'&&b.password==='admin'?json(res,200,{ok:true}):json(res,401,{error:'Invalid'});}
 if(method==='GET'&&pathname==='/api/ar/customers') return json(res,200,customers);
 if(method==='GET'&&pathname==='/api/ar/credit-terms') return json(res,200,creditTerms);
 if(method==='GET'&&pathname==='/api/ar/documents'){ let data=[...arDocuments]; if(query.type)data=data.filter(d=>d.type===query.type); if(query.customerId)data=data.filter(d=>d.customerId===query.customerId); if(query.status)data=data.filter(d=>d.status===query.status); return json(res,200,data); }
 if(method==='GET'&&pathname.startsWith('/api/ar/documents/')){const id=pathname.split('/').pop(); const d=arDocuments.find(x=>x.id===id); return d?json(res,200,d):json(res,404,{error:'Not found'});}
 if(method==='POST'&&pathname==='/api/ar/documents'){ const b=await body(req); if(!b.customerId) return json(res,400,{error:'Customer required'}); const customer=customers.find(c=>c.id===b.customerId); if(!customer) return json(res,400,{error:'Invalid customer'}); if(customer.status==='On Hold') return json(res,400,{error:'Customer on credit hold'}); if(Number(b.amount)<=0) return json(res,400,{error:'Positive amount only'});
 const prefix=b.type==='Payment'?'PAY':b.type==='Credit Memo'?'CM':b.type==='Debit Memo'?'DM':'INV'; const doc={id:nextId(prefix),type:b.type||'Invoice',customerId:customer.id,customerName:customer.name,date:b.date||new Date().toISOString().slice(0,10),dueDate:b.dueDate,terms:b.terms||customer.terms,status:'Saved',posted:false,createdDate:new Date().toISOString().slice(0,10),amount:Number(b.amount),balance:Number(b.amount),lines:b.lines||[],applications:b.applications||[],method:b.method,checkNumber:b.checkNumber}; if(doc.type==='Payment'){ if(!doc.date) return json(res,400,{error:'Payment date required'}); if(!doc.method) return json(res,400,{error:'Payment method required'}); if(doc.method==='Check'&&!doc.checkNumber) return json(res,400,{error:'Check number required'}); const totalApplied=(doc.applications||[]).reduce((s,a)=>s+Number(a.amount||0),0); if(totalApplied!==doc.amount) return json(res,400,{error:'Total applied must equal payment amount'}); for(const app of doc.applications){const inv=arDocuments.find(d=>d.id===app.invoiceId&&d.type==='Invoice'); if(!inv) return json(res,400,{error:'Invalid invoice application'}); if(Number(app.amount)>inv.balance) return json(res,400,{error:'Applied payment cannot exceed invoice balance'});} }
 arDocuments.push(doc); return json(res,201,doc);} 
 if(method==='PUT'&&pathname.startsWith('/api/ar/documents/')){ const id=pathname.split('/').pop(); const d=arDocuments.find(x=>x.id===id); if(!d)return json(res,404,{error:'Not found'}); if(d.status==='Posted') return json(res,400,{error:'Cannot edit posted docs'}); Object.assign(d,await body(req)); return json(res,200,d);}
 if(method==='DELETE'&&pathname.startsWith('/api/ar/documents/')){ const id=pathname.split('/').pop(); const idx=arDocuments.findIndex(x=>x.id===id); if(idx<0)return json(res,404,{error:'Not found'}); if(arDocuments[idx].status==='Posted') return json(res,400,{error:'Cannot delete posted'}); arDocuments.splice(idx,1); return json(res,200,{ok:true}); }
 if(method==='POST'&&pathname==='/api/ar/documents/post'){ const {id}=await body(req); const d=arDocuments.find(x=>x.id===id); if(!d)return json(res,404,{error:'Not found'}); if(d.status==='Voided') return json(res,400,{error:'Voided doc'}); if(d.status!=='Posted'){ d.status='Posted'; d.posted=true; postJE(d,false); if(d.type==='Payment'){ for(const a of d.applications){const inv=arDocuments.find(x=>x.id===a.invoiceId); inv.balance-=Number(a.amount); inv.status=inv.balance===0?'Posted':'Saved'; } } } return json(res,200,d); }
 if(method==='POST'&&pathname==='/api/ar/documents/void'){ const {id}=await body(req); const d=arDocuments.find(x=>x.id===id); if(!d)return json(res,404,{error:'Not found'}); if(d.status!=='Posted') return json(res,400,{error:'Only posted docs can be voided'}); d.status='Voided'; postJE(d,true); return json(res,200,d); }
 if(method==='POST'&&pathname==='/api/ar/release/post-selected'){ const b=await body(req); const ids=b.ids||[]; const updated=[]; for(const id of ids){ const d=arDocuments.find(x=>x.id===id); if(d&&d.status==='Saved'){ d.status='Posted'; d.posted=true; postJE(d,false); updated.push(d);} } return json(res,200,{posted:updated.length,documents:updated}); }
 if(method==='GET'&&pathname==='/api/gl/journal-entries') return json(res,200,journalEntries);
 return json(res,404,{error:'Not found'});
 }catch(e){return json(res,400,{error:e.message});}});
import { creditTerms, customers, glAccounts, invoices, journalEntries, payments } from './data/seed.js';

const publicDir = path.resolve('public');
const json = (res, c, d) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
const body = (req) => new Promise((resolve, reject) => { let raw=''; req.on('data', c => raw += c); req.on('end', ()=>{ try{ resolve(raw?JSON.parse(raw):{});}catch{ reject(new Error('Invalid JSON')); } }); req.on('error', reject); });
const findAcct = (code) => glAccounts.find((a) => a.code === code);
const bump = (code, side, amount) => { const a=findAcct(code); if(!a) return; a.balance += (a.normal===side?amount:-amount); };
const addDays = (d, days) => { const x = new Date(d); x.setDate(x.getDate()+days); return x.toISOString().slice(0,10); };

function postEntry(source, lines){ const dr=lines.reduce((s,l)=>s+l.dr,0), cr=lines.reduce((s,l)=>s+l.cr,0); if(dr!==cr) throw new Error('Unbalanced JE'); lines.forEach(l=>{ if(l.dr) bump(l.acct,'Debit',l.dr); if(l.cr) bump(l.acct,'Credit',l.cr); }); journalEntries.push({ id:`JE${String(journalEntries.length+1).padStart(6,'0')}`, source, lines, dr, cr, at:new Date().toISOString()}); }

async function serve(reqPath, res){
  const fileMap = {'/styles.css':'styles.css','/app.js':'app.js'};
  if (fileMap[reqPath]) { const content=await readFile(path.join(publicDir,fileMap[reqPath])); res.writeHead(200,{'Content-Type':reqPath.endsWith('.css')?'text/css':'application/javascript'}); res.end(content); return true; }
  if (!reqPath.startsWith('/api')) { const html = await readFile(path.join(publicDir,'index.html')); res.writeHead(200,{'Content-Type':'text/html'}); res.end(html); return true; }
  return false;
}

const server=http.createServer(async (req,res)=>{
  const { pathname } = parse(req.url,true); const method=req.method||'GET';
  try {
    if (method==='GET' && await serve(pathname,res)) return;
    if (method==='POST' && pathname==='/api/auth/login') { const b=await body(req); return b.username==='admin'&&b.password==='admin'?json(res,200,{ok:true}):json(res,401,{error:'Invalid'}); }
    if (method==='GET' && pathname==='/api/ar/credit-terms') return json(res,200,creditTerms);
    if (method==='GET' && pathname==='/api/ar/customers') return json(res,200,customers);
    if (method==='POST' && pathname==='/api/ar/customers') { const b=await body(req); if(!b.name) return json(res,400,{error:'Name required'}); const c={id:`CUS${String(customers.length+1).padStart(3,'0')}`,name:b.name,email:b.email||'',creditLimit:Number(b.creditLimit||0),terms:b.terms||'NET30',status:b.status||'Active'}; customers.push(c); return json(res,201,c); }
    if (method==='GET' && pathname==='/api/ar/invoices') return json(res,200,invoices);
    if (method==='POST' && pathname==='/api/ar/invoices') {
      const b=await body(req); if(!b.customerId||!Array.isArray(b.lines)||!b.lines.length) return json(res,400,{error:'customerId and lines required'});
      const customer=customers.find(c=>c.id===b.customerId); if(!customer) return json(res,400,{error:'Invalid customerId'});
      const total=b.lines.reduce((s,l)=>s+(Number(l.qty)*Number(l.unitPrice)),0);
      const date=b.date||new Date().toISOString().slice(0,10); const terms=b.terms||customer.terms; const days=creditTerms.find(t=>t.id===terms)?.days||30;
      const inv={id:`INV${String(invoices.length+1).padStart(5,'0')}`,customerId:customer.id,customerName:customer.name,docType:b.docType||'invoice',date,dueDate:b.dueDate||addDays(date,days),terms,status:'Open',lines:b.lines.map((l,i)=>({id:i+1,item:l.item,description:l.description||'',qty:Number(l.qty),unitPrice:Number(l.unitPrice),lineTotal:Number(l.qty)*Number(l.unitPrice)})),total,balance:total,released:false};
      invoices.push(inv); return json(res,201,inv);
    }
    if (method==='POST' && pathname==='/api/ar/invoices/release') { const b=await body(req); const inv=invoices.find(i=>i.id===b.invoiceId); if(!inv) return json(res,404,{error:'Invoice not found'}); if(!inv.released){ const t=inv.docType; const lines=t==='credit_memo'?[{acct:'1100',dr:0,cr:inv.total},{acct:'4000',dr:inv.total,cr:0}]:[{acct:'1100',dr:inv.total,cr:0},{acct:'4000',dr:0,cr:inv.total}]; postEntry(inv.id,lines); inv.released=true; } return json(res,200,inv); }
    if (method==='GET' && pathname==='/api/ar/payments') return json(res,200,payments);
    if (method==='POST' && pathname==='/api/ar/payments') { const b=await body(req); const inv=invoices.find(i=>i.id===b.invoiceId); if(!inv) return json(res,400,{error:'Invalid invoiceId'}); const customer=customers.find(c=>c.id===b.customerId); if(!customer) return json(res,400,{error:'Invalid customerId'}); const amount=Math.min(Number(b.amount||0),inv.balance); if(amount<=0) return json(res,400,{error:'Amount must be > 0'}); const p={id:`PAY${String(payments.length+1).padStart(5,'0')}`,customerId:customer.id,invoiceId:inv.id,amount,date:b.date||new Date().toISOString().slice(0,10)}; payments.push(p); inv.balance-=amount; inv.status=inv.balance===0?'Closed':'Partially Paid'; postEntry(p.id,[{acct:'1000',dr:amount,cr:0},{acct:'1100',dr:0,cr:amount}]); return json(res,201,p); }
    if (method==='GET' && pathname==='/api/ar/reports/aging') { const now=new Date(); return json(res,200,invoices.map(i=>{const d=Math.floor((now-new Date(i.dueDate))/86400000); return {...i,bucket:d<=0?'Current':d<=30?'1-30':d<=60?'31-60':'60+'};})); }
    if (method==='GET' && pathname==='/api/ar/reports/balance-by-customer') { const m={}; invoices.forEach(i=>m[i.customerName]=(m[i.customerName]||0)+i.balance); return json(res,200,Object.entries(m).map(([customer,balance])=>({customer,balance}))); }
    if (method==='GET' && pathname==='/api/ar/reports/transactions') return json(res,200,invoices);
    if (method==='GET' && pathname==='/api/ar/reports/cash-receipts') return json(res,200,payments);
    if (method==='GET' && pathname==='/api/gl/journal-entries') return json(res,200,journalEntries);
    return json(res,404,{error:'Not found'});
  } catch(e){ return json(res,400,{error:e.message}); }
});
server.listen(process.env.PORT||3000);
