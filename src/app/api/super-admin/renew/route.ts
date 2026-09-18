import { NextRequest, NextResponse } from 'next/server';
// F4: purge the project's cached public menu after activation changes.
import { revalidateTag } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logSuperAdminAction } from '@/lib/super-admin';

/**
 * POST /api/super-admin/renew?projectId=...
 * Super-admin only. Re-checks membership at mutation time (not page load),
 * renews via the existing renew_subscription RPC, and writes an audit entry.
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
      .select('id, name, slug')
      .eq('id', projectId)
      .single();
    if (!project) return NextResponse.json({ error: 'المشروع غير موجود' }, { status: 404 });

    const { data: newExpiry, error } = await admin.rpc('renew_subscription', {
      p_project_id: projectId,
      p_days: 30,
      p_caller_user_id: user.id,
    });
    if (error) {
      Sentry.captureException(error);
      return NextResponse.json({ error: 'فشل التجديد' }, { status: 500 });
    }

    await logSuperAdminAction({
      actorUserId: user.id,
      action: 'subscription.renew',
      targetProjectId: projectId,
      metadata: { projectName: project.name, days: 30, newExpiry },
    });

    // F4: purge the cached public menu so a renewed store comes back live
    // immediately instead of up to 60s later.
    revalidateTag(`menu-${projectId}`, 'max');

    return NextResponse.json({ ok: true, subscription_expires_at: newExpiry });
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}
