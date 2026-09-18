import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@/lib/supabase/server';
import { startImpersonation, logSuperAdminAction } from '@/lib/super-admin';
import type { Json } from '@/lib/database.types';

/**
 * POST /api/super-admin/impersonate
 * Body: { targetUserId: string, projectId?: string }
 *
 * Super-admin only (re-checked at mutation time). Mints a REAL session for
 * the target user via generateLink+verifyOtp (no password involved), stores
 * both sessions + 30-min expiry, swaps the auth cookie, and writes an audit
 * start entry.
 */
export async function POST(request: NextRequest) {
  try {
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const { data: isAdmin } = await userClient.rpc('is_super_admin');
    if (!isAdmin) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });

    const body = (await request.json()) as { targetUserId?: string; projectId?: string };
    if (!body.targetUserId || typeof body.targetUserId !== 'string') {
      return NextResponse.json({ error: 'targetUserId مطلوب' }, { status: 400 });
    }

    // Capture the admin's CURRENT session BEFORE swapping (restore on end).
    const {
      data: { session: adminSession },
    } = await userClient.auth.getSession();
    if (!adminSession) return NextResponse.json({ error: 'لا جلسة' }, { status: 500 });

    const result = await startImpersonation({
      actorUserId: user.id,
      actorSession: adminSession as unknown as Json,
      targetUserId: body.targetUserId,
      targetProjectId: body.projectId ?? null,
    });

    await logSuperAdminAction({
      actorUserId: user.id,
      action: 'impersonation.start',
      targetProjectId: body.projectId ?? null,
      targetUserId: body.targetUserId,
      metadata: { sessionId: result.sessionId, expiresAt: result.expiresAt },
    });

    const response = NextResponse.json({
      ok: true,
      sessionId: result.sessionId,
      expiresAt: result.expiresAt,
      targetSession: result.targetSession,
    });
    // The client sets the session cookie (non-httpOnly swap happens via the
    // browser-side supabase client with the minted tokens).
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    if (message.includes('MFA')) {
      return NextResponse.json({ error: 'المستخدم مفعّل لديه MFA — لا يمكن انتحال الجلسة' }, { status: 409 });
    }
    Sentry.captureException(err);
    return NextResponse.json({ error: 'فشل بدء الجلسة' }, { status: 500 });
  }
}
