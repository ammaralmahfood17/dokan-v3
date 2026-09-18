import { NextRequest, NextResponse } from 'next/server';
// F4: purge the project's cached public menu after activation changes.
import { revalidateTag } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logSuperAdminAction } from '@/lib/super-admin';

/**
 * POST /api/super-admin/archive-project
 * Body: { projectId, reason }
 *
 * SOFT delete (default). Sets deleted_at + is_active=false: the project
 * vanishes from staff dashboards and listings, data retained. Reason is
 * REQUIRED and stored in the audit metadata.
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

    const body = (await request.json()) as { projectId?: string; reason?: string };
    const reason = (body.reason ?? '').trim();
    if (!body.projectId) return NextResponse.json({ error: 'projectId مطلوب' }, { status: 400 });
    if (!reason) return NextResponse.json({ error: 'السبب مطلوب' }, { status: 400 });

    const admin = createAdminClient();
    const { data: project } = await admin
      .from('projects')
      .select('id, name, slug, deleted_at')
      .eq('id', body.projectId)
      .single();
    if (!project) return NextResponse.json({ error: 'المشروع غير موجود' }, { status: 404 });
    if (project.deleted_at) return NextResponse.json({ error: 'المشروع مؤرشف أصلًا' }, { status: 409 });

    const { error } = await admin.rpc('super_admin_archive_project', {
      p_project_id: body.projectId,
      p_caller_user_id: user.id,
    });
    if (error) {
      Sentry.captureException(error);
      return NextResponse.json({ error: 'فشل الأرشفة' }, { status: 500 });
    }

    await logSuperAdminAction({
      actorUserId: user.id,
      action: 'project.archive',
      targetProjectId: body.projectId,
      metadata: { projectName: project.name, slug: project.slug, reason },
    });

    // F4: purge the cached public menu — an archived store must vanish.
    revalidateTag(`menu-${body.projectId}`, 'max');

    return NextResponse.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}
