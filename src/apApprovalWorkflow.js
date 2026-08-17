export const NOT_SUBMITTED = 'Not Submitted';
export const PENDING_POST = 'Pending Post';

export function approvalStatus(doc = {}) {
  if (doc.approvalStatus) return doc.approvalStatus;
  if ((doc.approvals || []).some(item => ['Pending', 'Information Requested'].includes(item.status))) return 'Pending Approval';
  return NOT_SUBMITTED;
}

export function assertBillPostable(doc = {}) {
  const status = approvalStatus(doc);
  if (status === 'Pending Approval' || status === 'Information Requested') {
    throw Object.assign(new Error('This bill is pending approval and cannot be posted until it is approved.'), { statusCode: 400 });
  }
  if (status === 'Rejected') throw Object.assign(new Error('This bill was rejected and cannot be posted until it is corrected and resubmitted or saved as not submitted.'), { statusCode: 400 });
  if (!['Saved', 'Approved', PENDING_POST].includes(doc.status)) throw Object.assign(new Error('Only saved or approved bills that are pending posting can be posted.'), { statusCode: 400 });
  return true;
}
