import { test as base, expect } from '@playwright/test';

async function authenticate(page) {
  const email=process.env.E2E_ADMIN_EMAIL;
  const password=process.env.E2E_ADMIN_PASSWORD;
  if(!email||!password) throw new Error('E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are required for authenticated E2E tests');

  await page.goto('/');
  await expect(page.locator('#login-screen')).toBeVisible();
  await page.locator('#username').fill(email);
  await page.locator('#password').fill(password);
  const loginResponse=page.waitForResponse(response=>response.url().endsWith('/api/auth/login')&&response.request().method()==='POST');
  await page.locator('#login-form button').click();
  const login=await loginResponse;
  expect(login.status(),'POST /api/auth/login must return HTTP 200').toBe(200);

  const session=await page.request.get('/api/auth/session');
  expect(session.status(),'GET /api/auth/session must confirm authentication').toBe(200);
  expect((await session.json()).authenticated,'server session must be authenticated').toBe(true);
  await expect(page.locator('#login-screen')).toBeHidden();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#view')).not.toBeEmpty();
  const cookies=await page.context().cookies();
  expect(cookies.some(cookie=>cookie.name==='__Host-erp_session'&&cookie.httpOnly&&cookie.value),'server session cookie was not created').toBe(true);
}

export const test=base.extend({
  page: async({page},use)=>{ await authenticate(page); await use(page); }
});
export { expect };

export async function openView(page,path,ready='#view') {
  const response=await page.goto(path);
  expect(response?.ok(),`navigation to ${path} failed`).toBe(true);
  await expect(page.locator('#login-screen')).toBeHidden();
  await expect(page.locator(ready)).toBeVisible();
  await expect(page.locator('#view')).not.toBeEmpty();
}
