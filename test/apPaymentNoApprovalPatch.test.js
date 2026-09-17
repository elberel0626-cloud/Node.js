import test from 'node:test';
import assert from 'node:assert/strict';
import { applyApPaymentNoApprovalPatch } from '../src/apPaymentNoApprovalPatch.js';

test('normal AP payments are marked Not Required while prepayments still require approval', () => {
  const source = `function syncApPaymentReview(doc){
  if(!doc||!['Payment','Prepayment'].includes(doc.type)) return doc;
  const applied=(doc.applications||[]).reduce((t,a)=>t+Number(a.amount||a.amountPaid||0),0);
  doc.appliedAmount=applied;
  doc.unappliedBalance=Math.max(0,Number(doc.amount||0)-applied);
  doc.balance=doc.unappliedBalance;
  if(!doc.paymentApprovalStatus) doc.paymentApprovalStatus=doc.type==='Prepayment'?'Pending Payment Approval':(Number(doc.amount||0)>=Number(apApprovalThresholds.paymentControllerThreshold||25000)?'Pending Payment Approval':'Not Required');
  return doc;
}
if(['Payment','Prepayment'].includes(doc.type)){syncApPaymentReview(doc);const payStatus=doc.paymentApprovalStatus||'Not Required';if(payStatus==='Pending Payment Approval')throw apPostingBusinessError('Payment batch requires payment approval before posting.');}`;

  const patched = applyApPaymentNoApprovalPatch(source);
  assert.match(patched, /doc\.type==='Payment'\) doc\.paymentApprovalStatus='Not Required'/);
  assert.doesNotMatch(patched, /paymentControllerThreshold/);
  assert.match(patched, /else if\(!doc\.paymentApprovalStatus\) doc\.paymentApprovalStatus='Pending Payment Approval'/);
  assert.match(patched, /Payment batch requires payment approval before posting/);
});
