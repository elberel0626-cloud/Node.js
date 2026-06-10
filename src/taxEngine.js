const LIABILITY_ACCOUNT = '2621';
const LIABILITY_ACCOUNT_NAME = '2621 - Sales Tax Payable';
const TAXABLE_CATEGORIES = new Set(['TAXABLE', 'SERVICE-TAXABLE', 'FREIGHT-TAXABLE']);

export const taxCategories = [
  { categoryId: 'TAXABLE', description: 'Taxable tangible goods', taxable: true, default: true, active: true },
  { categoryId: 'EXEMPT', description: 'Exempt tangible goods', taxable: false, active: true },
  { categoryId: 'RESALE', description: 'Resale certificate', taxable: false, active: true },
  { categoryId: 'SERVICE-TAXABLE', description: 'Taxable services', taxable: true, active: true },
  { categoryId: 'SERVICE-EXEMPT', description: 'Exempt services', taxable: false, active: true },
  { categoryId: 'FREIGHT-TAXABLE', description: 'Taxable freight', taxable: true, active: true },
  { categoryId: 'FREIGHT-EXEMPT', description: 'Exempt freight', taxable: false, active: true }
];

export const stateBaseRates2026 = [
  ['AL','Alabama',4.00],['AK','Alaska',0.00],['AZ','Arizona',5.60],['AR','Arkansas',6.50],['CA','California',7.25],
  ['CO','Colorado',2.90],['CT','Connecticut',6.35],['DE','Delaware',0.00],['FL','Florida',6.00],['GA','Georgia',4.00],
  ['HI','Hawaii',4.00],['ID','Idaho',6.00],['IL','Illinois',6.25],['IN','Indiana',7.00],['IA','Iowa',6.00],
  ['KS','Kansas',6.50],['KY','Kentucky',6.00],['LA','Louisiana',5.00],['ME','Maine',5.50],['MD','Maryland',6.00],
  ['MA','Massachusetts',6.25],['MI','Michigan',6.00],['MN','Minnesota',6.875],['MS','Mississippi',7.00],['MO','Missouri',4.225],
  ['MT','Montana',0.00],['NE','Nebraska',5.50],['NV','Nevada',6.85],['NH','New Hampshire',0.00],['NJ','New Jersey',6.625],
  ['NM','New Mexico',4.875],['NY','New York',4.00],['NC','North Carolina',4.75],['ND','North Dakota',5.00],['OH','Ohio',5.75],
  ['OK','Oklahoma',4.50],['OR','Oregon',0.00],['PA','Pennsylvania',6.00],['RI','Rhode Island',7.00],['SC','South Carolina',6.00],
  ['SD','South Dakota',4.20],['TN','Tennessee',7.00],['TX','Texas',6.25],['UT','Utah',4.85],['VT','Vermont',6.00],
  ['VA','Virginia',4.30],['WA','Washington',6.50],['WV','West Virginia',6.00],['WI','Wisconsin',5.00],['WY','Wyoming',4.00]
];

const zoneSeed = [
  { taxId:'RATE-AL-MONTGOMERY-36104', taxZoneId:'AL-MONTGOMERY', state:'AL', county:'Montgomery', city:'Montgomery', zip:'36104', stateTaxRate:4.00, countyTaxRate:2.50, cityTaxRate:3.50, spdTaxRate:0.00, otherLocalTaxRate:0.00 },
  { taxId:'RATE-IL-LINCOLNSHIRE-60069', taxZoneId:'IL-LINCOLNSHIRE', state:'IL', county:'Lake', city:'Lincolnshire', zip:'60069', stateTaxRate:6.25, countyTaxRate:1.00, cityTaxRate:0.00, spdTaxRate:0.00, otherLocalTaxRate:0.00 },
  { taxId:'RATE-IL-CHICAGO-60601', taxZoneId:'IL-CHICAGO', state:'IL', county:'Cook', city:'Chicago', zip:'60601', stateTaxRate:6.25, countyTaxRate:1.75, cityTaxRate:1.25, spdTaxRate:1.00, otherLocalTaxRate:0.00 },
  { taxId:'RATE-TX-DALLAS-75201', taxZoneId:'TX-DALLAS', state:'TX', county:'Dallas', city:'Dallas', zip:'75201', stateTaxRate:6.25, countyTaxRate:0.00, cityTaxRate:1.00, spdTaxRate:1.00, otherLocalTaxRate:0.00 },
  { taxId:'RATE-WI-MILWAUKEE-53203', taxZoneId:'WI-MILWAUKEE', state:'WI', county:'Milwaukee', city:'Milwaukee', zip:'53203', stateTaxRate:5.00, countyTaxRate:0.90, cityTaxRate:2.00, spdTaxRate:0.00, otherLocalTaxRate:0.00 },
  { taxId:'RATE-MN-MINNEAPOLIS-55401', taxZoneId:'MN-MINNEAPOLIS', state:'MN', county:'Hennepin', city:'Minneapolis', zip:'55401', stateTaxRate:6.875, countyTaxRate:0.15, cityTaxRate:0.50, spdTaxRate:0.25, otherLocalTaxRate:0.00 },
  { taxId:'RATE-FL-MIAMI-33101', taxZoneId:'FL-MIAMI', state:'FL', county:'Miami-Dade', city:'Miami', zip:'33101', stateTaxRate:6.00, countyTaxRate:1.00, cityTaxRate:0.00, spdTaxRate:0.00, otherLocalTaxRate:0.00 },
  { taxId:'RATE-NY-NYC-10001', taxZoneId:'NY-NEW-YORK', state:'NY', county:'New York', city:'New York', zip:'10001', stateTaxRate:4.00, countyTaxRate:0.00, cityTaxRate:4.50, spdTaxRate:0.375, otherLocalTaxRate:0.00 }
];

