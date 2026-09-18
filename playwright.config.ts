import { defineConfig } from '@playwright/test';

/**
 * E2E against the v3 PRODUCTION deploy (override with E2E_BASE_URL) — the
 * real money path. Never point this at dokanstore.xyz: that is v2's live DB.
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
    baseURL: process.env.E2E_BASE_URL || 'https://dokan-v3.vercel.app',
    viewport: { width: 390, height: 844 },
    locale: 'ar-BH',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } }],
});
