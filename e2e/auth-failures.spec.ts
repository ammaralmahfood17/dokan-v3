import { test, expect } from '@playwright/test';
import { createTestUser, cleanupTestUser, makeEmail, TEST_PASSWORD } from './helpers';

/**
 * P2-6 — auth failure paths.
 *   1. Guest on a protected route → redirected to /login (with next param),
 *      never a 500.
 *   2. Wrong password on login → clean inline error, no crash, no leak.
 *   3. Staff-only API with no session → 401 (not 500).
 *   4. Garbage/expired session cookie → treated as guest (redirect), not a 500.
 */
test.describe.configure({ mode: 'serial' });

const email = makeEmail();

test.beforeAll(async () => {
  await createTestUser(email);
});

test.afterAll(async () => {
  await cleanupTestUser(email);
});

test('guest on protected route → redirect to login, not a 500', async ({ page }) => {
  const resp = await page.goto('/dashboard/orders');
  expect(resp?.status()).toBeLessThan(400);
  await page.waitForURL('**/login**', { timeout: 15_000 });
  expect(page.url()).toContain('next=');
});

test('wrong password → clean error, no crash', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', 'Definitely-wrong-999!');
  await page.getByRole('button', { name: 'دخول', exact: true }).first().click();
  // Either an error message appears, or we stay on /login — but never a 500.
  await expect(page.getByText(/خطأ|غير صحيح|فشل|غير مصرح/i).first()).toBeVisible({ timeout: 20_000 });
  expect(page.url()).not.toContain('/dashboard');
});

test('staff-only API without session → 401', async () => {
  const res = await fetch(`https://dokanstore.xyz/api/pos/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: '00000000-0000-0000-0000-000000000000' }),
  });
  expect(res.status).toBe(401);
});

test('garbage session cookie → treated as guest (redirect), not a 500', async ({ page, context }) => {
  // Inject a malformed session cookie for the app's cookie name.
  const cookieName = 'sb-smhleaeujwfebefjuwoe-auth-token';
  await context.addCookies([
    { name: cookieName, value: 'garbage-not-a-jwt', domain: 'dokanstore.xyz', path: '/' },
  ]);
  const resp = await page.goto('/dashboard');
  expect(resp?.status()).toBeLessThan(400);
  await page.waitForURL('**/login**', { timeout: 15_000 });
});