const totalRate = r => Number((Number(r.stateTaxRate||0)+Number(r.countyTaxRate||0)+Number(r.cityTaxRate||0)+Number(r.spdTaxRate||0)+Number(r.otherLocalTaxRate||0)).toFixed(6));
const norm = v => String(v || '').trim().toUpperCase();
const round2 = n => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

export const taxRates = stateBaseRates2026.map(([abbr, name, rate]) => ({
  taxId: `STATE-${abbr}`,
  state: abbr,
  stateName: name,
  county: '',
  city: '',
  zip: '',
  stateTaxRate: rate,
  countyTaxRate: 0,
  cityTaxRate: 0,
  spdTaxRate: 0,
  otherLocalTaxRate: 0,
  totalTaxRate: rate,
  effectiveDate: '2026-01-01',
  expirationDate: '',
  active: true,
  liabilityAccount: LIABILITY_ACCOUNT_NAME,
  recordType: 'State Base Rate'
})).concat(zoneSeed.map(r => ({ ...r, totalTaxRate: totalRate(r), effectiveDate: '2026-01-01', expirationDate: '', active: true, liabilityAccount: LIABILITY_ACCOUNT_NAME, recordType: 'Jurisdiction Rate' })));

export const taxJurisdictions = [
  ...stateBaseRates2026.map(([abbr, name]) => ({ jurisdictionId:`JUR-STATE-${abbr}`, state:abbr, stateName:name, county:'', city:'', zipCode:'', jurisdictionType:'State', effectiveDate:'2026-01-01', expirationDate:'', active:true })),
  ...zoneSeed.flatMap(r => [
    r.county ? { jurisdictionId:`JUR-${r.state}-${norm(r.county).replace(/\W+/g,'-')}`, state:r.state, county:r.county, city:'', zipCode:r.zip, jurisdictionType:'County', effectiveDate:'2026-01-01', expirationDate:'', active:true } : null,
    r.city ? { jurisdictionId:`JUR-${r.state}-${norm(r.city).replace(/\W+/g,'-')}`, state:r.state, county:r.county, city:r.city, zipCode:r.zip, jurisdictionType:'City', effectiveDate:'2026-01-01', expirationDate:'', active:true } : null,
    r.spdTaxRate ? { jurisdictionId:`JUR-${r.state}-${norm(r.city).replace(/\W+/g,'-')}-SPD`, state:r.state, county:r.county, city:r.city, zipCode:r.zip, jurisdictionType:'SPD', effectiveDate:'2026-01-01', expirationDate:'', active:true } : null
  ].filter(Boolean))
];

export const taxZones = [
  ...taxRates.filter(r => r.recordType === 'State Base Rate').map(r => ({ taxZoneId:r.state, state:r.state, county:'', city:'', zip:'', effectiveTotalRate:r.totalTaxRate, active:true, taxId:r.taxId })),
  ...zoneSeed.map(r => ({ taxZoneId:r.taxZoneId, state:r.state, county:r.county, city:r.city, zip:r.zip, effectiveTotalRate:totalRate(r), active:true, taxId:r.taxId }))
];

