const loginScreen = document.getElementById('login-screen');
const app = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const viewTitle = document.getElementById('view-title');

const views = [...document.querySelectorAll('.view')];
const navButtons = [...document.querySelectorAll('nav button')];

function setView(viewId) {
  views.forEach((v) => v.classList.toggle('hidden', v.id !== viewId));
  viewTitle.textContent = navButtons.find((b) => b.dataset.view === viewId)?.textContent || 'Dashboard';
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
}

function renderMetrics(invoices, gl) {
  const totalAR = invoices.reduce((sum, i) => sum + Number(i.invoiceTotal || 0), 0);
  const cards = [
    ['Open AR Documents', invoices.length],
    ['Total AR Exposure', totalAR.toLocaleString()],
    ['GL Accounts', gl.length],
    ['Quick Actions', 3]
  ];
  document.getElementById('metric-cards').innerHTML = cards
    .map(([title, value]) => `<article class="metric"><h3>${title}</h3><p>${value}</p></article>`)
    .join('');
}

function renderInvoices(invoices) {
  document.getElementById('invoice-table').innerHTML = invoices
    .map((i) => `<tr><td>${i.invoiceNumber}</td><td>${i.customerName}</td><td>${i.invoiceTotal}</td><td>${i.invoiceDate}</td><td>${i.status}</td></tr>`)
    .join('');
}

function renderGL(accounts) {
  document.getElementById('gl-table').innerHTML = accounts
    .map((a) => `<tr><td>${a.code}</td><td>${a.name}</td><td>${a.type}</td><td>${a.subledger || '-'}</td></tr>`)
    .join('');
}

async function refresh() {
  const [invoices, gl, custom] = await Promise.all([
    api('/api/ar/invoices-memos'),
    api('/api/gl/accounts'),
    api('/api/admin/customize')
  ]);
  renderMetrics(invoices, gl);
  renderInvoices(invoices);
  renderGL(gl);
  document.getElementById('custom-output').textContent = JSON.stringify(custom, null, 2);
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
      })
    });
    loginScreen.classList.add('hidden');
    app.classList.remove('hidden');
    await refresh();
  } catch (err) {
    loginError.textContent = err.message;
  }
});

navButtons.forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

document.getElementById('custom-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/admin/customize', {
    method: 'POST',
    body: JSON.stringify({
      target: document.getElementById('target').value,
      key: document.getElementById('key').value,
      value: document.getElementById('value').value
    })
  });
  await refresh();
});

document.getElementById('new-invoice').addEventListener('click', async () => {
  await api('/api/ar/invoices-memos', {
    method: 'POST',
    body: JSON.stringify({
      docType: 'invoice',
      customerName: 'Quick Customer',
      invoiceTotal: 100,
      invoiceDate: new Date().toISOString().slice(0, 10)
    })
  });
  setView('ar');
  await refresh();
});

document.getElementById('new-payment').addEventListener('click', () => alert('Payment screen placeholder.'));
document.getElementById('new-customer').addEventListener('click', () => alert('Customer screen placeholder.'));
