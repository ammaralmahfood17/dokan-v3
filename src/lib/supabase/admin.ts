import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

/**
 * Service-role Supabase client (bypasses ALL RLS).
 *
 * === PHASE 1 SECURITY HARDENING ===
 * - ONLY call this after full server-side validation (project active, table belongs to project, products exist & belong).
 * - Used exclusively in:
 *   - /api/public/order, waiter, bill (customer facing, validated)
 *   - /api/pos/order (authenticated staff)
 *   - /api/onboarding/project (with rollback)
 * - Never import in client components.
 * - For normal staff operations, prefer createClient() (respects RLS).
 */
export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient() is server-only — the service role key must never reach the browser');
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL');
  }

  return createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