export const customerExemptions = [];
export const taxHistory = [];

export function parseAddress(input = {}) {
  if (typeof input === 'string') {
    const text = input;
    const zip = (text.match(/\b\d{5}(?:-\d{4})?\b/) || [''])[0].slice(0, 5);
    const state = (text.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/i) || ['',''])[1].toUpperCase();
    const city = (text.split(',').slice(-2, -1)[0] || '').trim();
    return { state, city, zip };
  }
  return { state:norm(input.state), county:input.county||'', city:input.city||'', zip:String(input.zip || input.zipCode || '').slice(0,5), addressLine1:input.addressLine1||input.address||'' };
}

export function isCategoryTaxable(categoryId) {
  return TAXABLE_CATEGORIES.has(norm(categoryId || 'TAXABLE'));
}

export function isCustomerExempt(customer, state, date = new Date().toISOString().slice(0,10)) {
  if (!customer?.taxExempt) return { exempt:false };
  if (customer.exemptionExpirationDate && customer.exemptionExpirationDate < date) return { exempt:false };
  const states = Array.isArray(customer.exemptStates) ? customer.exemptStates.map(norm) : String(customer.exemptStates || '').split(',').map(norm).filter(Boolean);
  if (states.length && state && !states.includes(norm(state))) return { exempt:false };
  return { exempt:true, reason:`${customer.exemptionType || 'Customer exemption'} ${customer.exemptionNumber || ''}`.trim() };
}

export function getTaxRateForZone(zoneOrId) {
  const zone = typeof zoneOrId === 'string' ? taxZones.find(z => z.taxZoneId === zoneOrId) : zoneOrId;
  if (!zone) return null;
  return taxRates.find(r => r.taxId === zone.taxId) || taxRates.find(r => r.state === zone.state && norm(r.county) === norm(zone.county) && norm(r.city) === norm(zone.city) && String(r.zip||'') === String(zone.zip||'')) || taxRates.find(r => r.taxId === `STATE-${zone.state}`);
}

export function getTaxZone(address) {
  const a = parseAddress(address);
  return taxZones.find(z => z.active && a.zip && z.zip === a.zip)
    || taxZones.find(z => z.active && a.city && norm(z.city) === norm(a.city) && z.state === a.state)
    || taxZones.find(z => z.active && a.county && norm(z.county) === norm(a.county) && z.state === a.state)
    || taxZones.find(z => z.active && z.state === a.state && !z.city && !z.county && !z.zip)
    || null;
}

export function importTaxRates(rows = []) {
  const imported = [];
  for (const row of rows) {
    const state = norm(row.State || row.state);
    if (!state) continue;
    const city = row.City || row.city || '';
    const county = row.County || row.county || '';
    const zip = String(row.ZIP || row.zip || '').slice(0,5);
    const rec = {
      taxId: row['Tax ID'] || `IMP-${state}-${zip || norm(city).replace(/\W+/g,'-') || norm(county).replace(/\W+/g,'-') || 'STATE'}-${taxRates.length + imported.length + 1}`,
      state, county, city, zip,
      stateTaxRate: Number(row['State Tax Rate'] ?? row.stateTaxRate ?? 0),
      countyTaxRate: Number(row['County Tax Rate'] ?? row.countyTaxRate ?? 0),
      cityTaxRate: Number(row['City Tax Rate'] ?? row.cityTaxRate ?? 0),
      spdTaxRate: Number(row['SPD Tax Rate'] ?? row.spdTaxRate ?? 0),
      otherLocalTaxRate: Number(row['Other Local Tax Rate'] ?? row.otherLocalTaxRate ?? 0),
      effectiveDate: row['Effective Date'] || row.effectiveDate || new Date().toISOString().slice(0,10),
      expirationDate: row['Expiration Date'] || row.expirationDate || '',
      active: row.Active === undefined ? true : !['false','0','no'].includes(String(row.Active).toLowerCase()),
      liabilityAccount: row['Liability Account'] || LIABILITY_ACCOUNT_NAME,
      recordType: 'Imported Jurisdiction Rate'
    };
    rec.totalTaxRate = totalRate(rec);
    taxRates.push(rec);
    const taxZoneId = row['Tax Zone ID'] || `${state}-${norm(city || county || zip || 'STATE').replace(/\W+/g,'-')}`;
    const zone = { taxZoneId, state, county, city, zip, effectiveTotalRate: rec.totalTaxRate, active: rec.active, taxId: rec.taxId };
    taxZones.push(zone);
    imported.push(rec);
  }
  return imported;
}

