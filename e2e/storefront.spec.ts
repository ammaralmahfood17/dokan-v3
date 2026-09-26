import { test, expect } from '@playwright/test';
import { admin, createTestUser, cleanupTestUser, E2E_BASE_URL, makeEmail } from './helpers';

/**
 * Storefront root page — public gateway for merchants to share their store.
 *
 * The redirect case is asserted against a store THIS FILE OWNS, with exactly
 * one active table. It used to point at the live `estikana` demo store, which
 * has two active tables — and the page only redirects when the count is
 * exactly 1 (src/app/[projectSlug]/page.tsx:54-56), so the assertion could
 * never hold and only passed while nothing ran it in parallel. Read-only tests
 * still must not depend on mutable shared fixtures.
 */
const RUN = Date.now() % 1_000_000;
const slug = `e2e-storefront-${RUN}`;
const userEmail = makeEmail();
let projectId = '';

test.describe.configure({ mode: 'serial' });

test.describe('Storefront root page', () => {
  test.beforeAll(async () => {
    await cleanupTestUser(userEmail);
    const user = await createTestUser(userEmail);
    // EXACTLY ONE active table: this is what makes the storefront redirect,
    // so the fixture must not carry a second one.
    const { data: proj, error } = await admin
      .from('projects')
      .insert({ name: 'Storefront Test', slug, currency: 'BHD', primary_color: '#4338CA', is_active: true })
      .select('id')
      .single();
    if (error || !proj) throw new Error(`create project: ${error?.message ?? 'no row'}`);
    projectId = proj.id;
    await admin.from('staff_members').insert({ project_id: projectId, user_id: user.id, role: 'owner' });
    await admin
      .from('tables')
      .insert({ project_id: projectId, number: 1, slug: 'table-1', is_active: true, qrcode: 'x' });
  });

  test.afterAll(async () => {
    await cleanupTestUser(userEmail);
  });

  test('a single-table store redirects its root to that table’s menu', async ({ page }) => {
    const res = await page.goto(`${E2E_BASE_URL}/${slug}`);
    expect(res?.status(), 'the seeded store must be publicly reachable').toBe(200);
    await page.waitForURL(new RegExp(`/${slug}/menu/table-1$`));
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
