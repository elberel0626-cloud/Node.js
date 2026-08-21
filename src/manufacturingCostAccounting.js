const EVENT_TYPES = Object.freeze({
  MATERIAL_ISSUE: 'MATERIAL_ISSUE',
  MATERIAL_RETURN: 'MATERIAL_RETURN',
  LABOR: 'LABOR',
  OVERHEAD: 'OVERHEAD',
  COMPLETION: 'COMPLETION',
  SCRAP: 'SCRAP',
  CLOSE_VARIANCE: 'CLOSE_VARIANCE'
});

export const MANUFACTURING_EVENT_TYPES = EVENT_TYPES;

// Defaults align to the ERP's actual chart of accounts:
// 1507 Raw Inventory, 1508 WIP, 1509 Finished Goods,
// 5101 Capitalized Labor & OH Adjustments, 5109 Inventory Adjustments.
export const DEFAULT_MANUFACTURING_ACCOUNTS = Object.freeze({
  wipInventory: '1508',
  finishedGoodsInventory: '1509',
  directLaborClearing: '5101',
  manufacturingOverheadClearing: '5101',
  manufacturingVariance: '5109',
  scrapExpense: '5109'
});

const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const finiteNumber = (value, field, { allowZero = false } = {}) => {
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) {
    throw new TypeError(`${field} must be a ${allowZero ? 'non-negative' : 'positive'} number.`);
  }
  return number;
};
const required = (value, field) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${field} is required.`);
  return normalized;
};
const account = (value, field) => required(value, field);
const money = value => roundMoney(finiteNumber(value, 'amount'));

function glLine({ account: accountCode, debit = 0, credit = 0, description, dimensions }) {
  return {
    account: account(accountCode, 'GL account'),
    debit: roundMoney(debit),
    credit: roundMoney(credit),
    description,
    ...dimensions
  };
}

function assertBalanced(lines) {
  const debit = roundMoney(lines.reduce((sum, line) => sum + Number(line.debit || 0), 0));
  const credit = roundMoney(lines.reduce((sum, line) => sum + Number(line.credit || 0), 0));
  if (debit !== credit) throw new Error(`Manufacturing posting is out of balance: debit ${debit}, credit ${credit}.`);
  return { debit, credit };
}

function postingEnvelope(event, glLines, inventoryMovements = []) {
  const workOrderId = required(event.workOrderId, 'workOrderId');
  const postDate = required(event.postDate, 'postDate');
  const totals = assertBalanced(glLines);
  return {
    sourceModule: 'Manufacturing',
    sourceType: event.type,
    sourceId: event.sourceId || `${workOrderId}:${event.type}:${postDate}`,
    workOrderId,
    branch: event.branch || '',
    postDate,
    postPeriod: event.postPeriod || postDate.slice(0, 7),
    glLines,
    inventoryMovements,
    totals,
    metadata: { ...(event.metadata || {}) }
  };
}

function dimensions(event) {
  return {
    branch: event.branch || '',
    department: event.department || 'Manufacturing',
    workOrderId: required(event.workOrderId, 'workOrderId'),
    costCenter: event.costCenter || '',
    projectId: event.projectId || ''
  };
}

/**
 * Convert a manufacturing event into balanced GL lines and inventory movements.
 * The function is intentionally pure so the server can validate the posting before
 * mutating inventory, WIP, journal, or work-order state.
 */
export function buildManufacturingPosting(event, options = {}) {
  if (!event || typeof event !== 'object') throw new TypeError('event is required.');
  const type = required(event.type, 'type').toUpperCase();
  if (!Object.values(EVENT_TYPES).includes(type)) throw new RangeError(`Unsupported manufacturing event type: ${type}.`);
  const accounts = { ...DEFAULT_MANUFACTURING_ACCOUNTS, ...(options.accounts || {}), ...(event.accounts || {}) };
  const dims = dimensions(event);
  const description = event.description || `${event.workOrderId} ${type.replaceAll('_', ' ').toLowerCase()}`;

  if (type === EVENT_TYPES.MATERIAL_ISSUE || type === EVENT_TYPES.MATERIAL_RETURN) {
    const itemCode = required(event.itemCode, 'itemCode');
    const quantity = finiteNumber(event.quantity, 'quantity');
    const unitCost = finiteNumber(event.unitCost, 'unitCost', { allowZero: true });
    const amount = roundMoney(quantity * unitCost);
    if (amount <= 0) throw new TypeError('Material posting amount must be positive.');
    const inventoryAccount = account(event.inventoryAccount || event.item?.inventoryAccount, 'inventoryAccount');
    const wipAccount = account(event.wipAccount || accounts.wipInventory, 'wipAccount');
    const isIssue = type === EVENT_TYPES.MATERIAL_ISSUE;
    const glLines = isIssue
      ? [glLine({ account: wipAccount, debit: amount, description, dimensions: dims }), glLine({ account: inventoryAccount, credit: amount, description, dimensions: dims })]
      : [glLine({ account: inventoryAccount, debit: amount, description, dimensions: dims }), glLine({ account: wipAccount, credit: amount, description, dimensions: dims })];
    const movement = {
      itemCode,
      quantity: isIssue ? -quantity : quantity,
      unitCost: roundMoney(unitCost),
      extendedCost: isIssue ? -amount : amount,
      warehouse: required(event.warehouse, 'warehouse'),
      location: event.location || '',
      offsetWarehouse: event.wipWarehouse || 'PROD',
      offsetLocation: event.wipLocation || 'PROD-WIP',
      movementType: isIssue ? 'Issue to Production' : 'Return from Production',
      workOrderId: dims.workOrderId
    };
    return postingEnvelope({ ...event, type }, glLines, [movement]);
  }

  if (type === EVENT_TYPES.LABOR) {
    const hours = finiteNumber(event.hours, 'hours');
    const laborRate = finiteNumber(event.laborRate, 'laborRate', { allowZero: true });
    const amount = roundMoney(hours * laborRate);
    if (amount <= 0) throw new TypeError('Labor posting amount must be positive.');
    const wipAccount = account(event.wipAccount || accounts.wipInventory, 'wipAccount');
    const clearingAccount = account(event.laborClearingAccount || accounts.directLaborClearing, 'laborClearingAccount');
    return postingEnvelope({ ...event, type }, [
      glLine({ account: wipAccount, debit: amount, description, dimensions: dims }),
      glLine({ account: clearingAccount, credit: amount, description, dimensions: dims })
    ]);
  }

  if (type === EVENT_TYPES.OVERHEAD) {
    const amount = money(event.amount);
    const wipAccount = account(event.wipAccount || accounts.wipInventory, 'wipAccount');
    const clearingAccount = account(event.overheadClearingAccount || accounts.manufacturingOverheadClearing, 'overheadClearingAccount');
    return postingEnvelope({ ...event, type }, [
      glLine({ account: wipAccount, debit: amount, description, dimensions: dims }),
      glLine({ account: clearingAccount, credit: amount, description, dimensions: dims })
    ]);
  }

  if (type === EVENT_TYPES.COMPLETION) {
    const itemCode = required(event.itemCode, 'itemCode');
    const quantity = finiteNumber(event.quantity, 'quantity');
    const unitCost = finiteNumber(event.unitCost, 'unitCost', { allowZero: true });
    const amount = roundMoney(quantity * unitCost);
    if (amount <= 0) throw new TypeError('Completion posting amount must be positive.');
    const finishedGoodsAccount = account(event.finishedGoodsAccount || event.item?.inventoryAccount || accounts.finishedGoodsInventory, 'finishedGoodsAccount');
    const wipAccount = account(event.wipAccount || accounts.wipInventory, 'wipAccount');
    return postingEnvelope({ ...event, type }, [
      glLine({ account: finishedGoodsAccount, debit: amount, description, dimensions: dims }),
      glLine({ account: wipAccount, credit: amount, description, dimensions: dims })
    ], [{
      itemCode,
      quantity,
      unitCost: roundMoney(unitCost),
      extendedCost: amount,
      warehouse: event.warehouse || 'MAIN',
      location: event.location || '',
      sourceWarehouse: event.wipWarehouse || 'PROD',
      sourceLocation: event.wipLocation || 'PROD-WIP',
      movementType: 'Production Receipt',
      workOrderId: dims.workOrderId
    }]);
  }

  if (type === EVENT_TYPES.SCRAP) {
    const amount = money(event.amount);
    const wipAccount = account(event.wipAccount || accounts.wipInventory, 'wipAccount');
    const scrapAccount = account(event.scrapExpenseAccount || accounts.scrapExpense, 'scrapExpenseAccount');
    return postingEnvelope({ ...event, type }, [
      glLine({ account: scrapAccount, debit: amount, description, dimensions: dims }),
      glLine({ account: wipAccount, credit: amount, description, dimensions: dims })
    ], event.itemCode && event.quantity ? [{
      itemCode: required(event.itemCode, 'itemCode'),
      quantity: -finiteNumber(event.quantity, 'quantity'),
      unitCost: roundMoney(amount / finiteNumber(event.quantity, 'quantity')),
      extendedCost: -amount,
      warehouse: event.wipWarehouse || 'PROD',
      location: event.wipLocation || 'PROD-WIP',
      movementType: 'Production Scrap',
      workOrderId: dims.workOrderId,
      reasonCode: event.reasonCode || 'SCRAP'
    }] : []);
  }

  const signedVariance = Number(event.varianceAmount);
  if (!Number.isFinite(signedVariance) || signedVariance === 0) throw new TypeError('varianceAmount must be a non-zero number.');
  const varianceAmount = roundMoney(Math.abs(signedVariance));
  const wipAccount = account(event.wipAccount || accounts.wipInventory, 'wipAccount');
  const varianceAccount = account(event.varianceAccount || accounts.manufacturingVariance, 'varianceAccount');
  // Positive variance = actual cost exceeds absorbed/standard cost: debit variance, credit WIP.
  const glLines = signedVariance > 0
    ? [glLine({ account: varianceAccount, debit: varianceAmount, description, dimensions: dims }), glLine({ account: wipAccount, credit: varianceAmount, description, dimensions: dims })]
    : [glLine({ account: wipAccount, debit: varianceAmount, description, dimensions: dims }), glLine({ account: varianceAccount, credit: varianceAmount, description, dimensions: dims })];
  return postingEnvelope({ ...event, type, metadata: { ...(event.metadata || {}), varianceAmount: signedVariance, wipAccount } }, glLines);
}

export function summarizeManufacturingPostings(postings = []) {
  if (!Array.isArray(postings)) throw new TypeError('postings must be an array.');
  const summary = {
    materialIssued: 0,
    materialReturned: 0,
    directLabor: 0,
    overhead: 0,
    completed: 0,
    scrap: 0,
    closeVariance: 0,
    wipBalance: 0
  };
  for (const posting of postings) {
    const type = posting?.sourceType;
    const amount = Number(posting?.totals?.debit || 0);
    if (!Number.isFinite(amount)) throw new TypeError('Posting totals must contain a numeric debit amount.');
    if (type === EVENT_TYPES.MATERIAL_ISSUE) summary.materialIssued += amount;
    else if (type === EVENT_TYPES.MATERIAL_RETURN) summary.materialReturned += amount;
    else if (type === EVENT_TYPES.LABOR) summary.directLabor += amount;
    else if (type === EVENT_TYPES.OVERHEAD) summary.overhead += amount;
    else if (type === EVENT_TYPES.COMPLETION) summary.completed += amount;
    else if (type === EVENT_TYPES.SCRAP) summary.scrap += amount;
    else if (type === EVENT_TYPES.CLOSE_VARIANCE) {
      const signedVariance = Number(posting?.metadata?.varianceAmount);
      if (!Number.isFinite(signedVariance) || signedVariance === 0) throw new TypeError('Close variance posting is missing variance metadata.');
      summary.closeVariance += signedVariance;
    }
  }
  Object.keys(summary).forEach(key => { summary[key] = roundMoney(summary[key]); });
  summary.wipBalance = roundMoney(summary.materialIssued - summary.materialReturned + summary.directLabor + summary.overhead - summary.completed - summary.scrap - summary.closeVariance);
  return summary;
}

export function buildWorkOrderCloseVarianceEvent({ workOrderId, postDate, postings, ...dimensionsInput }) {
  const summary = summarizeManufacturingPostings(postings);
  if (summary.wipBalance === 0) return null;
  return {
    type: EVENT_TYPES.CLOSE_VARIANCE,
    workOrderId: required(workOrderId, 'workOrderId'),
    postDate: required(postDate, 'postDate'),
    varianceAmount: summary.wipBalance,
    description: `${workOrderId} close manufacturing variance`,
    metadata: { costSummary: summary },
    ...dimensionsInput
  };
}

export function validateManufacturingPosting(posting) {
  if (!posting || posting.sourceModule !== 'Manufacturing') throw new TypeError('Manufacturing posting is required.');
  required(posting.workOrderId, 'workOrderId');
  required(posting.postDate, 'postDate');
  if (!Array.isArray(posting.glLines) || posting.glLines.length !== 2) throw new Error('Manufacturing postings must contain exactly two GL lines.');
  assertBalanced(posting.glLines);
  for (const movement of posting.inventoryMovements || []) {
    required(movement.itemCode, 'inventory movement itemCode');
    if (!Number.isFinite(Number(movement.quantity)) || Number(movement.quantity) === 0) throw new TypeError('Inventory movement quantity must be non-zero.');
  }
  return true;
}
