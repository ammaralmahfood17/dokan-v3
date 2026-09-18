import { NextRequest, NextResponse, after } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { createSecureOrder } from '@/lib/order-pricing';
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/ip';
import { sendPushToProject } from '@/lib/push';
import { sendTelegramAlert } from '@/lib/telegram';
import { formatMoney } from '@/lib/utils';
import type { PublicOrderItemInput } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      projectSlug?: string;
      tableSlug?: string;
      items?: PublicOrderItemInput[];
      notes?: string;
    };

    const { projectSlug, tableSlug, items, notes } = body;

    if (!projectSlug || !tableSlug || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }

    // Cap slug length — a 1MB slug would blow up the rate-limit key/query.
    if (projectSlug.length > 100 || tableSlug.length > 100) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }

    // Rate limit per project + per IP (keyPrefix is applied by rateLimit, so
    // no duplicate 'public-order:' prefix in the key itself)
    const ip = getClientIp(request);
    const rateKey = projectSlug;
    // Two independent rate-limit checks — run in parallel (each is a DB
    // round-trip; serializing them added ~250ms of pure latency).
    const [limitResult, ipLimitResult] = await Promise.all([
      rateLimit(rateKey, { limit: 20, windowMs: 60 * 1000, keyPrefix: 'public-order' }),
      rateLimit(`ip:${ip}`, { limit: 30, windowMs: 60 * 1000, keyPrefix: 'public-order-ip' }),
    ]);

    if (!limitResult.allowed) {
      const res = createRateLimitResponse(limitResult.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    if (!ipLimitResult.allowed) {
      const res = createRateLimitResponse(ipLimitResult.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }

    const supabase = createAdminClient();

    // 1. Validate project — HARD subscription cutoff via the SECURITY
    //    DEFINER RPC (reads subscription_expires_at exactly; anon can't
    //    select that column and pg_cron's daily is_active flip would leak
    //    up to 24h of free orders after expiry).
    const { data: isAvailable } = await supabase.rpc('is_project_publicly_available', {
      p_slug: projectSlug,
    });
    if (!isAvailable) {
      return NextResponse.json({ error: 'المتجر غير متاح' }, { status: 404 });
    }

    const { data: project, error: projectErr } = await supabase
      .from('projects')
      .select('id, currency')
      .eq('slug', projectSlug)
      .single();

    if (projectErr || !project) {
      return NextResponse.json({ error: 'المتجر غير متاح' }, { status: 404 });
    }

    // 2. Validate table belongs to project
    const { data: table, error: tableErr } = await supabase
      .from('tables')
      .select('id, number, is_active')
      .eq('slug', tableSlug)
      .eq('project_id', project.id)
      .single();

    if (tableErr || !table || !table.is_active) {
      return NextResponse.json(
        { error: 'الطاولة غير موجودة أو غير نشطة' },
        { status: 404 }
      );
    }

    // 3. Server-side pricing + insert (core security)
    const result = await createSecureOrder(supabase, {
      projectId: project.id,
      currency: project.currency,
      tableId: table.id,
      type: 'dinein',
      items,
      notes: body.notes,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Post-create side effects (audit, push, telegram) run AFTER the response
    // via after() — the customer sees the confirmation immediately instead
    // of waiting for external push/telegram HTTP calls. after() is guaranteed
    // on Vercel (fire-and-forget gets frozen). Order already created above.
    after(async () => {
      await Promise.all([
        // Phase 3: Audit log
        (async () => {
          try {
            await supabase.from('order_audit_logs').insert({
              order_id: result.order.id,
              project_id: project.id,
              event: 'created',
              new_status: result.order.status,
              metadata: { type: 'dinein', item_count: items?.length || 0 },
            });
          } catch (auditErr) {
            console.warn('[Audit] Failed to write order audit log', auditErr);
          }
        })(),

        // Push notification to all staff
        sendPushToProject(project.id, {
          title: '🔔 طلب جديد',
          body: `طلب #${result.order.orderNumber} من القائمة — ${formatMoney(
            result.order.totalAmount,
            project.currency
          )}`,
          url: '/dashboard/kitchen',
          tag: `order-${result.order.id}`,
        }).catch(() => {}),

        // Telegram alert — free, reliable (works app-closed).
        sendTelegramAlert(project.id, {
          orderNumber: result.order.orderNumber,
          totalText: formatMoney(result.order.totalAmount, project.currency),
          tableNumber: table.number,
        }).catch(() => {}),
      ]);
    });

    return NextResponse.json({
      order: {
        id: result.order.id,
        status: result.order.status,
        totalAmount: result.order.totalAmount,
        orderNumber: result.order.orderNumber,
      },
    });
  } catch (err) {
    console.error('Public order API error:', err);
    Sentry.captureException(err);
    return NextResponse.json({ error: 'خطأ داخلي' }, { status: 500 });
  }
}
