import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Json } from '@/lib/database.types';

/**
 * Super-admin surface helpers (server-only).
 *
 * SECURITY MODEL:
 * - Every page/route in /super-admin re-checks membership via
 *   `is_super_admin()` (SECURITY DEFINER RPC reading super_admins by
 *   auth.uid()) at request time — never trusts a session that was valid
 *   when a page loaded.
 * - The audit helper writes via service_role (the table is service_role-only;
 *   anon/authenticated have no grants). Every super-admin WRITE action must
 *   call `logSuperAdminAction` — a missing audit row is treated as a bug.
 */

export type SuperAdminAction =
  | 'subscription.renew'
  | 'project.deactivate'
  | 'project.create'
  | 'project.archive'
  | 'project.hard_delete'
  | 'impersonation.start'
  | 'impersonation.end'
  | 'audit.view';

/** Returns the current user id if they are a super admin, else null. */
export async function getSuperAdminUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: isAdmin } = await supabase.rpc('is_super_admin');
  return isAdmin ? user.id : null;
}

/** Gate a server component / route handler. Redirects to /login if not admin. */
export async function requireSuperAdmin(): Promise<string> {
  const adminUserId = await getSuperAdminUserId();
  if (!adminUserId) redirect('/login');
  return adminUserId;
}

/** Write an audit entry (service_role — bypasses RLS on the log table). */
export async function logSuperAdminAction(input: {
  actorUserId: string;
  action: SuperAdminAction;
  targetProjectId?: string | null;
  targetUserId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from('super_admin_audit_log').insert({
    actor_user_id: input.actorUserId,
    action: input.action,
    target_project_id: input.targetProjectId ?? null,
    target_user_id: input.targetUserId ?? null,
    metadata: (input.metadata ?? {}) as unknown as Json,
  });
  if (error) {
    // Logging must never silently fail — surface it loudly.
    console.error('[SuperAdmin] audit log insert failed:', error.message);
    throw new Error(`audit log failed: ${error.message}`);
  }
}

// ===========================================================================
// Phase C — impersonation ("login as" for support)
//
// HOW IT WORKS (investigated against the real Supabase admin API before
// building — see the live probe):
//   admin.generateLink({type:'magiclink'}) + verifyOtp(token_hash) mints a
//   REAL session for the target user with NO password exposure and NO email
//   confirmation needed. We store both the target's session (the one the
//   browser will use) and the super admin's own session (to restore on end)
//   in impersonation_sessions, then swap the auth cookie.
//
// LIMITATION (reported explicitly): this requires the target user to not
// have MFA / TOTP enabled — verifyOtp with a magiclink token_hash bypasses
// password but not MFA. If a target has MFA on, the impersonation will fail
// at verifyOtp. Flagged, not silently handled.
// ===========================================================================

const IMPERSONATION_TTL_MS = 30 * 60 * 1000; // hard 30-minute limit

export type ImpersonationSession = {
  id: string;
  targetUserId: string;
  targetProjectId: string | null;
  targetEmail: string;
  expiresAt: string;
};

/** Mint a session for the target and store both sessions (service_role). */
export async function startImpersonation(input: {
  actorUserId: string;
  actorSession: Json; // the super admin's CURRENT session — restored on end
  targetUserId: string;
  targetProjectId: string | null;
}): Promise<{ sessionId: string; targetSession: Json; expiresAt: string }> {
  const admin = createAdminClient();

  const { data: targetUser } = await admin.auth.admin.getUserById(input.targetUserId);
  if (!targetUser?.user?.email) throw new Error('target user not found');
  const targetEmail = targetUser.user.email;

  // 1. Mint the owner session (no password involved).
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: targetEmail,
    options: { redirectTo: 'https://dokanstore.xyz/dashboard' },
  });
  if (linkErr || !link?.properties?.hashed_token) {
    throw new Error(`generateLink failed: ${linkErr?.message ?? 'no token'}`);
  }

  const verifier = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data: verified, error: verifyErr } = await verifier.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.properties.hashed_token,
  });
  if (verifyErr || !verified.session) {
    throw new Error(`verifyOtp failed: ${verifyErr?.message ?? 'no session'} (target may have MFA enabled)`);
  }

  // 2. Persist BOTH sessions + expiry (tokens are secrets — server-side only).
  const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MS).toISOString();
  const { data: row, error: insErr } = await admin
    .from('impersonation_sessions')
    .insert({
      super_admin_user_id: input.actorUserId,
      target_user_id: input.targetUserId,
      target_project_id: input.targetProjectId,
      super_admin_session: input.actorSession,
      target_session: verified.session as unknown as Json,
      expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (insErr || !row) throw new Error(`impersonation persist failed: ${insErr?.message}`);

  return {
    sessionId: row.id,
    targetSession: verified.session as unknown as Json,
    expiresAt,
  };
}

/** Look up the active impersonation row by marker cookie id. */
export async function getImpersonationById(
  sessionId: string
): Promise<ImpersonationSession | null> {
  if (!sessionId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from('impersonation_sessions')
    .select('id, target_user_id, target_project_id, expires_at, ended_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (!data) return null;
  if (data.ended_at || new Date(data.expires_at as string).getTime() <= Date.now()) return null;

  const { data: targetUser } = await admin.auth.admin.getUserById(data.target_user_id as string);
  return {
    id: data.id as string,
    targetUserId: data.target_user_id as string,
    targetProjectId: data.target_project_id as string | null,
    targetEmail: targetUser?.user?.email ?? 'unknown',
    expiresAt: data.expires_at as string,
  };
}

/** End an impersonation: mark ended and return the stored sessions for
 *  cookie restoration (service_role). */
export async function endImpersonation(sessionId: string): Promise<{
  superAdminSession: Json | null;
  targetUserId: string;
} | null> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from('impersonation_sessions')
    .select('id, super_admin_session, target_session, target_user_id, ended_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (!row || row.ended_at) return null;

  await admin.from('impersonation_sessions').update({ ended_at: new Date().toISOString() }).eq('id', sessionId);
  return {
    superAdminSession: (row.super_admin_session as Json | null) ?? null,
    targetUserId: row.target_user_id as string,
  };
}
