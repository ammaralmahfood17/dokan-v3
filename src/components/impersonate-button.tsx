'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

/**
 * "Login as" (Phase C) — super-admin support impersonation.
 * Calls the impersonate API (re-checks membership server-side), swaps the
 * auth session to the target owner's minted session, sets the marker cookie,
 * and lands on the target's dashboard. The persistent banner then shows on
 * every page until ended or the 30-min expiry.
 */
export function ImpersonateButton({
  ownerUserId,
  ownerEmail,
  projectId,
  projectName,
}: {
  ownerUserId: string | null;
  ownerEmail: string;
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!ownerUserId) return null;

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/super-admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: ownerUserId, projectId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'فشل بدء الجلسة');
        return;
      }
      // Swap the auth cookie to the target owner's session (supabase/ssr
      // writes the cookie automatically), then set the marker.
      const supabase = createClient();
      await supabase.auth.setSession({
        access_token: data.targetSession.access_token,
        refresh_token: data.targetSession.refresh_token,
      });
      document.cookie = `dokan-impersonation=${data.sessionId}; path=/; max-age=${60 * 60 * 12}`;
      toast.success(`دخلت باسم ${ownerEmail}`);
      router.push('/dashboard');
      router.refresh();
    } catch {
      toast.error('فشل بدء الجلسة');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={busy}
      title={`الدخول كمستخدم: ${ownerEmail}`}
      className="btn btn-ghost btn-sm"
    >
      {busy ? '…' : 'دخول كمالك'}
    </button>
  );
}
