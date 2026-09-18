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
 * POS money path — the second real-money flow (audit gap: no e2e covered it).
 * Setup (admin): user + store + product (with addon) + table.
 * Flow (UI): POS page → click product → pick addon → confirm → order lands
 * on the orders board / kitchen, priced server-side, items correct.
 */
test.describe.configure({ mode: 'serial' });

const email = makeEmail();
const runId = Date.now() % 1_000_000;
const slug = `e2e-pos-${runId}`;
let userId: string;
let projectId: string;
let authed: SupabaseClient;

test.beforeAll(async () => {
  await cleanupTestUser(email);
  const user = await createTestUser(email);
  userId = user.id;

  const { data: proj } = await admin
    .from('projects')
    .insert({ name: 'POS Test', slug, currency: 'BHD', primary_color: '#4338CA', is_active: true })
    .select('id')
    .single();
  projectId = proj!.id;
  await admin.from('staff_members').insert({ project_id: projectId, user_id: userId, role: 'owner' });

  const { data: cat } = await admin
    .from('categories')
    .insert({ project_id: projectId, name: 'مشروبات', sort_order: 0 })
    .select('id')
    .single();

  // Product WITH an addon — exercises the addon picker in POS.
  const { data: prod } = await admin
    .from('products')
    .insert({ project_id: projectId, name: 'موهيتو', price: 1.5, category_id: cat!.id, is_available: true })
    .select('id')
    .single();
  await admin.from('product_addons').insert({
    product_id: prod!.id,
    name: 'نعناع إضافي',
    price: 0.25,
    is_available: true,
  });

  await admin
    .from('tables')
    .insert({ project_id: projectId, number: 1, slug: 'table-1', is_active: true, qrcode: 'x' });

  authed = createClient(url, anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: se } = await authed.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (se) throw new Error(`signIn failed: ${se.message}`);
});

test.afterAll(async () => {
  await cleanupTestUser(email);
});

test('POS: add product + addon → confirm → order lands with correct price', async ({ page, context }) => {
  const authCookies = await getAuthCookies(email, TEST_PASSWORD);
  await context.addCookies(authCookies);

  // 1. Open POS.
  await page.goto('/dashboard/pos');
  await expect(page.getByPlaceholder('ابحث عن منتج… ( / )')).toBeVisible({ timeout: 20_000 });

  // 2. Click the product card (opens addon picker since the product has addons).
  const card = page.locator('[data-pos-card]').filter({ hasText: 'موهيتو' }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();

  // 3. Addon picker appears (dialog) → check the addon checkbox.
  const picker = page.getByRole('dialog', { name: /إضافات — موهيتو/ });
  await expect(picker).toBeVisible({ timeout: 15_000 });
  const addonCheckbox = picker.getByText('نعناع إضافي', { exact: false });
  await expect(addonCheckbox).toBeVisible({ timeout: 15_000 });
  await addonCheckbox.click();

  // 4. Confirm adding to cart.
  await picker.getByRole('button', { name: 'إضافة للسلة', exact: true }).click();

  // 5. Open the cart (mobile bottom sheet / desktop panel).
  await page.getByRole('button', { name: 'عرض السلة' }).click().catch(async () => {
    await page.getByLabel('سلة الطلب').click().catch(() => {});
  });

  // 6. Cart shows the item with the addon price included (1.5 + 0.25 = 1.750).
  const cartItem = page.getByText('موهيتو', { exact: false }).first();
  await expect(cartItem).toBeVisible({ timeout: 15_000 });
  const totalText = await page.getByText(/1\.750|1\.75/).first().textContent().catch(() => '');
  expect(totalText, `cart total should include addon: ${totalText}`).toBeTruthy();

  // 7. Confirm the order → success toast with the order number. Measure the
  // user-visible latency (click → toast) as a perf regression check.
  const t0 = Date.now();
  await page.getByRole('button', { name: 'تأكيد الطلب', exact: true }).click();
  await expect(page.getByText(/تم الطلب order-/).first()).toBeVisible({ timeout: 20_000 });
  console.log(`⏱ POS order latency (confirm→toast): ${Date.now() - t0}ms`);

  // 8. Verify in DB: order exists, total = 1.75, item + addon persisted.
  const { data: orders } = await admin
    .from('orders')
    .select('id, total_amount, status, order_items(id, product_name, quantity, unit_price, addons)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1);
  const order = orders?.[0];
  expect(order, 'order must exist').toBeTruthy();
  expect(Number(order?.total_amount)).toBeCloseTo(1.75, 3);

  const items = order?.order_items as { product_name: string; unit_price: number; addons: unknown }[];
  expect(items?.length).toBe(1);
  expect(items?.[0]?.product_name).toBe('موهيتو');
  // Design: unit_price = product price + addons (line-level total).
  expect(Number(items?.[0]?.unit_price)).toBeCloseTo(1.75, 3);
  const addons = (items?.[0]?.addons ?? []) as { name: string; price: number }[];
  expect(addons?.length).toBe(1);
  expect(addons?.[0]?.name).toBe('نعناع إضافي');
  expect(Number(addons?.[0]?.price)).toBeCloseTo(0.25, 3);

  // 9. Kitchen sees it too (the real money path continues).
  await page.goto('/dashboard/kitchen');
  await expect(page.getByText('موهيتو').first()).toBeVisible({ timeout: 20_000 });

  console.log('✅ POS PATH OK — order', order?.id, 'total', order?.total_amount);
});
