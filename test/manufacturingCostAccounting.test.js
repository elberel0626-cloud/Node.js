import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MANUFACTURING_EVENT_TYPES,
  buildManufacturingPosting,
  buildWorkOrderCloseVarianceEvent,
  summarizeManufacturingPostings,
  validateManufacturingPosting
} from '../src/manufacturingCostAccounting.js';

const base = { workOrderId:'WO-1001', postDate:'2026-08-21', branch:'100' };

test('material issue debits WIP, credits raw material inventory, and reduces stock', () => {
  const posting = buildManufacturingPosting({
    ...base,
    type: MANUFACTURING_EVENT_TYPES.MATERIAL_ISSUE,
    itemCode:'ITEM-1001', quantity:4, unitCost:80,
    inventoryAccount:'1507', wipAccount:'1510', warehouse:'MAIN', location:'MAIN-A1'
  });
  assert.equal(posting.totals.debit, 320);
  assert.deepEqual(posting.glLines.map(l => [l.account,l.debit,l.credit]), [['1510',320,0],['1507',0,320]]);
  assert.equal(posting.inventoryMovements[0].quantity, -4);
  assert.equal(posting.inventoryMovements[0].offsetWarehouse, 'PROD');
  assert.equal(validateManufacturingPosting(posting), true);
});

test('material return reverses the issue accounting and restores stock', () => {
  const posting = buildManufacturingPosting({
    ...base,
    type:'MATERIAL_RETURN', itemCode:'ITEM-1001', quantity:1.5, unitCost:80,
    inventoryAccount:'1507', wipAccount:'1510', warehouse:'MAIN'
  });
  assert.deepEqual(posting.glLines.map(l => [l.account,l.debit,l.credit]), [['1507',120,0],['1510',0,120]]);
  assert.equal(posting.inventoryMovements[0].quantity, 1.5);
});

test('labor and overhead are absorbed into WIP through clearing accounts', () => {
  const labor = buildManufacturingPosting({ ...base, type:'LABOR', hours:3.25, laborRate:32, wipAccount:'1510', laborClearingAccount:'2200' });
  const overhead = buildManufacturingPosting({ ...base, type:'OVERHEAD', amount:55.5, wipAccount:'1510', overheadClearingAccount:'5200' });
  assert.equal(labor.totals.debit, 104);
  assert.deepEqual(labor.glLines.map(l=>l.account), ['1510','2200']);
  assert.equal(overhead.totals.debit, 55.5);
  assert.deepEqual(overhead.glLines.map(l=>l.account), ['1510','5200']);
});

test('production completion moves absorbed cost from WIP to finished goods', () => {
  const posting = buildManufacturingPosting({
    ...base, type:'COMPLETION', itemCode:'ITEM-1003', quantity:10, unitCost:30,
    finishedGoodsAccount:'1507', wipAccount:'1510', warehouse:'MAIN', location:'MAIN-A2'
  });
  assert.deepEqual(posting.glLines.map(l => [l.account,l.debit,l.credit]), [['1507',300,0],['1510',0,300]]);
  assert.equal(posting.inventoryMovements[0].quantity, 10);
  assert.equal(posting.inventoryMovements[0].movementType, 'Production Receipt');
});

test('scrap relieves WIP to scrap expense and records a production scrap movement', () => {
  const posting = buildManufacturingPosting({
    ...base, type:'SCRAP', amount:45, itemCode:'ITEM-1003', quantity:1.5,
    wipAccount:'1510', scrapExpenseAccount:'5109'
  });
  assert.deepEqual(posting.glLines.map(l => [l.account,l.debit,l.credit]), [['5109',45,0],['1510',0,45]]);
  assert.equal(posting.inventoryMovements[0].quantity, -1.5);
  assert.equal(posting.inventoryMovements[0].unitCost, 30);
});

test('work-order summary calculates remaining WIP and creates close variance', () => {
  const postings = [
    buildManufacturingPosting({ ...base, type:'MATERIAL_ISSUE', itemCode:'RM', quantity:10, unitCost:10, inventoryAccount:'1507', wipAccount:'1510', warehouse:'MAIN' }),
    buildManufacturingPosting({ ...base, type:'LABOR', hours:2, laborRate:25, wipAccount:'1510', laborClearingAccount:'2200' }),
    buildManufacturingPosting({ ...base, type:'OVERHEAD', amount:20, wipAccount:'1510', overheadClearingAccount:'5200' }),
    buildManufacturingPosting({ ...base, type:'COMPLETION', itemCode:'FG', quantity:5, unitCost:30, finishedGoodsAccount:'1507', wipAccount:'1510' })
  ];
  const summary = summarizeManufacturingPostings(postings);
  assert.equal(summary.materialIssued, 100);
  assert.equal(summary.directLabor, 50);
  assert.equal(summary.overhead, 20);
  assert.equal(summary.completed, 150);
  assert.equal(summary.wipBalance, 20);

  const closeEvent = buildWorkOrderCloseVarianceEvent({ ...base, postings, wipAccount:'1510', varianceAccount:'5109' });
  const closePosting = buildManufacturingPosting(closeEvent);
  assert.deepEqual(closePosting.glLines.map(l => [l.account,l.debit,l.credit]), [['5109',20,0],['1510',0,20]]);
  const finalSummary = summarizeManufacturingPostings([...postings, closePosting]);
  assert.equal(finalSummary.wipBalance, 0);
});

test('favorable close variance debits WIP and credits manufacturing variance', () => {
  const posting = buildManufacturingPosting({ ...base, type:'CLOSE_VARIANCE', varianceAmount:-12.34, wipAccount:'1510', varianceAccount:'5109' });
  assert.deepEqual(posting.glLines.map(l => [l.account,l.debit,l.credit]), [['1510',12.34,0],['5109',0,12.34]]);
});

test('invalid or incomplete manufacturing events fail before posting', () => {
  assert.throws(() => buildManufacturingPosting({ ...base, type:'MATERIAL_ISSUE', itemCode:'RM', quantity:0, unitCost:10, inventoryAccount:'1507', warehouse:'MAIN' }), /quantity must be a positive number/);
  assert.throws(() => buildManufacturingPosting({ ...base, type:'UNKNOWN' }), /Unsupported manufacturing event type/);
  assert.throws(() => buildManufacturingPosting({ ...base, type:'COMPLETION', itemCode:'FG', quantity:1, unitCost:0 }), /Completion posting amount must be positive/);
});
