import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ALL_PERMISSIONS, ROLE_PERMISSIONS } from '../src/security.js';
import { BUSINESS_ROUTE_PERMISSIONS, routePermission } from '../src/routePermissions.js';

test('every registered static business API route has an explicit method and permission mapping',async()=>{
  const source=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
  const registered=[...source.matchAll(/method==='(GET|POST|PUT|PATCH|DELETE)'&&pathname(?:===|\.startsWith\()'([^']+)'/g)]
    .map(([,method,path])=>({method,path:path.endsWith('/')?`${path}route-id`:path}))
    .filter(({path})=>path.startsWith('/api/')&&!path.startsWith('/api/auth/')&&path!=='/api/health');
  const missing=registered.filter(({method,path})=>!routePermission(method,path));
  assert.deepEqual(missing,[],`unmapped registered routes: ${JSON.stringify(missing)}`);
  assert.equal(routePermission('GET','/api/not-a-business-route'),null);
});
test('permission inventory is valid and Admin includes every mapped permission',()=>{const admin=new Set(ROLE_PERMISSIONS.Admin);for(const [methods,path,permission] of BUSINESS_ROUTE_PERMISSIONS){assert.ok(methods.length);assert.ok(path instanceof RegExp);assert.ok(ALL_PERMISSIONS.includes(permission));assert.ok(admin.has(permission));}});
test('AP users may submit bills while approval actions remain assignment-authorized',()=>{
  assert.equal(routePermission('POST','/api/ap/documents/BILL-1001/submit-approval'),'AP_BILL_SUBMIT');
  assert.equal(routePermission('POST','/api/ap/documents/BILL-1001/approval-action'),'AP_BILL_READ');
  assert.equal(routePermission('POST','/api/ap/documents/post'),'AP_BILL_POST');
  assert.ok(ROLE_PERMISSIONS['AP Clerk'].includes('AP_BILL_POST'));
  assert.ok(ROLE_PERMISSIONS['AP Manager'].includes('AP_BILL_POST'));
});
