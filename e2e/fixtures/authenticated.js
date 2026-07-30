import { test as base, expect } from '@playwright/test';

async function authenticate(page) {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are required for authenticated E2E tests');
  }

  await page.goto('/');
  await expect(page.locator('#login-screen')).toBeVisible();
  await page.locator('#username').fill(email);
  await page.locator('#password').fill(password);

  const loginResponsePromise = page.waitForResponse(response =>
    response.url().endsWith('/api/auth/login') && response.request().method() === 'POST'
  );
  await page.locator('#login-form button').click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status(), 'POST /api/auth/login must return HTTP 200').toBe(200);

  await expect.poll(async () => {
    const cookies = await page.context().cookies();
    return cookies.some(cookie =>
      cookie.name === '__Host-erp_session' && cookie.httpOnly && Boolean(cookie.value)
    );
  }, { message: 'server session cookie was not created' }).toBe(true);

  const session = await page.evaluate(async () => {
    const response = await fetch('/api/auth/session', {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    let body = null;
    try { body = await response.json(); } catch {}
    return { status: response.status, body };
  });
  expect(session.status, 'GET /api/auth/session must confirm authentication').toBe(200);
  expect(session.body?.authenticated, 'server session must be authenticated').toBe(true);

  await expect(page.locator('#login-screen')).toBeHidden();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#view')).not.toBeEmpty();
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await authenticate(page);
    await use(page);
  }
});
export { expect };

export async function openView(page, path, ready = '#view') {
  const response = await page.goto(path);
  expect(response?.ok(), `navigation to ${path} failed`).toBe(true);
  await expect(page.locator('#login-screen')).toBeHidden();
  await expect(page.locator(ready)).toBeVisible();
  await expect(page.locator('#view')).not.toBeEmpty();
}
