import { NextRequest, NextResponse } from 'next/server';
// F4: purge the project's cached public menu after activation changes.
import { revalidateTag } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { limitSuperAdmin } from '@/lib/super-admin-rate-limit';
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
    // Auth BEFORE input validation: an unauthenticated caller must not be able
    // to learn the request shape (or that a field is missing) from a 400 that
    // arrives ahead of the 401. Everything below is inside this try, so a
    // throwing getUser() still lands in the 500 handler with Sentry attached.
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
    const throttled = await limitSuperAdmin(request, user.id, 'renew');
    if (throttled) return throttled;

    const projectId = request.nextUrl.searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ error: 'projectId مطلوب' }, { status: 400 });
    }

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
        // `expire: 0` expires the tag IMMEDIATELY, so the next request rebuilds.
    // The previous `'max'` profile is stale-while-revalidate: the first
    // visitor after an edit still got the OLD menu, and only the one after
    // them saw the change. For a merchant editing a price or hiding an item
    // that delay is a sale sold at the wrong price.
    revalidateTag(`menu-${projectId}`, { expire: 0 });

    return NextResponse.json({ ok: true, subscription_expires_at: newExpiry });
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}
