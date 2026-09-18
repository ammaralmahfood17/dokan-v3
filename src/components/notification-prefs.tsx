'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing, Loader2, Send } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { toast } from 'sonner';

/**
 * Per-staff notification channel prefs (إشعارات المتصفح / تيليجرام).
 * Loads on mount via GET; each toggle optimistically PUTs both flags and
 * re-fetches on failure (single source of truth = the server row).
 */
export function NotificationPrefs({ projectId }: { projectId: string }) {
  const [notifyPush, setNotifyPush] = useState<boolean | null>(null);
  const [notifyTelegram, setNotifyTelegram] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/staff/notification-prefs?projectId=${encodeURIComponent(projectId)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setNotifyPush(data.notify_push);
      setNotifyTelegram(data.notify_telegram);
    } catch {
      // Leave toggles hidden (null) — network hiccup, user can retry by
      // reopening settings.
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(
          `/api/staff/notification-prefs?projectId=${encodeURIComponent(projectId)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setNotifyPush(data.notify_push);
          setNotifyTelegram(data.notify_telegram);
        }
      } catch {
        // Leave toggles hidden (null) — network hiccup, user can retry by
        // reopening settings.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const save = useCallback(
    async (push: boolean, tg: boolean) => {
      setSaving(true);
      try {
        const res = await fetch('/api/staff/notification-prefs', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, notifyPush: push, notifyTelegram: tg }),
        });
        if (!res.ok) throw new Error('save failed');
        toast.success('تم الحفظ');
      } catch {
        toast.error('ما قدرت نحفظ — حاول مرة ثانية');
        await load(); // revert to server truth
      } finally {
        setSaving(false);
      }
    },
    [projectId, load]
  );

  const ready = notifyPush !== null && notifyTelegram !== null;

  return (
    <div className="card card-body">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--color-primary-tint)] text-[var(--color-primary)]">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <BellRing className="h-4 w-4" />
          )}
        </div>
        <div>
          <p className="text-sm font-bold">قنوات التنبيه</p>
          <p className="text-xs text-[var(--color-text-secondary)]">
            اختار على أي قناة توصلك تنبيهات الطلبات الجديدة — حتى لو الموقع مقفول
          </p>
        </div>
      </div>

      <div className="mt-3 divide-y divide-[var(--color-border)]">
        <div className="flex items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-3">
            <BellRing className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
            <div>
              <p className="text-sm font-semibold">إشعارات المتصفح</p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                تصل لأجهزتك المفعّلة (Web Push)
              </p>
            </div>
          </div>
          <Toggle
            checked={ready ? notifyPush : false}
            disabled={!ready || saving}
            aria-label="إشعارات المتصفح"
            onChange={(v) => {
              setNotifyPush(v);
              save(v, notifyTelegram ?? true);
            }}
          />
        </div>

        <div className="flex items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-3">
            <Send className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
            <div>
              <p className="text-sm font-semibold">إشعارات تيليجرام</p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                تصل لمحادثاتك المربوطة بالبوت
              </p>
            </div>
          </div>
          <Toggle
            checked={ready ? notifyTelegram : false}
            disabled={!ready || saving}
            aria-label="إشعارات تيليجرام"
            onChange={(v) => {
              setNotifyTelegram(v);
              save(notifyPush ?? true, v);
            }}
          />
        </div>
      </div>
    </div>
  );
}
