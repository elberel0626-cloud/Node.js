const LIABILITY_ACCOUNT_NAME = '2621 - Sales Tax Payable';
const TAXABLE_CATEGORIES = new Set(['TAXABLE', 'SERVICE-TAXABLE', 'FREIGHT-TAXABLE']);
const RATE_FIELDS = ['stateTaxRate', 'countyTaxRate', 'cityTaxRate', 'spdTaxRate', 'otherLocalTaxRate'];

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
  { taxZoneId:'AL-MONTGOMERY', description:'Montgomery, AL combined rate', state:'AL', county:'Montgomery', city:'Montgomery', zip:'36104', stateTaxRate:4.00, countyTaxRate:2.50, cityTaxRate:3.50, spdTaxRate:0.00, otherLocalTaxRate:0.00 },
  { taxZoneId:'IL-LINCOLNSHIRE', description:'Lincolnshire, IL combined rate', state:'IL', county:'Lake', city:'Lincolnshire', zip:'60069', stateTaxRate:6.25, countyTaxRate:0.75, cityTaxRate:1.00, spdTaxRate:0.00, otherLocalTaxRate:0.00 },
  { taxZoneId:'IL-LINCOLNSHIRE', description:'Lincolnshire, IL 2027 rate version', state:'IL', county:'Lake', city:'Lincolnshire', zip:'60069', stateTaxRate:6.25, countyTaxRate:0.75, cityTaxRate:1.25, spdTaxRate:0.00, otherLocalTaxRate:0.00, effectiveDate:'2027-01-01' },
  { taxZoneId:'IL-CHICAGO', description:'Chicago, IL combined rate', state:'IL', county:'Cook', city:'Chicago', zip:'60601', stateTaxRate:6.25, countyTaxRate:1.75, cityTaxRate:1.25, spdTaxRate:1.00, otherLocalTaxRate:0.00 },
  { taxZoneId:'TX-DALLAS', description:'Dallas, TX combined rate', state:'TX', county:'Dallas', city:'Dallas', zip:'75201', stateTaxRate:6.25, countyTaxRate:0.00, cityTaxRate:1.00, spdTaxRate:1.00, otherLocalTaxRate:0.00 },
  { taxZoneId:'WI-MILWAUKEE', description:'Milwaukee, WI combined rate', state:'WI', county:'Milwaukee', city:'Milwaukee', zip:'53203', stateTaxRate:5.00, countyTaxRate:0.90, cityTaxRate:2.00, spdTaxRate:0.00, otherLocalTaxRate:0.00 },
  { taxZoneId:'MN-MINNEAPOLIS', description:'Minneapolis, MN combined rate', state:'MN', county:'Hennepin', city:'Minneapolis', zip:'55401', stateTaxRate:6.875, countyTaxRate:0.15, cityTaxRate:0.50, spdTaxRate:0.25, otherLocalTaxRate:0.00 },
  { taxZoneId:'FL-MIAMI', description:'Miami, FL combined rate', state:'FL', county:'Miami-Dade', city:'Miami', zip:'33101', stateTaxRate:6.00, countyTaxRate:1.00, cityTaxRate:0.00, spdTaxRate:0.00, otherLocalTaxRate:0.00 },
  { taxZoneId:'NY-NEW-YORK', description:'New York, NY combined rate', state:'NY', county:'New York', city:'New York', zip:'10001', stateTaxRate:4.00, countyTaxRate:0.00, cityTaxRate:4.50, spdTaxRate:0.375, otherLocalTaxRate:0.00 }
];

