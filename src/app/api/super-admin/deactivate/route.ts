import { NextRequest, NextResponse } from 'next/server';
// F4: purge the project's cached public menu after activation changes.
import { revalidateTag } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { limitSuperAdmin } from '@/lib/super-admin-rate-limit';
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

    // Defence in depth: this route is gated by is_super_admin() and the
    // underlying RPC is service_role-only, so the limit is not closing a live
    // bypass — it stops a stolen admin session from hammering the endpoint
    // (each call costs a getUser() + an is_super_admin() RPC before the work
    // is even rejected). Keyed on the admin's user id, not their IP, so a shared
    // office connection can't lock out a real admin.
    const throttled = await limitSuperAdmin(request, user.id, 'deactivate');
    if (throttled) return throttled;

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
        // `expire: 0` expires the tag IMMEDIATELY, so the next request rebuilds.
    // The previous `'max'` profile is stale-while-revalidate: the first
    // visitor after an edit still got the OLD menu, and only the one after
    // them saw the change. For a merchant editing a price or hiding an item
    // that delay is a sale sold at the wrong price.
    revalidateTag(`menu-${projectId}`, { expire: 0 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}
