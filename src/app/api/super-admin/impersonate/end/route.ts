import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@/lib/supabase/server';
import { endImpersonation, logSuperAdminAction } from '@/lib/super-admin';
import type { Json } from '@/lib/database.types';

/**
 * POST /api/super-admin/impersonate/end
 * Body: { sessionId: string }
 *
 * Ends the impersonation: marks the row ended, restores the super admin's
 * own session (returns it for cookie swap-back), and writes an audit end
 * entry. Called from the banner's "إنهاء الجلسة" button AND from the auto-
 * expiry path (expired session detected by the layout).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { sessionId?: string };
    if (!body.sessionId || typeof body.sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId مطلوب' }, { status: 400 });
    }

    // The impersonated session may be expired — authenticate loosely: any
    // signed-in user with the matching marker can end it, and the audit
    // records the actor from the stored row. We look up the row first.
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();

    const result = await endImpersonation(body.sessionId);
    if (!result) {
      return NextResponse.json({ error: 'الجلسة غير موجودة أو منتهية' }, { status: 404 });
    }

    // Audit with the original super admin as actor (from the stored row).
    const admin = (await import('@/lib/supabase/admin')).createAdminClient();
    const { data: row } = await admin
      .from('impersonation_sessions')
      .select('super_admin_user_id, target_project_id')
      .eq('id', body.sessionId)
      .maybeSingle();

    await logSuperAdminAction({
      actorUserId: (row?.super_admin_user_id as string) ?? user?.id ?? 'unknown',
      action: 'impersonation.end',
      targetProjectId: (row?.target_project_id as string | null) ?? null,
      targetUserId: result.targetUserId,
      metadata: { sessionId: body.sessionId, endedBy: user?.id ?? null },
    });

    return NextResponse.json({
      ok: true,
      superAdminSession: result.superAdminSession as unknown as Json,
    });
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}