export function calculateTax(invoice, { customer = {}, items = [] } = {}) {
  const address = invoice.shipToAddress || invoice.shippingAddress || customer.shippingAddress || '';
  const zone = invoice.taxZone ? taxZones.find(z => z.taxZoneId === invoice.taxZone) : getTaxZone(address);
  const rate = getTaxRateForZone(zone);
  const state = zone?.state || parseAddress(address).state || customer.state || '';
  const exemption = isCustomerExempt(customer, state, invoice.date || invoice.postDate);
  const detail = { stateTaxableAmount:0, stateTaxRate:rate?.stateTaxRate || 0, stateTaxAmount:0, countyTaxableAmount:0, countyTaxRate:rate?.countyTaxRate || 0, countyTaxAmount:0, cityTaxableAmount:0, cityTaxRate:rate?.cityTaxRate || 0, cityTaxAmount:0, spdTaxableAmount:0, spdTaxRate:rate?.spdTaxRate || 0, spdTaxAmount:0, otherLocalTaxableAmount:0, otherLocalTaxRate:rate?.otherLocalTaxRate || 0, otherLocalTaxAmount:0, totalTaxAmount:0 };
  let subtotal = 0, discount = 0, taxableTotal = 0, exemptTotal = 0;
  const computedLines = (invoice.lines || []).map(line => {
    const item = items.find(i => i.code === line.itemCode || i.inventoryId === line.itemCode) || {};
    const qty = Number(line.qty || 0);
    const unitPrice = Number(line.unitPrice || item.salesPrice || 0);
    const gross = qty * unitPrice;
    const lineDiscount = Number(line.discountAmount ?? gross * (Number(line.discountPct || 0) / 100));
    const taxableAmount = Math.max(0, gross - lineDiscount);
    const taxCategory = line.taxCategory || item.taxCategory || (item.taxable === false ? 'EXEMPT' : 'TAXABLE');
    const taxable = !exemption.exempt && isCategoryTaxable(taxCategory);
    subtotal += gross;
    discount += lineDiscount;
    if (taxable) taxableTotal += taxableAmount; else exemptTotal += taxableAmount;
    return { ...line, qty, unitPrice, discountAmount:lineDiscount, taxCategory, taxable, taxableAmount, exemptAmount:taxable ? 0 : taxableAmount };
  });
  for (const key of ['state','county','city','spd','otherLocal']) {
    const rateKey = `${key}TaxRate`, amtKey = `${key}TaxAmount`, taxableKey = `${key}TaxableAmount`;
    if (detail[rateKey] > 0) detail[taxableKey] = taxableTotal;
    detail[amtKey] = round2(taxableTotal * detail[rateKey] / 100);
  }
  detail.totalTaxAmount = round2(detail.stateTaxAmount + detail.countyTaxAmount + detail.cityTaxAmount + detail.spdTaxAmount + detail.otherLocalTaxAmount);
  const taxSummary = { subtotal:round2(subtotal), discount:round2(discount), taxableTotal:round2(taxableTotal), exemptTotal:round2(exemptTotal), taxTotal:detail.totalTaxAmount, invoiceTotal:round2(subtotal - discount + detail.totalTaxAmount) };
  return { provider:'Internal Tax Table', taxZone:zone?.taxZoneId || '', taxRate:rate, taxDetail:detail, taxSummary, lines:computedLines, exemptionReason:exemption.exempt ? exemption.reason : '', validation: { hasShipToAddress:!!address, hasTaxZone:!!zone, hasTaxRate:!!rate } };
}

export const internalTaxProvider = {
  name: 'Internal Tax Table',
  getTaxRate: getTaxRateForZone,
  getTaxZone,
  calculateTax
};

export class TaxProvider {
  getTaxRate(address) { return internalTaxProvider.getTaxRate(getTaxZone(address)); }
  getTaxZone(address) { return internalTaxProvider.getTaxZone(address); }
  calculateTax(invoice) { return internalTaxProvider.calculateTax(invoice); }
}

export function taxPaidByCustomer(invoice, paymentsApplied = 0) {
  const invoiceTotal = Number(invoice.amount || invoice.grandTotal || invoice.taxSummary?.invoiceTotal || 0);
  if (!invoiceTotal) return 0;
  return round2(Number(invoice.taxTotal || invoice.taxSummary?.taxTotal || 0) * (Number(paymentsApplied || 0) / invoiceTotal));
}
