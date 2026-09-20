import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@/lib/supabase/server';
import { endImpersonation, logSuperAdminAction, MARKER_COOKIE, type StoredSession } from '@/lib/super-admin';

/**
 * POST /api/super-admin/impersonate/end
 *
 * Ends the impersonation for THIS browser — proven by the httpOnly
 * dokan-impersonation marker cookie set at start (2026-09-20 hardening:
 * previously any caller who knew the sessionId could terminate the session
 * AND receive the super admin's live tokens in the response body; the
 * marker is now the sole credential and is invisible to page JS).
 *
 * The admin's own session is restored SERVER-SIDE (setSession writes the
 * auth cookies on this response) — super admin tokens are never returned in
 * a body again. Marks the row ended and writes an audit end entry. The
 * caller's current auth cookies (the TARGET's session) are never signed out
 * here — that would log the store owner out of their own devices.
 */
export async function POST(request: NextRequest) {
  try {
    const marker = request.cookies.get(MARKER_COOKIE)?.value;
    if (!marker || marker.length !== 36) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const result = await endImpersonation(marker);
    let restored = false;

    if (result) {
      // Restore the super admin's own session server-side. (StoredSession
      // type = the tokens we minted ourselves at start; the Json column type
      // is too wide for tsc here.)
      const adminSession = result.superAdminSession as unknown as StoredSession | null;
      if (adminSession) {
        try {
          const userClient = await createClient();
          const { error } = await userClient.auth.setSession({
            access_token: adminSession.access_token,
            refresh_token: adminSession.refresh_token,
          });
          restored = !error;
        } catch {
          restored = false; // stale refresh token — admin must re-login
        }
      }

      // Audit with the original super admin as actor (from the stored row).
      const admin = (await import('@/lib/supabase/admin')).createAdminClient();
      const { data: row } = await admin
        .from('impersonation_sessions')
        .select('super_admin_user_id, target_project_id')
        .eq('id', marker)
        .maybeSingle();

      await logSuperAdminAction({
        actorUserId: (row?.super_admin_user_id as string) ?? 'unknown',
        action: 'impersonation.end',
        targetProjectId: (row?.target_project_id as string | null) ?? null,
        targetUserId: result.targetUserId,
        metadata: { sessionId: marker, restored },
      });
    }

    // The marker is dead in every outcome: always clear it (path must match
    // how it was set) so a stale banner can never get stuck.
    const response = NextResponse.json({ ok: !!result, restored });
    response.cookies.set(MARKER_COOKIE, '', { path: '/', maxAge: 0 });
    return response;
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}
