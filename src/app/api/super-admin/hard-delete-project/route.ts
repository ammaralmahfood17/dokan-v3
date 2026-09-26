import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { limitSuperAdmin } from '@/lib/super-admin-rate-limit';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logSuperAdminAction } from '@/lib/super-admin';

/**
 * POST /api/super-admin/hard-delete-project
 * Body: { projectId, confirmName, reason }
 *
 * HARD delete — deliberately NOT the default. Requires typing the exact
 * project name (server-side verified, not just client-side) plus a reason.
 * Irreversible: cascades through all child rows.
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

    // Defence in depth: this route is gated by is_super_admin() and the
    // underlying RPC is service_role-only, so the limit is not closing a live
    // bypass — it stops a stolen admin session from hammering the endpoint
    // (each call costs a getUser() + an is_super_admin() RPC before the work
    // is even rejected). Keyed on the admin's user id, not their IP, so a shared
    // office connection can't lock out a real admin.
    const throttled = await limitSuperAdmin(request, user.id, 'hard-delete-project');
    if (throttled) return throttled;

    const body = (await request.json()) as {
      projectId?: string;
      confirmName?: string;
      reason?: string;
    };
    const reason = (body.reason ?? '').trim();
    if (!body.projectId) return NextResponse.json({ error: 'projectId مطلوب' }, { status: 400 });
    if (!reason) return NextResponse.json({ error: 'السبب مطلوب' }, { status: 400 });

    const admin = createAdminClient();
    const { data: project } = await admin
      .from('projects')
      .select('id, name, slug')
      .eq('id', body.projectId)
      .single();
    if (!project) return NextResponse.json({ error: 'المشروع غير موجود' }, { status: 404 });

    // Exact-name confirmation — server-side, not just UI.
    if ((body.confirmName ?? '').trim() !== project.name) {
      return NextResponse.json(
        { error: 'تأكيد الاسم غير مطابق — اكتب اسم المتجر بالضبط' },
        { status: 400 }
      );
    }

    const { error } = await admin.rpc('super_admin_hard_delete_project', {
      p_project_id: body.projectId,
      p_caller_user_id: user.id,
    });
    if (error) {
      Sentry.captureException(error);
      return NextResponse.json({ error: 'فشل الحذف' }, { status: 500 });
    }

    await logSuperAdminAction({
      actorUserId: user.id,
      action: 'project.hard_delete',
      targetProjectId: body.projectId,
      metadata: { projectName: project.name, slug: project.slug, reason },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}
