import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/ip';

// UX-U1: قراءة حالة الطلب العامة (polling خفيف من شاشة النجاح).
// آمنة بحدود:
//  - إرجاع الحالة فقط (status + created_at) — لا أرقام/مبالغ/بيانات زبون
//  - تحقق tenant: الطلب يجب أن ينتمي لمشروع الـ slug (عبر admin client)
//  - rate limit لكل IP + لكل مشروع (polling 12s ≈ 5/min/زبون)
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get('orderId') ?? '';
    const projectSlug = url.searchParams.get('projectSlug') ?? '';

    // UUID صارم — يمنع حقن/تخمين معرفات غير صالحة
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId) ||
      projectSlug.length === 0 ||
      projectSlug.length > 100
    ) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const [ipLimit, projectLimit] = await Promise.all([
      rateLimit(`ip:${ip}`, { limit: 60, windowMs: 60 * 1000, keyPrefix: 'order-status-ip' }),
      rateLimit(projectSlug, { limit: 300, windowMs: 60 * 1000, keyPrefix: 'order-status' }),
    ]);
    if (!ipLimit.allowed) {
      const res = createRateLimitResponse(ipLimit.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    if (!projectLimit.allowed) {
      const res = createRateLimitResponse(projectLimit.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }

    const admin = createAdminClient();

    // الطلب ينتمي لمشروع الـ slug؟ (join عبر projects — لا تسريب بين المتاجر)
    const { data: project } = await admin
      .from('projects')
      .select('id')
      .eq('slug', projectSlug)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'غير موجود' }, { status: 404 });
    }

    const { data: order, error } = await admin
      .from('orders')
      .select('status, created_at')
      .eq('id', orderId)
      .eq('project_id', project.id)
      .maybeSingle();

    if (error || !order) {
      return NextResponse.json({ error: 'غير موجود' }, { status: 404 });
    }

    return NextResponse.json({ status: order.status, createdAt: order.created_at });
  } catch {
    return NextResponse.json({ error: 'خطأ داخلي' }, { status: 500 });
  }
}
