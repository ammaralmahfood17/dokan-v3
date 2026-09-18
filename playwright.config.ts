import { defineConfig } from '@playwright/test';

/**
 * E2E against PRODUCTION (dokanstore.xyz) — the real money path.
 * Tests create an isolated test store (unique slug) and clean up after
 * themselves (orders, tables, products, store, auth user).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'https://dokanstore.xyz',
    viewport: { width: 390, height: 844 },
    locale: 'ar-BH',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
