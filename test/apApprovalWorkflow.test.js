import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalStatus, assertBillPostable, NOT_SUBMITTED } from '../src/apApprovalWorkflow.js';

test('approval is optional for saved bills and existing bills default to not submitted', () => {
  assert.equal(approvalStatus({status:'Saved'}),NOT_SUBMITTED);
  assert.doesNotThrow(()=>assertBillPostable({status:'Saved'}));
  assert.doesNotThrow(()=>assertBillPostable({status:'Saved',approvalStatus:'Approved'}));
});

test('pending and rejected approval requests block posting with clear errors', () => {
  assert.throws(()=>assertBillPostable({status:'Saved',approvalStatus:'Pending Approval'}),/pending approval.*cannot be posted/i);
  assert.throws(()=>assertBillPostable({status:'Saved',approvalStatus:'Rejected'}),/rejected.*cannot be posted/i);
});

test('an approval assignment makes legacy status pending', () => {
  assert.equal(approvalStatus({status:'Saved',approvals:[{status:'Pending'}]}),'Pending Approval');
});
