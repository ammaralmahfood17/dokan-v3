import { createAdminClient } from './supabase/admin';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Send a push notification to all staff of a project
 * Returns { sent, failed } counts
 */
export async function sendPushToProject(
  projectId: string,
  payload: PushPayload
) {
  if (typeof window !== 'undefined') {
    // Called accidentally from client — silently skip.
    // NOTE: must check `window`, NOT `navigator` — Node 21+ (Vercel uses 24.x)
    // ships a global `navigator`, so that guard always fired server-side and
    // silently skipped every push in production.
    return { sent: 0, failed: 0 };
  }

  const webpush = await import('web-push');
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
  const privateKey = process.env.VAPID_PRIVATE_KEY!;
  const contact = process.env.VAPID_CONTACT || 'mailto:admin@dokanstore.xyz';

  if (!publicKey || !privateKey) {
    console.warn('[Push] VAPID keys not configured — skipping');
    return { sent: 0, failed: 0, cleaned: 0 };
  }

  webpush.setVapidDetails(contact, publicKey, privateKey);

  const admin = createAdminClient();

  // Only staff who opted in for push (notify_push) receive order alerts.
  // Fetch opted-in staff ids FIRST, then filter subscriptions — passing a
  // query builder into .in() throws "object is not iterable" (TypeError).
  const { data: optedInStaff } = await admin
    .from('staff_members')
    .select('user_id')
    .eq('project_id', projectId)
    .eq('notify_push', true);

  const optedInIds = (optedInStaff ?? []).map((s: any) => s.user_id);
  if (!optedInIds.length) return { sent: 0, failed: 0, cleaned: 0 };

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('project_id', projectId)
    .in('user_id', optedInIds);

  if (!subs?.length) return { sent: 0, failed: 0, cleaned: 0 };

  const results = await Promise.allSettled(
    subs.map((sub: any) =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload),
        { urgency: 'high' }
      )
    )
  );

  let sent = 0;
  let failed = 0;
  const expiredEndpoints: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      sent++;
    } else {
      failed++;
      // B7: web-push lacks TS types for the error object — narrow through
      // unknown instead of `as any` (keeps type safety at the boundary).
      const reason = r.reason as unknown as {
        statusCode?: number;
        body?: string;
        message?: string;
      };
      // AR-7: سطر الفشل فقط في الإنتاج (بدون ضجيج لكل إرسال ناجح/ملخص)
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Push] sub', i, 'FAILED —', reason?.statusCode, reason?.body || reason?.message);
      }
      if (reason?.statusCode === 410 || reason?.statusCode === 404) {
        expiredEndpoints.push(subs[i].endpoint);
      }
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('[Push] result — sent:', sent, 'failed:', failed, 'cleaned:', expiredEndpoints.length);
  }

  // Clean up expired subscriptions
  if (expiredEndpoints.length > 0) {
    await admin
      .from('push_subscriptions')
      .delete()
      .in('endpoint', expiredEndpoints);
  }

  return { sent, failed, cleaned: expiredEndpoints.length };
}
