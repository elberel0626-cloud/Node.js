const $ = (s) => document.querySelector(s);
const views = [...document.querySelectorAll('.view')];
const setView = (id) => views.forEach((v) => v.classList.toggle('hidden', v.id !== id));
const api = async (p,o={}) => { const r=await fetch(p,{headers:{'Content-Type':'application/json'},...o}); const b=await r.json(); if(!r.ok) throw new Error(b.error||'Failed'); return b; };

function setActionsVisible(show){ ['#new-invoice','#new-payment','#new-customer'].forEach(id=>$(id).style.display=show?'inline-block':'none'); }

function renderARGroups(groups){ $('#ar-groups').innerHTML=Object.entries(groups).map(([k,v])=>`<article class='metric'><h3>${k}</h3><ul>${v.map(x=>`<li><button class='link-btn' data-action='${x}'>${x}</button></li>`).join('')}</ul></article>`).join('');
  [...document.querySelectorAll('[data-action]')].forEach(b=>b.onclick=()=>openARPage(b.dataset.action)); }

function openARPage(action){ $('#view-title').textContent=action; setView('ar-data'); }

async function refreshData(){
  const [modules,setup,customers,invoices,payments,terms,gl,aging,bal] = await Promise.all([
    api('/api/erp/modules'),api('/api/ar/setup'),api('/api/ar/customers'),api('/api/ar/invoices-memos'),api('/api/ar/payments'),api('/api/ar/credit-terms'),api('/api/gl/accounts'),api('/api/ar/reports/aging'),api('/api/ar/reports/balance-by-customer')
  ]);
  $('#module-nav').innerHTML = modules.map(m=>`<button data-module='${m}'>${m}</button>`).join('');
  [...document.querySelectorAll('#module-nav button')].forEach(b=>b.onclick=()=>{ if(b.dataset.module==='AR'){ setActionsVisible(true); setView('ar-home'); $('#view-title').textContent='Accounts Receivable'; } else { setActionsVisible(false); setView('dashboard'); $('#view-title').textContent=`${b.dataset.module} (Coming Soon)`; }});
  renderARGroups(setup.groups);
  $('#customer-table').innerHTML = customers.map(c=>`<tr><td>${c.customerNumber}</td><td>${c.name}</td><td>${c.creditTerms}</td><td>${c.status}</td><td>${c.creditLimit}</td></tr>`).join('');
  $('#invoice-table').innerHTML = invoices.map(i=>`<tr><td>${i.invoiceNumber}</td><td>${i.customerName}</td><td>${i.totalAmount}</td><td>${i.invoiceDate}</td><td>${i.balance}</td><td>${i.status}${i.released?' / Released':''}</td></tr>`).join('');
  $('#payment-table').innerHTML = payments.map(p=>`<tr><td>${p.paymentRef}</td><td>${p.customerNumber}</td><td>${p.amount}</td><td>${p.date}</td><td>${p.released?'Released':'Unreleased'}</td></tr>`).join('');
  $('#term-table').innerHTML = terms.map(t=>`<tr><td>${t.code}</td><td>${t.description}</td><td>${t.days}</td></tr>`).join('');
  $('#gl-table').innerHTML = gl.map(a=>`<tr><td>${a.code}</td><td>${a.name}</td><td>${a.category}</td><td>${a.balance}</td></tr>`).join('');
  $('#aging-table').innerHTML = aging.map(r=>`<tr><td>${r.invoiceNumber}</td><td>${r.customer}</td><td>${r.balance}</td><td>${r.bucket}</td></tr>`).join('');
  $('#bal-cust-table').innerHTML = bal.map(r=>`<tr><td>${r.customer}</td><td>${r.balance}</td></tr>`).join('');
}

$('#login-form').onsubmit = async (e)=>{ e.preventDefault(); try{ await api('/api/auth/login',{method:'POST',body:JSON.stringify({username:$('#username').value,password:$('#password').value})}); $('#login-screen').classList.add('hidden'); $('#app').classList.remove('hidden'); setActionsVisible(false); setView('dashboard'); await refreshData(); }catch(err){ $('#login-error').textContent=err.message; } };

$('#new-invoice').onclick = async ()=>{ const c=await api('/api/ar/customers'); await api('/api/ar/invoices-memos',{method:'POST',body:JSON.stringify({customerNumber:c[0].customerNumber,subtotal:1000,tax:100,totalAmount:1100,lineItems:[{item:'Service',qty:1,unitPrice:1000,lineTotal:1000}]})}); await refreshData(); setView('ar-data'); $('#view-title').textContent='Invoices and Memos'; };
$('#new-payment').onclick = async ()=>{ const inv=(await api('/api/ar/invoices-memos')).find(i=>i.balance>0); if(!inv) return; await api('/api/ar/payments',{method:'POST',body:JSON.stringify({customerNumber:inv.customerNumber,amount:200,applications:[{invoiceNumber:inv.invoiceNumber,amount:200}]})}); await refreshData(); setView('ar-data'); $('#view-title').textContent='Payments and Applications'; };
$('#new-customer').onclick = async ()=>{ await api('/api/ar/customers',{method:'POST',body:JSON.stringify({name:'New Client',email:'client@demo.com',creditLimit:5000,creditTerms:'NET30',status:'Active'})}); await refreshData(); setView('ar-data'); $('#view-title').textContent='Customers'; };
