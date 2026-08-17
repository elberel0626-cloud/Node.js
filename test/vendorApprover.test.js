import test from 'node:test';
import assert from 'node:assert/strict';
import { backfillVendorApprovers, transactionApproverId } from '../src/vendorApprover.js';

test('existing vendors without an approver are backfilled without overwriting assignments', () => {
  const vendors=[{id:'A'},{id:'B',approverUserId:'user-b'}];
  backfillVendorApprovers(vendors,'current-user');
  assert.deepEqual(vendors,[{id:'A',approverUserId:'current-user'},{id:'B',approverUserId:'user-b'}]);
});

test('new transactions snapshot the vendor default and allow an independent override', () => {
  const vendor={id:'A',approverUserId:'approver-a'};
  const billOne={approverUserId:transactionApproverId({vendor})};
  vendor.approverUserId='approver-b';
  const billTwo={approverUserId:transactionApproverId({vendor})};
  assert.equal(billOne.approverUserId,'approver-a');
  assert.equal(billTwo.approverUserId,'approver-b');
  assert.equal(transactionApproverId({vendor,overrideUserId:'bill-override'}),'bill-override');
  assert.equal(vendor.approverUserId,'approver-b');
});
