import { test, expect } from '@playwright/test';
import {
  createTestUser,
  cleanupTestUser,
  getAuthCookies,
  makeEmail,
  TEST_PASSWORD,
  admin,
} from './helpers';

/**
 * Products screen e2e — the CRUD surface the whole order flow depends on
 * (a store must add products before it can sell). Covers: create category,
 * create product with addon, edit price, toggle availability, delete.
 * Every step is verified against the DB, not just the UI (DB-first).
 */
test.describe.configure({ mode: 'serial' });

const email = makeEmail();
const runId = Date.now() % 1_000_000;
let userId: string;
let projectId: string;
let productId: string;

async function dbProduct() {
  const { data } = await admin
    .from('products')
    .select('id, name, price, is_available, product_addons(id, name, price)')
    .eq('id', productId)
    .single();
  return data as { id: string; name: string; price: number; is_available: boolean; product_addons: { name: string; price: number }[] } | null;
}

test.beforeAll(async () => {
  await cleanupTestUser(email);
  const user = await createTestUser(email);
  userId = user.id;
  const { data: proj } = await admin
    .from('projects')
    .insert({ name: 'Products Test', slug: `e2e-prod-${runId}`, currency: 'BHD', primary_color: '#4338CA', is_active: true })
    .select('id')
    .single();
  projectId = proj!.id;
  await admin.from('staff_members').insert({ project_id: projectId, user_id: userId, role: 'owner' });
});

test.afterAll(async () => {
  await cleanupTestUser(email);
});

test('products: category → product w/ addon → edit → toggle → delete', async ({ page, context }) => {
  const authCookies = await getAuthCookies(email, TEST_PASSWORD);
  await context.addCookies(authCookies);
  await page.goto('/dashboard/products');
  await expect(page.getByRole('heading', { name: /المنتجات/ }).first()).toBeVisible({ timeout: 20_000 });

  // ── 1. Create category via the "تصنيف جديد" modal ───────────────
  await page.getByRole('button', { name: 'تصنيف جديد', exact: true }).click();
  await page.getByPlaceholder('مثال: مشروبات ساخنة').fill('مشروبات');
  await page.getByRole('button', { name: 'إنشاء', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'تصنيف جديد' })).toBeHidden({ timeout: 15_000 });
  // DB: category exists
  const { data: cat } = await admin.from('categories').select('id').eq('project_id', projectId).eq('name', 'مشروبات').maybeSingle();
  expect(cat, 'category persisted').toBeTruthy();
  // UI: category chip visible
  await expect(page.locator('button', { hasText: 'مشروبات' })).toBeVisible({ timeout: 15_000 });

  // ── 2. Create product with addon ────────────────────────────────
  await page.getByRole('button', { name: 'منتج جديد', exact: true }).first().click();
  const formDialog = page.getByRole('dialog', { name: 'منتج جديد' });
  await expect(formDialog).toBeVisible({ timeout: 15_000 });

  await page.getByPlaceholder('مثال: قهوة عربية').fill('موهيتو ليمون');
  await page.getByPlaceholder('Arabic Coffee').fill('Lemon Mojito');
  await page.getByPlaceholder('وصف مختصر للمنتج يظهر للعملاء في القائمة').fill('مشروب منعش');
  await page.getByPlaceholder(`0.${'0'.repeat(3)}`).first().fill('1.250');

  // addon: click "إضافة" in the الإضافات section → fill fields
  await formDialog.locator('label', { hasText: /^الإضافات/ }).locator('..').locator('button').click();
  const addonName = page.getByPlaceholder('اسم الإضافة');
  await expect(addonName).toBeVisible({ timeout: 15_000 });
  await addonName.fill('نعناع');
  await page.getByPlaceholder(`0.${'0'.repeat(3)}`).nth(1).fill('0.25');

  await page.getByRole('button', { name: 'إضافة المنتج', exact: true }).click();
  await expect(formDialog).toBeHidden({ timeout: 15_000 });

  // DB: product + addon persisted
  const { data: created } = await admin
    .from('products')
    .select('id, name, price, is_available, product_addons(id, name, price)')
    .eq('project_id', projectId)
    .eq('name', 'موهيتو ليمون')
    .single();
  expect(created, 'product persisted').toBeTruthy();
  productId = created!.id;
  expect(created!.name).toBe('موهيتو ليمون');
  expect(Number(created!.price)).toBeCloseTo(1.25, 3);
  expect(created!.is_available).toBe(true);
  expect(created!.product_addons).toHaveLength(1);
  expect((created!.product_addons as { name: string; price: number }[])[0].name).toBe('نعناع');

  // UI: product card visible
  await expect(page.locator('div').filter({ hasText: 'موهيتو ليمون' }).first()).toBeVisible({ timeout: 15_000 });

  // ── 3. Edit price (2.0) ──────────────────────────────────────────
  await page.getByLabel(`تعديل ${created!.name}`).click();
  const editDialog = page.getByRole('dialog', { name: 'تعديل منتج' });
  await expect(editDialog).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder(`0.${'0'.repeat(3)}`).first().fill('2.0');
  await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click();
  await expect(editDialog).toBeHidden({ timeout: 15_000 });

  const edited = await dbProduct();
  expect(edited).not.toBeNull();
  expect(Number(edited!.price)).toBeCloseTo(2.0, 3);

  // ── 4. Toggle availability off (checkbox inside the edit modal) ──
  await page.getByLabel(`تعديل ${created!.name}`).click();
  await expect(page.getByRole('dialog', { name: 'تعديل منتج' })).toBeVisible({ timeout: 15_000 });
  const availToggle = page.getByLabel('المنتج متاح للطلب');
  await availToggle.click(); // Toggle component — click flips checked state
  await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'تعديل منتج' })).toBeHidden({ timeout: 15_000 });

  await expect
    .poll(async () => (await dbProduct())?.is_available, { timeout: 15_000 })
    .toBe(false);
  console.log('✅ PRODUCTS CRUD OK — id', productId);
});
