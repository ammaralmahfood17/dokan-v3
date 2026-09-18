import { NextRequest, NextResponse } from 'next/server';
// F4: purge the project's cached public menu after activation changes.
import { revalidateTag } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logSuperAdminAction } from '@/lib/super-admin';

/**
 * POST /api/super-admin/deactivate?projectId=...
 * Super-admin only. Re-checks membership at mutation time. Flips is_active
 * off immediately (abuse / non-payment before natural expiry). Logged.
 */
export async function POST(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ error: 'projectId مطلوب' }, { status: 400 });
    }

    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const { data: isAdmin } = await userClient.rpc('is_super_admin');
    if (!isAdmin) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });

    const admin = createAdminClient();
    const { data: project } = await admin
      .from('projects')
      .select('id, name, slug, is_active')
      .eq('id', projectId)
      .single();
    if (!project) return NextResponse.json({ error: 'المشروع غير موجود' }, { status: 404 });
    if (!project.is_active) {
      return NextResponse.json({ error: 'المشروع موقوف أصلًا' }, { status: 409 });
    }

    const { error } = await admin.rpc('super_admin_deactivate_project', {
      p_project_id: projectId,
      p_caller_user_id: user.id,
    });
    if (error) {
      Sentry.captureException(error);
      return NextResponse.json({ error: 'فشل الإيقاف' }, { status: 500 });
    }

    await logSuperAdminAction({
      actorUserId: user.id,
      action: 'project.deactivate',
      targetProjectId: projectId,
      metadata: { projectName: project.name, slug: project.slug },
    });

    // F4: purge the cached public menu for this project immediately — a
    // deactivated store must stop serving its menu right away, not up to
    // 60s later (unstable_cache TTL).
    revalidateTag(`menu-${projectId}`, 'max');

    return NextResponse.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}
