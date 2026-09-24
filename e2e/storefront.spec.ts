import { test, expect } from '@playwright/test';
import { E2E_BASE_URL } from './helpers';

/**
 * Storefront root page — public gateway for merchants to share their store.
 * Read-only: never touches estikana data.
 */
test.describe('Storefront root page', () => {
  test('existing store /estikana redirects to menu (single table)', async ({ page }) => {
    await page.goto(`${E2E_BASE_URL}/estikana`);
    await page.waitForURL(/\/estikana\/menu\//);
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('unknown store slug returns 404', async ({ page }) => {
    const res = await page.goto(`${E2E_BASE_URL}/no-such-store-zzz9`);
    expect(res?.status()).toBe(404);
  });

  test('deleted store (dar-salam) returns 404', async ({ page }) => {
    const res = await page.goto(`${E2E_BASE_URL}/dar-salam`);
    expect(res?.status()).toBe(404);
  });

  test('www subdomain redirects to apex canonical', async ({ request }) => {
    const res = await request.get('https://www.dokanstore.xyz/', { maxRedirects: 0 });
    expect([301, 308]).toContain(res.status());
  });
});
