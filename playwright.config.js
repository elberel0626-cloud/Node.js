import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  webServer: { command: 'npm start', url: 'http://127.0.0.1:3000', reuseExistingServer: true, timeout: 30_000, env: { APP_ORIGIN: 'http://127.0.0.1:3000', BOOTSTRAP_ADMIN_EMAIL: process.env.E2E_ADMIN_EMAIL || '', BOOTSTRAP_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD || '' } }
});
