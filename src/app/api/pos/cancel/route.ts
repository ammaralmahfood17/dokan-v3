import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/pos/cancel
 * Server-side order cancellation with validation.
 * - Verifies user is a staff member of the project
 * - Validates order exists and belongs to the project
 * - Prevents cancelling already delivered/cancelled orders
 * - Logs to audit trail
 */
export async function POST(request: NextRequest) {
  try {
    const userClient = await createClient();
    // B1: getSession() fast local read, then force server-side JWT
    // verification via getUser() — a revoked session (fired staff) must
    // not be able to cancel orders with an unexpired-but-revoked token.
    const {
      data: { session },
    } = await userClient.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const body = (await request.json()) as { orderId?: string };
    const { orderId } = body;

    if (!orderId) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }

    // Verify user has access to a project (is staff)
    const { data: membership } = await userClient
      .from('staff_members')
      .select('project_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'لا يوجد مشروع' }, { status: 403 });
    }

    const supabase = createAdminClient();

    // Get current order state — verify it belongs to user's project
    const { data: order } = await supabase
      .from('orders')
      .select('id, status, total_amount')
      .eq('id', orderId)
      .eq('project_id', membership.project_id)
      .single();

    if (!order) {
      return NextResponse.json(
        { error: 'الطلب غير موجود أو لا ينتمي لمشروعك' },
        { status: 404 }
      );
    }

    // Validate: can only cancel orders not yet delivered/cancelled
    if (order.status === 'delivered' || order.status === 'cancelled') {
      return NextResponse.json(
        { error: 'لا يمكن إلغاء طلب تم تسليمه أو إلغاؤه مسبقاً' },
        { status: 400 }
      );
    }

    // Perform the cancellation using admin client — re-scope by project_id
    // (defense in depth) and re-check the status INSIDE the UPDATE so a
    // concurrent deliver/cancel between the read above and this write cannot
    // cancel an already-delivered order (TOCTOU). `ready` is cancellable too
    // (kitchen printed it but it hasn't been picked up yet).
    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', orderId)
      .eq('project_id', membership.project_id)
      .in('status', ['pending', 'preparing', 'ready'])
      .select('id')
      .maybeSingle();

    if (updateErr) {
      console.error('[Cancel] DB update error:', updateErr);
      return NextResponse.json({ error: 'فشل إلغاء الطلب' }, { status: 500 });
    }

    // 0 rows matched → the order changed status between our read and the
    // update (concurrent deliver/cancel). Don't claim success.
    if (!updated) {
      return NextResponse.json(
        { error: 'تعذر الإلغاء — تغيرت حالة الطلب، حدّث الصفحة وحاول مجدداً' },
        { status: 409 }
      );
    }

    // Audit log (best-effort)
    try {
      await supabase.from('order_audit_logs').insert({
        order_id: orderId,
        project_id: membership.project_id,
        event: 'cancelled',
        old_status: order.status,
        new_status: 'cancelled',
        actor_user_id: user.id,
        metadata: {
          type: 'staff_cancellation',
          total_amount: order.total_amount,
        },
      });
    } catch (auditErr) {
      console.warn('[Cancel] Audit log error:', auditErr);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Cancel] API error:', err);
    return NextResponse.json({ error: 'خطأ داخلي' }, { status: 500 });
  }
}