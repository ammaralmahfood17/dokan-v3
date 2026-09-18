'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

/**
 * Persistent support-mode banner. Rendered by the dashboard layout while an
 * impersonation session is active. One-click end: swaps the auth cookie back
 * to the super admin's stored session, clears the marker, reloads.
 *
 * The marker cookie is read server-side by the layout; this component only
 * receives the display data + sessionId.
 */
export function ImpersonationBanner({
  targetEmail,
  expiresAt,
  sessionId,
  expired = false,
}: {
  targetEmail: string;
  expiresAt: string;
  sessionId: string;
  expired?: boolean;
}) {
  const router = useRouter();
  const [ending, setEnding] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const minsLeft = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60000));

  async function end() {
    if (ending) return;
    setEnding(true);
    try {
      const res = await fetch('/api/super-admin/impersonate/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'فشل إنهاء الجلسة');
        setEnding(false);
        return;
      }
      // Swap the auth cookie back to the super admin's own session.
      if (data.superAdminSession) {
        const supabase = createClient();
        await supabase.auth.setSession({
          access_token: data.superAdminSession.access_token,
          refresh_token: data.superAdminSession.refresh_token,
        });
      }
      // Clear the marker cookie and reload.
      document.cookie = 'dokan-impersonation=; path=/; max-age=0';
      router.push('/super-admin/subscriptions');
      router.refresh();
    } catch {
      toast.error('ما قدرت ننهي الجلسة — حاول مرة ثانية');
      setEnding(false);
    }
  }

  return (
    <div className="sticky top-0 z-[var(--z-toast)] w-full border-b border-[var(--color-danger)]/30 bg-[var(--color-danger)] px-4 py-2.5 text-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold">
          ⚠️ {expired ? (
            <>انتهت مدة جلسة الدعم الفني — استعد جلستك</>
          ) : (
            <>
              وضع الدعم الفني — تسجّل دخول باسم{' '}
              <span className="underline underline-offset-2" dir="ltr">
                {targetEmail}
              </span>
              <span className="ms-2 font-medium opacity-90">
                ({minsLeft > 0 ? `متبقي ${minsLeft} دقيقة` : 'تنتهي الآن'})
              </span>
            </>
          )}
        </p>
        <button
          type="button"
          onClick={end}
          disabled={ending}
          className="rounded-[var(--radius-md)] bg-white px-3 py-1.5 text-xs font-bold text-[var(--color-danger)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {ending ? 'جاري الإنتهاء…' : 'إنهاء الجلسة'}
        </button>
      </div>
    </div>
  );
}
