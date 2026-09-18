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
 * Settings screen e2e — store profile editing (name, currency, primary
 * color) with DB-first verification. The subscription renewal flow is
 * already covered by subscription.spec.ts, so this spec focuses on the
 * settings form itself. User is created with from_api=true (no auto
 * project from the handle_new_user_safety trigger).
 */
test.describe.configure({ mode: 'serial' });

const email = makeEmail();
const runId = Date.now() % 1_000_000;
let userId: string;
let projectId: string;

test.beforeAll(async () => {
  await cleanupTestUser(email);
  const user = await createTestUser(email);
  userId = user.id;
  const { data: proj } = await admin
    .from('projects')
    .insert({ name: 'Settings Test', slug: `e2e-set-${runId}`, currency: 'BHD', primary_color: '#4338CA', is_active: true })
    .select('id')
    .single();
  projectId = proj!.id;
  await admin.from('staff_members').insert({ project_id: projectId, user_id: userId, role: 'owner' });
});

test.afterAll(async () => {
  await cleanupTestUser(email);
});

test('settings: edit store name + currency → persisted in DB', async ({ page, context }) => {
  const authCookies = await getAuthCookies(email, TEST_PASSWORD);
  await context.addCookies(authCookies);
  await page.goto('/dashboard/settings');
  await expect(page.getByRole('heading', { name: /الإعدادات/ }).first()).toBeVisible({ timeout: 20_000 });

  // Change store name
  const nameInput = page.locator('#store-name');
  await nameInput.fill(`متجر معدل ${runId}`);
  // Change currency (BHD → KWD)
  await page.locator('#currency-select').selectOption('KWD');
  // Change primary color via the hex text field
  const colorInput = page.locator('input[pattern="^#[0-9A-Fa-f]{6}$"]');
  await colorInput.fill('#16A34A');

  await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click();
  await expect(page.getByText('تم الحفظ').first()).toBeVisible({ timeout: 15_000 });

  // DB-first verification
  const { data: proj } = await admin.from('projects').select('name, currency, primary_color').eq('id', projectId).single();
  expect(proj?.name).toBe(`متجر معدل ${runId}`);
  expect(proj?.currency).toBe('KWD');
  expect(proj?.primary_color).toBe('#16A34A');

  // UI reflects the new name after router.refresh()
  await expect(page.locator('#store-name')).toHaveValue(`متجر معدل ${runId}`, { timeout: 15_000 });

  // Slug is read-only
  await expect(page.locator('#store-slug')).toBeDisabled();
  console.log('✅ SETTINGS OK — name/currency/color persisted, slug read-only');
});
