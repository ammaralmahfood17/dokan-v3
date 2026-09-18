import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateSlug, isReservedSlug } from '@/lib/utils';
import { DEFAULT_PRIMARY_COLOR, CURRENCIES } from '@/lib/types';

const VALID_CURRENCIES = new Set(CURRENCIES.map((c) => c.value));

/**
 * POST /api/onboarding/project
 * Creates project + owner staff_members record.
 *
 * Handles old registrations:
 * - If user already has staff_members → 409 redirect to dashboard
 * - Slug collisions are auto-resolved with suffix (user can still edit)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    // B6: منع إنشاء مشاريع مفرطة — 3 مشاريع في الساعة لكل مستخدم
    // (حماية من أتمتة إنشاء متاجر للتجربة المجانية أو الإساءة).
    const { rateLimit } = await import('@/lib/rate-limit');
    const limitResult = await rateLimit(user.id, {
      limit: 3,
      windowMs: 60 * 60 * 1000,
      keyPrefix: 'onboarding-project',
    });
    if (!limitResult.allowed) {
      return NextResponse.json(
        { error: 'طلبات كثيرة — حاول لاحقاً' },
        { status: 429 }
      );
    }

    const admin = createAdminClient();

    // Guard: user already has a project? (covers old registrations)
    const { data: existing } = await admin
      .from('staff_members')
      .select('id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: 'لديك مشروع بالفعل', redirect: '/dashboard' },
        { status: 409 }
      );
    }

    const body = (await request.json()) as {
      name?: string;
      slug?: string;
      currency?: string;
      primaryColor?: string;
    };

    const name = body.name?.trim() ?? '';
    let slug = (body.slug?.trim() || generateSlug(name)).toLowerCase();
    const currency = body.currency?.trim() || 'BHD';
    const primaryColor = body.primaryColor?.trim() || DEFAULT_PRIMARY_COLOR;

    // Input hardening
    if (name.length < 2 || name.length > 80) {
      return NextResponse.json(
        { error: 'اسم المتجر يجب أن يكون بين 2 و 80 حرفاً' },
        { status: 400 }
      );
    }

    slug = generateSlug(slug);
    if (!slug || isReservedSlug(slug)) {
      return NextResponse.json(
        { error: 'المعرّف (slug) غير متاح' },
        { status: 400 }
      );
    }

    if (!VALID_CURRENCIES.has(currency as never)) {
      return NextResponse.json({ error: 'عملة غير مدعومة' }, { status: 400 });
    }

    if (!/^#[0-9A-Fa-f]{6}$/.test(primaryColor)) {
      return NextResponse.json({ error: 'لون غير صالح' }, { status: 400 });
    }

    // === Robust slug uniqueness (handles old + concurrent registrations) ===
    // Start with user-provided or generated, then append -1, -2... if taken
    let finalSlug = slug;
    let attempt = 0;
    const MAX_ATTEMPTS = 20;

    while (attempt < MAX_ATTEMPTS) {
      const { data: slugTaken } = await admin
        .from('projects')
        .select('id')
        .eq('slug', finalSlug)
        .maybeSingle();

      if (!slugTaken) break;

      attempt++;
      finalSlug = generateSlug(`${slug}-${attempt}`);
    }

    if (attempt >= MAX_ATTEMPTS) {
      return NextResponse.json(
        { error: 'تعذر العثور على معرّف فريد. جرب اسماً مختلفاً.' },
        { status: 409 }
      );
    }

    slug = finalSlug;

    // Create project
    const { data: project, error: projectErr } = await admin
      .from('projects')
      .insert({
        name,
        slug,
        currency,
        primary_color: primaryColor,
        is_active: true,
        created_by: user.id,
      })
      .select('id, name, slug')
      .single();

    if (projectErr || !project) {
      console.error('Project create error:', projectErr);
      return NextResponse.json(
        { error: 'فشل إنشاء المشروع' },
        { status: 500 }
      );
    }

    // Create owner membership (for old + new users)
    const { error: staffErr } = await admin.from('staff_members').insert({
      project_id: project.id,
      user_id: user.id,
      role: 'owner',
    });

    if (staffErr) {
      console.error('Staff create error:', staffErr);
      // Best-effort rollback
      await admin.from('projects').delete().eq('id', project.id);
      return NextResponse.json(
        { error: 'فشل ربط الملكية بالمشروع' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
      },
    });
  } catch (err) {
    console.error('Onboarding API error:', err);
    return NextResponse.json({ error: 'خطأ داخلي' }, { status: 500 });
  }
}
