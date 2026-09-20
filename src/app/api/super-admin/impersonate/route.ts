import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@/lib/supabase/server';
import { startImpersonation, logSuperAdminAction, MARKER_COOKIE } from '@/lib/super-admin';
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
      // sessionId stays in the body for the e2e harness; with the 2026-09-20
      // hardening it grants nothing by itself — only this browser's httpOnly
      // marker cookie can end the session.
      sessionId: result.sessionId,
      expiresAt: result.expiresAt,
      targetSession: result.targetSession,
    });
    // Support-mode marker: httpOnly so page JS (including any XSS on public
    // surfaces) can never read it. The end route is the only consumer.
    response.cookies.set(MARKER_COOKIE, result.sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 60 * 60,
    });
    // The client swaps the session cookie (browser-side supabase client with
    // the minted tokens); the marker above is set by this response.
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
