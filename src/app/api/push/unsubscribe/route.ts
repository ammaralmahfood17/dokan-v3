import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

async function db() {
  return await createClient();
}

/**
 * POST /api/push/unsubscribe
 * Remove push subscription for the current user
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const body = await request.json() as { endpoint: string };
    if (!body.endpoint) {
      return NextResponse.json({ error: 'بيانات ناقصة' }, { status: 400 });
    }

    const { error } = await (await db())
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', body.endpoint)
      .eq('user_id', user.id);

    if (error) {
      console.error('[Push Unsubscribe]', error);
      return NextResponse.json({ error: 'فشل إلغاء الاشتراك' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Push Unsubscribe]', err);
    return NextResponse.json({ error: 'خطأ داخلي' }, { status: 500 });
  }
}
