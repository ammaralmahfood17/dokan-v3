import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/revalidate-menu
 * Body: { projectId: string }
 *
 * M5: invalidates the public menu cache for one project after a product /
 * category mutation in the dashboard. Auth-gated: only members of the project
 * can trigger it (matches the same RLS membership rule the dashboard uses).
 */
export async function POST(request: NextRequest) {
  try {
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const body = (await request.json()) as { projectId?: string };
    if (!body.projectId || typeof body.projectId !== 'string') {
      return NextResponse.json({ error: 'projectId مطلوب' }, { status: 400 });
    }

    // Must be a member of this project — never let any logged-in user purge
    // another tenant's menu cache.
    const { data: membership } = await userClient
      .from('staff_members')
      .select('id')
      .eq('project_id', body.projectId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    revalidateTag(`menu-${body.projectId}`, 'max');
    return NextResponse.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}
