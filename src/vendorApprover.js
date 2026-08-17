export function backfillVendorApprovers(vendors, defaultUserId) {
  if (!defaultUserId) throw new Error('A default ERP user is required');
  for (const vendor of vendors) if (!vendor.approverUserId) vendor.approverUserId = defaultUserId;
  return vendors;
}

export function transactionApproverId({ overrideUserId = '', vendor } = {}) {
  return overrideUserId || vendor?.approverUserId || '';
}
