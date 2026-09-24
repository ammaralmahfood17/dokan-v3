import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logSuperAdminAction } from '@/lib/super-admin';

/**
 * POST /api/super-admin/record-payment
 * Super-admin only. Records a manual payment (bank transfer / stc pay),
 * renews the subscription atomically via record_payment_and_renew RPC,
 * and writes an audit entry.
 *
 * Body: { projectId, amount, method, receipt?, notes?, days? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'محتوى الطلب غير صالح' }, { status: 400 });
    }

    const { projectId, amount, method, receipt, notes, days } = body as {
      projectId?: string;
      amount?: number;
      method?: string;
      receipt?: string;
      notes?: string;
      days?: number;
    };

    // Validate required fields
    if (!projectId || typeof projectId !== 'string' || !/^[0-9a-f-]{36}$/i.test(projectId)) {
      return NextResponse.json({ error: 'projectId مطلوب (UUID)' }, { status: 400 });
    }
    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'المبلغ مطلوب ويجب أن يكون أكبر من صفر' }, { status: 400 });
    }
    if (!method || !['bank-transfer', 'stc-pay'].includes(method)) {
      return NextResponse.json({ error: 'طريقة الدفع يجب أن تكون bank-transfer أو stc-pay' }, { status: 400 });
    }
    if (receipt && typeof receipt !== 'string') {
      return NextResponse.json({ error: 'رقم الإيصال غير صالح' }, { status: 400 });
    }

    const renewalDays = typeof days === 'number' && days > 0 && days <= 365 ? days : 30;

    // Auth + super-admin check
    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const { data: isAdmin } = await userClient.rpc('is_super_admin');
    if (!isAdmin) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });

    // Verify project exists
    const admin = createAdminClient();
    const { data: project } = await admin
      .from('projects')
      .select('id, name, slug')
      .eq('id', projectId)
      .single();
    if (!project) return NextResponse.json({ error: 'المشروع غير موجود' }, { status: 404 });

    // Atomically record payment + renew (RPC not yet in generated types — 
    // migration 0010 ships before this endpoint is called in production)
    const { data: newExpiry, error } = await (admin.rpc as any)('record_payment_and_renew', {
      p_project_id: projectId,
      p_amount: amount,
      p_method: method,
      p_receipt: receipt || null,
      p_notes: notes || null,
      p_days: renewalDays,
      p_caller_id: user.id,
    });

    if (error) {
      Sentry.captureException(error);
      return NextResponse.json({ error: 'فشل تسجيل الدفع' }, { status: 500 });
    }

    await logSuperAdminAction({
      actorUserId: user.id,
      action: 'subscription.record_payment',
      targetProjectId: projectId,
      metadata: {
        projectName: project.name,
        amount,
        method,
        receipt: receipt || null,
        days: renewalDays,
        newExpiry,
      },
    });

    revalidateTag(`menu-${projectId}`, 'max');

    return NextResponse.json({
      ok: true,
      subscription_expires_at: newExpiry,
      message: `تم تسجيل ${amount} د.ب عبر ${method === 'bank-transfer' ? 'تحويل بنكي' : 'stc pay'} — التجديد حتى ${new Date(newExpiry).toLocaleDateString('ar-BH')}`,
    });
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}