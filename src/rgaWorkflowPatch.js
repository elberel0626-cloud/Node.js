import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedName = '.server-rga-workflow-runtime.js';
const generatedPath = path.join(here, generatedName);

function replaceOnce(source, oldText, newText, label) {
  if (source.includes(newText)) return source;
  const first = source.indexOf(oldText);
  if (first < 0) throw new Error(`RGA workflow integration failed: ${label} was not found.`);
  if (source.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`RGA workflow integration failed: ${label} matched more than once.`);
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}

export function applyRgaWorkflowPatch(source) {
  source = replaceOnce(
    source,
    "import { generateInvoicePdf } from './invoicePdf.js';",
    "import { generateInvoicePdf } from './invoicePdf.js';\nimport { buildRgaLinesFromInvoice, calculateRgaTotals, mergeRequestedRgaLines, rgaReceiptComplete, rgaRemainingReceiptQty, validateRgaLines } from './rgaDomain.js';",
    'RGA domain import'
  );

  const stateMarker = 'const staticContentTypes=';
  const stateCode = String.raw`
const rgaStorePath = path.resolve('data/rga-transactions.json');
const rgaStored = await readFile(rgaStorePath, 'utf8').then(JSON.parse).catch(() => ({ returns: [], receipts: [] }));
const customerReturns = Array.isArray(rgaStored.returns) ? rgaStored.returns : [];
const rgaReceipts = Array.isArray(rgaStored.receipts) ? rgaStored.receipts : [];
const persistRgaStore = async () => {
  await mkdir(path.dirname(rgaStorePath), { recursive: true });
  const temporary = rgaStorePath + '.' + process.pid + '.' + Date.now() + '.tmp';
  await writeFile(temporary, JSON.stringify({ returns: customerReturns, receipts: rgaReceipts }, null, 2));
  await rename(temporary, rgaStorePath);
};
const rgaNumber = () => {
  const max = customerReturns.reduce((value, row) => Math.max(value, Number(String(row.id || '').replace(/\D/g, '')) || 0), 0);
  return 'RGA-' + String(max + 1).padStart(6, '0');
};
const rgaReceiptNumber = () => {
  const max = rgaReceipts.reduce((value, row) => Math.max(value, Number(String(row.id || '').replace(/\D/g, '')) || 0), 0);
  return 'RGR-' + String(max + 1).padStart(6, '0');
};
const rgaFind = id => customerReturns.find(row => row.id === id);
const rgaInvoice = row => arDocuments.find(doc => doc.id === row?.invoiceId && doc.type === 'Invoice');
const rgaCreditMemo = row => arDocuments.find(doc => doc.id === row?.creditMemoId || doc.sourceRgaId === row?.id);
const activeRga = row => row && !['Cancelled', 'Rejected'].includes(row.status);
function rgaCommittedByLine(invoiceId, excludeRgaId = '') {
  const committed = {};
  customerReturns.filter(row => row.invoiceId === invoiceId && row.id !== excludeRgaId && activeRga(row) && row.status !== 'Draft').forEach(row => {
    (row.lines || []).forEach(line => {
      const key = Number(line.invoiceLineIndex);
      committed[key] = Number(committed[key] || 0) + Number(line.returnQty || 0);
    });
  });
  return committed;
}
function rgaInvoiceSummary(invoice) {
  normalizeArStatus(invoice);
  const committed = rgaCommittedByLine(invoice.id);
  const returnableLines = buildRgaLinesFromInvoice(invoice, committed);
  return {
    id: invoice.id,
    invoiceId: invoice.id,
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    invoiceDate: invoice.date || invoice.createdDate || '',
    amount: Number(invoice.amount || invoice.grandTotal || 0),
    balance: Number(invoice.balance || 0),
    status: invoice.status,
    paid: Number(invoice.balance || 0) <= 0,
    sourceSalesOrderId: invoice.sourceSalesOrderId || '',
    sourceSalesOrderNumber: invoice.sourceSalesOrderNumber || '',
    sourceShipmentId: invoice.sourceShipmentId || '',
    returnableLines
  };
}
function serializeRga(row) {
  const invoice = rgaInvoice(row);
  const credit = rgaCreditMemo(row);
  if (invoice) normalizeArStatus(invoice);
  if (credit) normalizeArStatus(credit);
  const receipts = rgaReceipts.filter(receipt => receipt.rgaId === row.id);
  const totals = calculateRgaTotals(row.lines || []);
  const receivedQty = (row.lines || []).reduce((sum, line) => sum + Number(line.receivedQty || 0), 0);
  return {
    ...row,
    totals,
    totalCredit: totals.total,
    authorizedQty: totals.quantity,
    receivedQty,
    receiptComplete: rgaReceiptComplete(row.lines || []),
    invoice: invoice ? rgaInvoiceSummary(invoice) : null,
    creditMemo: credit ? { id: credit.id, status: credit.status, posted: !!credit.posted, amount: Number(credit.amount || 0), balance: Number(credit.balance || 0) } : null,
    receipts
  };
}
function rgaBuildLines(invoice, requestedLines = [], excludeRgaId = '') {
  const base = buildRgaLinesFromInvoice(invoice, rgaCommittedByLine(invoice.id, excludeRgaId));
  const merged = mergeRequestedRgaLines(base, requestedLines);
  validateRgaLines(merged);
  return merged;
}
function createRgaCreditDocument(row, transactionDate) {
  const invoice = rgaInvoice(row);
  if (!invoice) throw new Error('Original invoice not found.');
  const selected = (row.lines || []).filter(line => Number(line.returnQty || 0) > 0);
  const totals = calculateRgaTotals(selected);
  const id = nextId('CM');
  const lines = selected.map(line => ({
    itemCode: line.itemCode,
    description: line.description,
    qty: Number(line.returnQty || 0),
    unitPrice: Number(line.unitPrice || 0),
    discountPct: Number(line.discountPct || 0),
    taxable: !!line.taxable,
    tax: Number(line.taxAmount || 0),
    lineTotal: Number(line.creditAmount || 0),
    revenueAccount: line.revenueAccount || POSTING_ACCOUNTS.defaultSalesRevenue,
    sourceSalesOrderLineId: line.sourceSalesOrderLineId || ''
  }));
  return {
    id,
    type: 'Credit Memo',
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    date: transactionDate,
    postDate: transactionDate,
    postPeriod: periodFromDate(transactionDate),
    dueDate: transactionDate,
    terms: invoice.terms || '',
    status: 'Saved',
    posted: false,
    createdDate: new Date().toISOString().slice(0, 10),
    amount: totals.total,
    balance: totals.total,
    lines,
    subtotal: totals.merchandise,
    discountTotal: selected.reduce((sum, line) => sum + (Number(line.returnQty || 0) * Number(line.unitPrice || 0) * Number(line.discountPct || 0) / 100), 0),
    taxTotal: totals.tax,
    grandTotal: totals.total,
    applications: [],
    sourceRgaId: row.id,
    sourceInvoiceId: invoice.id,
    sourceSalesOrderId: invoice.sourceSalesOrderId || '',
    sourceSalesOrderNumber: invoice.sourceSalesOrderNumber || '',
    sourceShipmentId: invoice.sourceShipmentId || '',
    description: 'Customer return ' + row.id + ' against ' + invoice.id
  };
}
function applyRgaCredit(row, credit, applicationDate) {
  const invoice = rgaInvoice(row);
  if (!invoice || !credit?.posted) return { appliedAmount: 0, invoiceBalance: Number(invoice?.balance || 0), creditBalance: Number(credit?.balance || 0) };
  normalizeArStatus(invoice); normalizeArStatus(credit);
  if (!invoice.posted || Number(invoice.balance || 0) <= 0 || Number(credit.balance || 0) <= 0) {
    return { appliedAmount: 0, invoiceBalance: Number(invoice.balance || 0), creditBalance: Number(credit.balance || 0) };
  }
  const existing = (credit.applications || []).find(app => app.reference === invoice.id || app.invoiceId === invoice.id);
  if (existing) return { appliedAmount: Number(existing.amount || 0), invoiceBalance: Number(invoice.balance || 0), creditBalance: Number(credit.balance || 0) };
  const amount = Math.min(Number(invoice.balance || 0), Number(credit.balance || 0));
  invoice.balance = Math.max(0, Number(invoice.balance || 0) - amount);
  credit.balance = Math.max(0, Number(credit.balance || 0) - amount);
  invoice.applications = invoice.applications || [];
  credit.applications = credit.applications || [];
  invoice.applications.push({ reference: credit.id, paymentId: credit.id, amount, date: applicationDate, status: 'Applied', type: 'Credit Memo', appliedFromReference: invoice.id, remainingBalance: invoice.balance, sourceRgaId: row.id });
  credit.applications.push({ reference: invoice.id, invoiceId: invoice.id, amount, date: applicationDate, status: 'Applied', type: 'Invoice', appliedFromReference: credit.id, remainingBalance: credit.balance, sourceRgaId: row.id });
  normalizeArStatus(invoice); normalizeArStatus(credit);
  return { appliedAmount: amount, invoiceBalance: Number(invoice.balance || 0), creditBalance: Number(credit.balance || 0) };
}
function validateRgaApproval(row) {
  const invoice = rgaInvoice(row);
  if (!invoice) throw new Error('Original invoice not found.');
  const rebuilt = rgaBuildLines(invoice, row.lines || [], row.id);
  row.lines = rebuilt.map((line, index) => ({ ...line, lineId: row.lines?.[index]?.lineId || ('RGAL-' + row.id + '-' + (index + 1)), receivedQty: Number(row.lines?.[index]?.receivedQty || 0) }));
  return row;
}
`;
  source = replaceOnce(source, stateMarker, stateCode + '\n' + stateMarker, 'RGA runtime state marker');

  const routeMarker = "if(method==='GET'&&pathname==='/api/inventory/items')";
  const routes = String.raw`
 if(method==='GET'&&pathname==='/api/rga/eligible-invoices'){
   normalizeAllArStatuses();
   const rows = arDocuments.filter(doc => doc.type === 'Invoice' && doc.posted && doc.status !== 'Voided' && (!query.customerId || doc.customerId === query.customerId)).map(rgaInvoiceSummary).filter(row => row.returnableLines.some(line => Number(line.availableToReturnQty || 0) > 0));
   return json(res,200,rows);
 }
 if(method==='GET'&&pathname==='/api/rga'){
   let rows = customerReturns.map(serializeRga);
   if(query.status) rows = rows.filter(row => row.status === query.status);
   if(query.customerId) rows = rows.filter(row => row.customerId === query.customerId);
   if(query.invoiceId) rows = rows.filter(row => row.invoiceId === query.invoiceId);
   return json(res,200,rows.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))));
 }
 if(method==='GET'&&/^\/api\/rga\/[^/]+$/.test(pathname)){
   const id=decodeURIComponent(pathname.split('/').pop()),row=rgaFind(id);return row?json(res,200,serializeRga(row)):json(res,404,{error:'RGA not found'});
 }
 if(method==='POST'&&pathname==='/api/rga'){
   const b=await body(req),invoice=arDocuments.find(doc=>doc.id===b.invoiceId&&doc.type==='Invoice');
   if(!invoice)return json(res,400,{error:'A valid original customer invoice is required.'});
   normalizeArStatus(invoice);if(!invoice.posted||invoice.status==='Voided')return json(res,400,{error:'RGA can only be created from a posted, non-voided invoice.'});
   const lines=rgaBuildLines(invoice,b.lines||[]),id=rgaNumber(),now=new Date().toISOString();
   const row={id,rgaNumber:id,status:'Draft',invoiceId:invoice.id,customerId:invoice.customerId,customerName:invoice.customerName,reason:String(b.reason||'Customer Return'),notes:String(b.notes||''),requestedDate:b.requestedDate||now.slice(0,10),createdAt:now,createdBy:currentUser(req)?.id||'admin',updatedAt:now,lines:lines.map((line,index)=>({...line,lineId:'RGAL-' + id + '-' + (index+1),receivedQty:0}))};
   customerReturns.push(row);await persistRgaStore();return json(res,201,serializeRga(row));
 }
 if(method==='PUT'&&/^\/api\/rga\/[^/]+$/.test(pathname)){
   const id=decodeURIComponent(pathname.split('/').pop()),row=rgaFind(id);if(!row)return json(res,404,{error:'RGA not found'});if(row.status!=='Draft')return json(res,400,{error:'Only Draft RGAs can be edited.'});
   const b=await body(req),invoice=rgaInvoice(row);if(!invoice)return json(res,400,{error:'Original invoice not found.'});
   row.lines=rgaBuildLines(invoice,b.lines||row.lines,row.id).map((line,index)=>({...line,lineId:row.lines?.[index]?.lineId||('RGAL-' + row.id + '-' + (index+1)),receivedQty:Number(row.lines?.[index]?.receivedQty||0)}));
   if(b.reason!==undefined)row.reason=String(b.reason||'Customer Return');if(b.notes!==undefined)row.notes=String(b.notes||'');row.updatedAt=new Date().toISOString();await persistRgaStore();return json(res,200,serializeRga(row));
 }
 if(method==='POST'&&/^\/api\/rga\/[^/]+\/approve$/.test(pathname)){
   const id=decodeURIComponent(pathname.split('/').at(-2)),row=rgaFind(id);if(!row)return json(res,404,{error:'RGA not found'});if(row.status!=='Draft')return json(res,400,{error:'Only Draft RGAs can be approved.'});
   validateRgaApproval(row);row.status='Awaiting Return';row.approvedAt=new Date().toISOString();row.approvedBy=currentUser(req)?.id||'admin';row.updatedAt=row.approvedAt;await persistRgaStore();return json(res,200,serializeRga(row));
 }
 if(method==='POST'&&/^\/api\/rga\/[^/]+\/cancel$/.test(pathname)){
   const id=decodeURIComponent(pathname.split('/').at(-2)),row=rgaFind(id);if(!row)return json(res,404,{error:'RGA not found'});if(row.creditMemoId)return json(res,400,{error:'An RGA with a credit memo cannot be cancelled.'});if(rgaReceipts.some(receipt=>receipt.rgaId===row.id))return json(res,400,{error:'An RGA with received product cannot be cancelled.'});
   row.status='Cancelled';row.cancelledAt=new Date().toISOString();row.updatedAt=row.cancelledAt;await persistRgaStore();return json(res,200,serializeRga(row));
 }
 if(method==='POST'&&/^\/api\/rga\/[^/]+\/receive$/.test(pathname)){
   const id=decodeURIComponent(pathname.split('/').at(-2)),row=rgaFind(id);if(!row)return json(res,404,{error:'RGA not found'});if(!['Awaiting Return','Partially Received'].includes(row.status))return json(res,400,{error:'RGA must be approved before receiving returned product.'});
   const b=await body(req),receivedOn=b.receiptDate||new Date().toISOString().slice(0,10),pp=periodFromDate(receivedOn),requested=Array.isArray(b.lines)?b.lines:[];if(!requested.length)return json(res,400,{error:'Select at least one returned line to receive.'});
   const prepared=[];for(const requestLine of requested){const line=row.lines.find(x=>x.lineId===requestLine.lineId);if(!line)throw new Error('Invalid RGA line.');const qty=Number(requestLine.quantity||requestLine.qtyReceived||0),remaining=rgaRemainingReceiptQty(line);if(qty<=0)continue;if(qty>remaining+1e-9)throw new Error((line.itemCode || 'Line') + ' receipt quantity cannot exceed ' + remaining + '.');const warehouse=requestLine.warehouse||'MAIN',location=requestLine.location||'MAIN-A1',disposition=requestLine.disposition||'Return to Stock',condition=requestLine.condition||'Good';const item=itemMaster.find(item=>item.code===line.itemCode),cost=itemCost(item);prepared.push({line,qty,warehouse,location,disposition,condition,item,cost});}
   if(!prepared.length)return json(res,400,{error:'Enter a receipt quantity greater than zero.'});
   const stockToReturn=prepared.filter(entry=>entry.disposition==='Return to Stock'&&isStockItem(entry.item));let jeReference='';if(stockToReturn.length){validateInventoryAndGlOpen(pp);const jeLines=[];for(const entry of stockToReturn){const inventoryAccount=requireAccount(entry.line.inventoryAccount||entry.item.inventoryAccount,'RGA inventory account'),cogsAccount=requireAccount(entry.line.cogsAccount||entry.item.cogsAccount,'RGA COGS account'),amount=Number(entry.cost||0)*Number(entry.qty||0);if(amount){jeLines.push({account:inventoryAccount,debit:amount,credit:0,sourceReference:row.id,description:'Returned inventory ' + row.id});jeLines.push({account:cogsAccount,debit:0,credit:amount,sourceReference:row.id,description:'Reverse COGS ' + row.id});}}if(jeLines.length)jeReference=createPostedJournal({module:'Inventory',description:'Customer return receipt ' + row.id,postPeriod:pp,transactionDate:receivedOn,sourceRef:row.id,lines:jeLines,createdBy:currentUser(req)?.id||'admin'});}
   const receiptId=rgaReceiptNumber(),receipt={id:receiptId,receiptNumber:receiptId,rgaId:row.id,invoiceId:row.invoiceId,customerId:row.customerId,receiptDate:receivedOn,postPeriod:pp,jeReference,createdAt:new Date().toISOString(),createdBy:currentUser(req)?.id||'admin',lines:[]};
   for(const entry of prepared){entry.line.receivedQty=Number(entry.line.receivedQty||0)+entry.qty;const receiptLine={lineId:entry.line.lineId,itemCode:entry.line.itemCode,quantity:entry.qty,warehouse:entry.warehouse,location:entry.location,disposition:entry.disposition,condition:entry.condition,unitCost:entry.cost};receipt.lines.push(receiptLine);if(entry.disposition==='Return to Stock'&&isStockItem(entry.item)){adjustInventoryBalance({itemId:entry.item.code,warehouse:entry.warehouse,location:entry.location,qtyIn:entry.qty,unitCost:entry.cost});createInvAudit({transactionType:'Customer Return',referenceNumber:receiptId,sourceModule:'RGA',sourceReference:row.id,itemId:entry.item.code,warehouse:entry.warehouse,location:entry.location,quantityIn:entry.qty,unitCost:entry.cost,postDate:receivedOn,postPeriod:pp,jeReference,createdBy:currentUser(req)?.id||'admin'});}}
   rgaReceipts.push(receipt);row.status=rgaReceiptComplete(row.lines)?'Received':'Partially Received';row.lastReceiptDate=receivedOn;row.updatedAt=new Date().toISOString();await persistRgaStore();return json(res,201,serializeRga(row));
 }
 if(method==='POST'&&/^\/api\/rga\/[^/]+\/credit$/.test(pathname)){
   const id=decodeURIComponent(pathname.split('/').at(-2)),row=rgaFind(id);if(!row)return json(res,404,{error:'RGA not found'});if(!rgaReceiptComplete(row.lines||[]))return json(res,400,{error:'All authorized return quantities must be received before the RGA credit is finalized.'});
   const b=await body(req),transactionDate=b.date||new Date().toISOString().slice(0,10);let credit=rgaCreditMemo(row);if(!credit){credit=createRgaCreditDocument(row,transactionDate);arDocuments.push(credit);row.creditMemoId=credit.id;row.status='Credit Pending';}
   if(b.post!==false&&!credit.posted){validateSourceAndGlOpen('AR',credit.postPeriod||periodFromDate(transactionDate));postJE(credit,false);credit.posted=true;normalizeArStatus(credit);}
   const application=credit.posted&&b.apply!==false?applyRgaCredit(row,credit,transactionDate):{appliedAmount:0,invoiceBalance:Number(rgaInvoice(row)?.balance||0),creditBalance:Number(credit.balance||0)};
   row.creditedAt=credit.posted?new Date().toISOString():row.creditedAt;row.status=credit.posted?'Closed':'Credit Pending';row.updatedAt=new Date().toISOString();await persistRgaStore();return json(res,200,{rga:serializeRga(row),application,paidInvoice:Number(rgaInvoice(row)?.balance||0)<=0&&application.appliedAmount===0});
 }
 `;
  source = replaceOnce(source, routeMarker, routes + '\n ' + routeMarker, 'RGA API route marker');
  return source;
}

export async function prepareRgaWorkflowServer(inputModule = './server.js') {
  const inputPath = path.isAbsolute(inputModule) ? inputModule : path.join(here, String(inputModule).replace(/^\.\//, ''));
  const source = await readFile(inputPath, 'utf8');
  const patched = applyRgaWorkflowPatch(source);
  await writeFile(generatedPath, patched, 'utf8');
  return './' + generatedName;
}
