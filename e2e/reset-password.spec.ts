import { test, expect } from '@playwright/test';
import {
  createTestUser,
  cleanupTestUser,
  getAuthCookies,
  makeEmail,
  TEST_PASSWORD,
  admin,
  url,
  anonKey,
} from './helpers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Password recovery flow — the one auth path that had zero e2e coverage.
 * Uses the admin API to mint a REAL recovery link (same shape the email
 * sends, without needing an inbox), walks the browser through it, sets a
 * new password, verifies the NEW password logs in and the OLD one no longer
 * works. Also verifies the reset endpoint itself (rate-limited, never
 * reveals account existence).
 */
test.describe.configure({ mode: 'serial' });

const email = makeEmail();
let userId: string;

test.beforeAll(async () => {
  await cleanupTestUser(email);
  const user = await createTestUser(email);
  userId = user.id;
});

test.afterAll(async () => {
  await cleanupTestUser(email);
});

test('reset endpoint: rate-limited, no account enumeration', async () => {
  // First request → success (regardless of whether the account exists,
  // to avoid enumeration).
  const res1 = await fetch(`https://dokanstore.xyz/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  expect(res1.status).toBe(200);

  // Non-existent account → ALSO success (no enumeration).
  const res2 = await fetch(`https://dokanstore.xyz/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'does-not-exist-xyz@dokan.test' }),
  });
  expect(res2.status).toBe(200);

  // Second request for the SAME email within the window → still allowed
  // (limit is 2 per email / 5 min).
  const res2b = await fetch(`https://dokanstore.xyz/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  expect(res2b.status).toBe(200);

  // Third request for the same email → rate limited (2 per email / 5 min).
  const res3 = await fetch(`https://dokanstore.xyz/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  expect(res3.status).toBe(429);
});

test('recovery link → set new password → new password works, old does not', async ({ page, context }) => {
  const newPassword = `${TEST_PASSWORD}-new2`;

  // 1. Mint a REAL recovery link via the admin API (what the email contains).
  // options.redirectTo IS honored (prod Site URL + allow list now include
  // dokanstore.xyz — verified live; previously the link landed on a 404
  // preview domain). The app redirects straight to /update-password because
  // the session arrives in the URL fragment (server callback would drop it).
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: 'https://www.dokanstore.xyz/update-password' },
  });
  expect(linkErr, linkErr?.message).toBeNull();
  const actionLink = link?.properties?.action_link;
  expect(actionLink).toBeTruthy();

  // 2. Open the recovery link in a fresh browser (no prior session).
  const ctx = await context.browser()!.newContext();
  const page2 = await ctx.newPage();
  await page2.goto(actionLink!);
  await page2.waitForURL('**/update-password**', { timeout: 20_000 });

  // 3. Set the new password.
  const pwdInputs = page2.locator('input[type="password"]');
  await expect(pwdInputs.first()).toBeVisible({ timeout: 15_000 });
  await pwdInputs.nth(0).fill(newPassword);
  if ((await pwdInputs.count()) > 1) {
    await pwdInputs.nth(1).fill(newPassword);
  }
  await page2.getByRole('button', { name: /حفظ كلمة المرور الجديدة/ }).click();
  await expect(page2.getByText('تم تحديث كلمة المرور').first()).toBeVisible({ timeout: 15_000 });
  await ctx.close();

  // 4. NEW password signs in.
  const client = createClient(url, anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: okErr } = await client.auth.signInWithPassword({ email, password: newPassword });
  expect(okErr, okErr?.message).toBeNull();

  // 5. OLD password no longer works.
  const stale = createClient(url, anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: badErr } = await stale.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  expect(badErr).toBeTruthy();
});