const norm = v => String(v || '').trim().toUpperCase();
const slug = v => norm(v).replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'ZONE';
const round2 = n => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const rateNumber = (value, field) => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be a non-negative numeric rate`);
  return n;
};
const totalRate = r => Number(RATE_FIELDS.reduce((sum, key) => sum + Number(r[key] || 0), 0).toFixed(6));
const dateKey = d => String(d || '').slice(0, 10) || '1900-01-01';
const versionTaxId = (taxZoneId, effectiveDate) => `TZ-${slug(taxZoneId)}-${dateKey(effectiveDate).replace(/-/g, '')}`;
const audit = ({ action, entityId, field = '', oldValue = '', newValue = '', user = 'admin', note = '' }) => taxHistory.unshift({ historyId:`TAXH-${String(taxHistory.length + 1).padStart(6, '0')}`, action, entityId, field, oldValue, newValue, user, note, date:new Date().toISOString() });

function buildVersion(input, { recordType = 'User Maintained Rate', validateDuplicate = true } = {}) {
  const taxZoneId = norm(input.taxZoneId || input['Tax Zone ID'] || input.zoneId || input.Zone || input.state || input.State);
  if (!taxZoneId) throw new Error('Tax Zone ID is required');
  const effectiveDate = dateKey(input.effectiveDate || input['Effective Date']);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) throw new Error('Effective Date is required and must use YYYY-MM-DD');
  if (validateDuplicate && taxRates.some(r => norm(r.taxZoneId) === taxZoneId && dateKey(r.effectiveDate) === effectiveDate)) throw new Error(`Duplicate effective date is not allowed for ${taxZoneId}`);
  const rec = {
    taxId: input.taxId || input['Tax ID'] || versionTaxId(taxZoneId, effectiveDate),
    taxZoneId,
    description: input.description || input.Description || taxZoneId,
    state: norm(input.state || input.State),
    county: input.county || input.County || '',
    city: input.city || input.City || '',
    zip: String(input.zip || input.ZIP || input['ZIP Code'] || '').slice(0, 10),
    stateTaxRate: rateNumber(input.stateTaxRate ?? input['State Tax Rate'] ?? input['State Rate'], 'State Rate'),
    countyTaxRate: rateNumber(input.countyTaxRate ?? input['County Tax Rate'] ?? input['County Rate'], 'County Rate'),
    cityTaxRate: rateNumber(input.cityTaxRate ?? input['City Tax Rate'] ?? input['City Rate'], 'City Rate'),
    spdTaxRate: rateNumber(input.spdTaxRate ?? input['SPD Tax Rate'] ?? input['SPD Rate'], 'SPD Rate'),
    otherLocalTaxRate: rateNumber(input.otherLocalTaxRate ?? input['Other Local Tax Rate'] ?? input['Other Local Rate'], 'Other Local Rate'),
    effectiveDate,
    expirationDate: input.expirationDate || input['Expiration Date'] || '',
    active: input.active === undefined && input.Active === undefined ? true : !['false','0','no','inactive'].includes(String(input.active ?? input.Active).toLowerCase()),
    liabilityAccount: input.liabilityAccount || input['Liability Account'] || LIABILITY_ACCOUNT_NAME,
    recordType
  };
  rec.totalTaxRate = totalRate(rec);
  return rec;
}

function mirrorZone(rate) {
  const existing = taxZones.find(z => z.taxId === rate.taxId);
  const zone = { taxZoneId:rate.taxZoneId, description:rate.description, state:rate.state, county:rate.county, city:rate.city, zip:rate.zip, stateTaxRate:rate.stateTaxRate, countyTaxRate:rate.countyTaxRate, cityTaxRate:rate.cityTaxRate, spdTaxRate:rate.spdTaxRate, otherLocalTaxRate:rate.otherLocalTaxRate, totalTaxRate:rate.totalTaxRate, effectiveTotalRate:rate.totalTaxRate, effectiveDate:rate.effectiveDate, expirationDate:rate.expirationDate, active:rate.active, taxId:rate.taxId };
  if (existing) Object.assign(existing, zone); else taxZones.push(zone);
  return zone;
}

export const taxRates = stateBaseRates2026.map(([abbr, name, rate]) => buildVersion({ taxZoneId:abbr, description:`${name} State Base Rate`, state:abbr, stateTaxRate:rate, effectiveDate:'2026-01-01' }, { recordType:'State Base Rate', validateDuplicate:false }))
  .concat(zoneSeed.map(r => buildVersion({ ...r, effectiveDate:r.effectiveDate || '2026-01-01' }, { recordType:'Jurisdiction Rate', validateDuplicate:false })));

export const taxZones = [];
taxRates.forEach(mirrorZone);

export const taxJurisdictions = [
  ...stateBaseRates2026.map(([abbr, name]) => ({ jurisdictionId:`JUR-STATE-${abbr}`, state:abbr, stateName:name, county:'', city:'', zipCode:'', jurisdictionType:'State', effectiveDate:'2026-01-01', expirationDate:'', active:true })),
  ...zoneSeed.flatMap(r => [
    r.county ? { jurisdictionId:`JUR-${r.state}-${slug(r.county)}`, state:r.state, county:r.county, city:'', zipCode:r.zip, jurisdictionType:'County', effectiveDate:r.effectiveDate || '2026-01-01', expirationDate:'', active:true } : null,
    r.city ? { jurisdictionId:`JUR-${r.state}-${slug(r.city)}`, state:r.state, county:r.county, city:r.city, zipCode:r.zip, jurisdictionType:'City', effectiveDate:r.effectiveDate || '2026-01-01', expirationDate:'', active:true } : null,
    r.spdTaxRate ? { jurisdictionId:`JUR-${r.state}-${slug(r.city)}-SPD`, state:r.state, county:r.county, city:r.city, zipCode:r.zip, jurisdictionType:'SPD', effectiveDate:r.effectiveDate || '2026-01-01', expirationDate:'', active:true } : null
  ].filter(Boolean))
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
  const exemptionExpiration = customer?.exemptionExpirationDate || customer?.exemptionExpiration || '';
  if (!customer?.taxExempt) return { exempt:false };
  if (exemptionExpiration && exemptionExpiration < date) return { exempt:false };
  const states = Array.isArray(customer.exemptStates) ? customer.exemptStates.map(norm) : String(customer.exemptStates || '').split(',').map(norm).filter(Boolean);
  if (states.length && state && !states.includes(norm(state))) return { exempt:false };
  return { exempt:true, reason:`${customer.exemptionType || 'Customer exemption'} ${customer.exemptionNumber || ''}`.trim() };
}

function effectiveVersion(versions, date = new Date().toISOString().slice(0,10)) {
  const asOf = dateKey(date);
  return [...versions].filter(v => v.active !== false && dateKey(v.effectiveDate) <= asOf && (!v.expirationDate || dateKey(v.expirationDate) >= asOf)).sort((a,b) => dateKey(b.effectiveDate).localeCompare(dateKey(a.effectiveDate)))[0] || null;
}

export function listTaxZoneVersions() {
  return [...taxRates].sort((a,b) => norm(a.taxZoneId).localeCompare(norm(b.taxZoneId)) || dateKey(b.effectiveDate).localeCompare(dateKey(a.effectiveDate)));
}

export function getTaxZoneVersion(taxZoneId, date) {
  return effectiveVersion(taxRates.filter(r => norm(r.taxZoneId) === norm(taxZoneId)), date);
}

export function getTaxRateForZone(zoneOrId, date = new Date().toISOString().slice(0,10)) {
  if (!zoneOrId) return null;
  if (typeof zoneOrId === 'string') return getTaxZoneVersion(zoneOrId, date);
  if (zoneOrId.taxId) return taxRates.find(r => r.taxId === zoneOrId.taxId) || getTaxZoneVersion(zoneOrId.taxZoneId, date);
  return getTaxZoneVersion(zoneOrId.taxZoneId, date) || effectiveVersion(taxRates.filter(r => r.state === zoneOrId.state && norm(r.county) === norm(zoneOrId.county) && norm(r.city) === norm(zoneOrId.city) && String(r.zip||'') === String(zoneOrId.zip||'')), date);
}

export function getTaxZone(address, date = new Date().toISOString().slice(0,10)) {
  const a = parseAddress(address);
  const currentZones = taxZones.filter(z => z.active !== false && getTaxZoneVersion(z.taxZoneId, date)?.taxId === z.taxId);
  const match = currentZones.find(z => a.zip && z.zip === a.zip)
    || currentZones.find(z => a.city && norm(z.city) === norm(a.city) && z.state === a.state)
    || currentZones.find(z => a.county && norm(z.county) === norm(a.county) && z.state === a.state)
    || currentZones.find(z => z.state === a.state && !z.city && !z.county && !z.zip)
    || null;
  return match ? getTaxZoneVersion(match.taxZoneId, date) : null;
}

export function saveTaxZoneVersion(input, { user = 'admin' } = {}) {
  const taxId = input.taxId || input['Tax ID'];
  if (taxId) {
    const existing = taxRates.find(r => r.taxId === taxId);
    if (!existing) throw new Error('Tax Zone version not found');
    const before = { ...existing };
    const next = buildVersion({ ...existing, ...input, taxZoneId:existing.taxZoneId, effectiveDate:existing.effectiveDate, taxId:existing.taxId }, { recordType:existing.recordType, validateDuplicate:false });
    Object.assign(existing, next);
    mirrorZone(existing);
    for (const key of [...RATE_FIELDS, 'description', 'expirationDate', 'active']) {
      if (String(before[key] ?? '') !== String(existing[key] ?? '')) audit({ action:'Update Tax Zone', entityId:existing.taxId, field:key, oldValue:before[key], newValue:existing[key], user });
    }
    return existing;
  }
  const rec = buildVersion(input, { recordType:input.recordType || 'User Maintained Rate' });
  taxRates.push(rec);
  mirrorZone(rec);
  audit({ action:'Add Tax Zone', entityId:rec.taxId, newValue:JSON.stringify({ taxZoneId:rec.taxZoneId, effectiveDate:rec.effectiveDate, totalTaxRate:rec.totalTaxRate }), user });
  return rec;
}

export function copyTaxZoneVersion(taxId, effectiveDate, { user = 'admin' } = {}) {
  const source = taxRates.find(r => r.taxId === taxId) || getTaxZoneVersion(taxId);
  if (!source) throw new Error('Tax Zone version not found');
  const copy = saveTaxZoneVersion({ ...source, taxId:'', effectiveDate:dateKey(effectiveDate || new Date().toISOString().slice(0,10)), recordType:'User Maintained Rate' }, { user });
  audit({ action:'Copy Tax Zone', entityId:copy.taxId, oldValue:source.taxId, newValue:copy.taxId, user });
  return copy;
}

export function inactivateTaxZoneVersion(taxId, { user = 'admin' } = {}) {
  const rec = taxRates.find(r => r.taxId === taxId);
  if (!rec) throw new Error('Tax Zone version not found');
  const oldValue = rec.active;
  rec.active = false;
  mirrorZone(rec);
  audit({ action:'Inactivate Tax Zone', entityId:rec.taxId, field:'active', oldValue, newValue:false, user });
  return rec;
}

export function importTaxRates(rows = [], { user = 'admin' } = {}) {
  const imported = [];
  const errors = [];
  rows.forEach((row, idx) => {
    try {
      const mapped = {
        taxZoneId: row['Tax Zone ID'] || row.taxZoneId || row.Zone || row.State || row.state,
        description: row.Description || row.description || '',
        state: row.State || row.state,
        county: row.County || row.county || '',
        city: row.City || row.city || '',
        zip: row.ZIP || row.Zip || row.zip || '',
        stateTaxRate: row['State Rate'] ?? row['State Tax Rate'] ?? row.stateTaxRate,
        countyTaxRate: row['County Rate'] ?? row['County Tax Rate'] ?? row.countyTaxRate,
        cityTaxRate: row['City Rate'] ?? row['City Tax Rate'] ?? row.cityTaxRate,
        spdTaxRate: row['SPD Rate'] ?? row['SPD Tax Rate'] ?? row.spdTaxRate,
        otherLocalTaxRate: row['Other Local Rate'] ?? row['Other Local Tax Rate'] ?? row.otherLocalTaxRate,
        effectiveDate: row['Effective Date'] || row.effectiveDate,
        expirationDate: row['Expiration Date'] || row.expirationDate || '',
        active: row.Active ?? row.active
      };
      imported.push(saveTaxZoneVersion(mapped, { user }));
    } catch (e) {
      errors.push({ row:idx + 1, error:e.message });
    }
  });
  if (errors.length) {
    const err = new Error('Tax zone import failed validation');
    err.details = errors;
    throw err;
  }
  return imported;
}

export function saveTaxCategory(input, { user = 'admin' } = {}) {
  const categoryId = norm(input.categoryId || input.id);
  if (!categoryId) throw new Error('Tax Category ID is required');
  const existing = taxCategories.find(c => c.categoryId === categoryId);
  const payload = { categoryId, description:input.description || '', taxable:!!input.taxable, active:input.active !== false };
  if (existing) {
    const before = { ...existing };
    Object.assign(existing, payload);
    audit({ action:'Update Tax Category', entityId:categoryId, oldValue:JSON.stringify(before), newValue:JSON.stringify(existing), user });
    return existing;
  }
  taxCategories.push(payload);
  audit({ action:'Add Tax Category', entityId:categoryId, newValue:JSON.stringify(payload), user });
  return payload;
}

export function calculateTax(invoice, { customer = {}, items = [] } = {}) {
  const taxDate = invoice.date || invoice.invoiceDate || invoice.postDate || new Date().toISOString().slice(0,10);
  const address = invoice.shipToAddress || invoice.shippingAddress || customer.shippingAddress || '';
  const rate = invoice.taxZone ? getTaxRateForZone(invoice.taxZone, taxDate) : getTaxZone(address, taxDate);
  const state = rate?.state || parseAddress(address).state || customer.state || '';
  const exemption = isCustomerExempt(customer, state, taxDate);
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
  return { provider:'Internal Tax Table', taxZone:rate?.taxZoneId || '', taxRate:rate, taxDetail:detail, taxSummary, lines:computedLines, exemptionReason:exemption.exempt ? exemption.reason : '', validation: { hasShipToAddress:!!address, hasTaxZone:!!rate?.taxZoneId, hasTaxRate:!!rate } };
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
