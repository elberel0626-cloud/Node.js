import test from 'node:test';
import assert from 'node:assert/strict';
import { routePermission } from '../src/routePermissions.js';

test('AP matching can read eligible PO and receipt data without Purchasing edit permission',()=>{
  assert.equal(routePermission('GET','/api/purchase-orders/lookup'),'AP_BILL_READ');
  assert.equal(routePermission('GET','/api/purchase-orders/PO-1001'),'AP_BILL_READ');
  assert.equal(routePermission('GET','/api/purchase-receipts/lookup'),'AP_BILL_READ');
  assert.equal(routePermission('GET','/api/purchase-orders/reports/operational'),'AP_BILL_READ');
  assert.equal(routePermission('GET','/api/purchase-orders/preferences'),'AP_BILL_READ');
  assert.equal(routePermission('POST','/api/purchase-orders'),'PO_CREATE');
});
