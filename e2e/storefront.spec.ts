import { test, expect } from '@playwright/test';
import { E2E_BASE_URL } from './helpers';

/**
 * Storefront root page — public gateway for merchants to share their store.
 * Read-only: never touches dar-salam or estikana data.
 *
 * D3: /[projectSlug] → 200 with store name, /404-slug → 404
 */
test.describe('Storefront root page', () => {
  test('existing store /estikana returns 200 with store name', async ({ page }) => {
    const res = await page.goto(`${E2E_BASE_URL}/estikana`);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1')).toContainText('استراحة كانا');
  });

  test('existing store /dar-salam redirects to its menu (single table)', async ({ page }) => {
    // dar-salam has at least 1 table → should redirect to /dar-salam/menu/<slug>
    const res = await page.goto(`${E2E_BASE_URL}/dar-salam`);
    // Redirect means status 200 on the final page, but URL will have changed
    await page.waitForURL(/\/dar-salam\/menu\//);
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('unknown store slug returns 404', async ({ page }) => {
    const res = await page.goto(`${E2E_BASE_URL}/no-such-store-zzz9`);
    expect(res?.status()).toBe(404);
  });

  test('www subdomain redirects to apex canonical', async ({ request }) => {
    // A2: www → 308 redirect to apex (verified on deployed prod)
    const res = await request.get('https://www.dokanstore.xyz/', {
      maxRedirects: 0,
    });
    // 308 or 301 — either is a valid permanent redirect
    expect([301, 308]).toContain(res.status());
  });
});