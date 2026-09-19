import { defineConfig } from '@playwright/test';

/**
 * E2E against the canonical production domain dokanstore.xyz (override with
 * E2E_BASE_URL) — the real money path. Tests create an isolated test store
 * (unique slug) and clean up after themselves.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://dokanstore.xyz',
    viewport: { width: 390, height: 844 },
    locale: 'ar-BH',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } }],
});
