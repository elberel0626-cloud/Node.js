const $ = (s) => document.querySelector(s);
const loginForm = $('#login-form');
const loginError = $('#login-error');
const views = [...document.querySelectorAll('.view')];
const setView = (id) => views.forEach((v) => v.classList.toggle('hidden', v.id !== id));

async function api(path, options = {}) { const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options }); const b = await r.json(); if (!r.ok) throw new Error(b.error || 'Failed'); return b; }

function renderModules(modules) {
  $('#module-nav').innerHTML = modules.map((m) => `<button data-module='${m}'>${m}</button>`).join('');
  [...document.querySelectorAll('#module-nav button')].forEach((b) => b.onclick = () => {
    if (b.dataset.module === 'AR') { $('#view-title').textContent = 'Accounts Receivable'; setView('ar-home'); }
    else { $('#view-title').textContent = `${b.dataset.module} (Coming Soon)`; setView('dashboard'); }
  });
}

function renderARGroups(groups) {
  $('#ar-groups').innerHTML = Object.entries(groups).map(([title, items]) => `<article class='metric'><h3>${title}</h3><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul></article>`).join('');
}

function renderTables({ customers, invoices, gl }) {
  $('#customer-table').innerHTML = customers.map((c) => `<tr><td>${c.customerNumber}</td><td>${c.customerName}</td><td>${c.creditTerms}</td><td>${c.status}</td><td>${c.balance}</td></tr>`).join('');
  $('#invoice-table').innerHTML = invoices.map((i) => `<tr><td>${i.invoiceNumber}</td><td>${i.customerName}</td><td>${i.invoiceTotal}</td><td>${i.invoiceDate}</td><td>${i.status}</td></tr>`).join('');
  $('#gl-table').innerHTML = gl.map((a) => `<tr><td>${a.code}</td><td>${a.name}</td><td>${a.category}</td><td>${a.type}</td><td>${a.balance}</td></tr>`).join('');
  $('#metric-cards').innerHTML = `<article class='metric'><h3>Open Invoices</h3><p>${invoices.length}</p></article><article class='metric'><h3>Customers</h3><p>${customers.length}</p></article><article class='metric'><h3>GL Accounts</h3><p>${gl.length}</p></article>`;
}

async function refreshAll() {
  const [modules, ar, customers, invoices, gl] = await Promise.all([api('/api/erp/modules'), api('/api/ar/setup'), api('/api/ar/customers'), api('/api/ar/invoices-memos'), api('/api/gl/accounts')]);
  renderModules(modules); renderARGroups(ar.groups); renderTables({ customers, invoices, gl });
}

loginForm.onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: $('#username').value, password: $('#password').value }) });
    $('#login-screen').classList.add('hidden'); $('#app').classList.remove('hidden'); setView('dashboard');
    await refreshAll();
  } catch (err) { loginError.textContent = err.message; }
};

$('#new-invoice').onclick = async () => {
  await api('/api/ar/invoices-memos', { method: 'POST', body: JSON.stringify({ docType: 'invoice', customerName: 'ABC Studios Inc', customerNumber: 'C0001', invoiceTotal: 1000, invoiceDate: new Date().toISOString().slice(0, 10), dueDate: new Date().toISOString().slice(0, 10), creditTerms: '30D' }) });
  await refreshAll(); setView('ar-data');
};
$('#new-payment').onclick = () => setView('ar-data');
$('#new-customer').onclick = () => setView('ar-data');
