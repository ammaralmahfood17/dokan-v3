'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  type Order,
  type OrderItem,
  type OrderItemStatus,
  type OrderStatus,
  ORDER_STATUS_LABELS,
} from '@/lib/types';
import { toast } from 'sonner';

type OrderRow = Order & {
  tables?: { number: number } | null;
  order_items?: OrderItem[];
  service_type?: string | null;
  updated_at?: string;
};

/** Kitchen ticket = ONE full order (not a single item). */
type Ticket = {
  order: OrderRow;
  /** Merged identical lines inside the ticket: "قهوة عربية بالهيل ×4" */
  lines: TicketLine[];
  totalQty: number;
};

type TicketLine = {
  key: string;
  items: OrderItem[];
  quantity: number;
  productName: string;
  addons: { name: string }[];
  notes: string | null;
};

const TAB_LABELS: Record<string, string> = {
  all: 'الكل',
  dinein: 'الطاولات',
  drivethru: 'الدرايف ثرو',
  walkin: 'كاونتر',
};

/* v1.1 Calm Surface mockup — three fixed stage columns (kanban board). */
const STAGE_COLUMNS: [OrderStatus, string][] = [
  ['pending', 'جديد'],
  ['preparing', 'قيد التحضير'],
  ['ready', 'جاهز للتسليم'],
];

/* ========== Audio System (FIX-C-002: extracted hook) ========== */
import { useKitchenAudio } from '@/components/dashboard/kitchen/use-kitchen-audio';
// FIX-C-002: بطاقة الطلب مستخرجة
import { KitchenTicket } from '@/components/dashboard/kitchen/kitchen-ticket';

/* ========== Page title flashing (ref-based, tied to component) ========== */

function useTitleFlash() {
  const originalTitleRef = useRef('');
  const flashIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopFlash = useCallback(() => {
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    if (flashIntervalRef.current) {
      clearInterval(flashIntervalRef.current);
      flashIntervalRef.current = null;
    }
    if (originalTitleRef.current) document.title = originalTitleRef.current;
  }, []);

  const flashTitle = useCallback(
    (count: number) => {
      if (!originalTitleRef.current) originalTitleRef.current = document.title;
      // Cancel any in-flight flash first — otherwise the OLD 10s timeout
      // would fire mid-new-flash, kill the new interval and restore the
      // title early.
      stopFlash();

      let showAlert = true;
      flashIntervalRef.current = setInterval(() => {
        document.title = showAlert
          ? `🔔 ${count} طلب جديد | ${originalTitleRef.current}`
          : originalTitleRef.current;
        showAlert = !showAlert;
      }, 1000);

      stopTimeoutRef.current = setTimeout(stopFlash, 10000);
    },
    [stopFlash]
  );

  const clearFlash = useCallback(() => {
    stopFlash();
  }, [stopFlash]);

  const syncTitle = useCallback(() => {
    originalTitleRef.current = document.title;
  }, []);

  const resetTitle = useCallback(() => {
    stopFlash();
    originalTitleRef.current = '';
  }, [stopFlash]);

  // Never survive the component: a late timeout firing after unmount would
  // clobber the next page's title.
  useEffect(() => {
    return () => {
      stopFlash();
      originalTitleRef.current = '';
    };
  }, [stopFlash]);

  return { flashTitle, clearFlash, syncTitle, resetTitle };
}

/* ========== Component ========== */

export function KitchenClient({
  projectId,
  projectName,
  initialOrders,
}: {
  projectId: string;
  projectName: string;
  initialOrders: OrderRow[];
}) {
  const [orders, setOrders] = useState(initialOrders);
  const knownIds = useRef(new Set(initialOrders.map((o) => o.id)));
  // Ids added via realtime INSERT — fullRefresh must preserve them even if a
  // poll snapshot was taken before their commit (see fullRefresh merge).
  const realtimeAddedRef = useRef<Set<string>>(new Set());
  // Ids touched by a realtime UPDATE since the last poll — fullRefresh must
  // keep the fresher local row instead of letting an older snapshot win.
  const realtimeTouchedRef = useRef<Set<string>>(new Set());
  // M3: ids currently on our board. order_items has no project_id column and
  // Supabase realtime can't filter by a joined orders.project_id, so we
  // filter incoming order_items events client-side against this set — other
  // tenants' item changes are dropped without a fetch.
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const [soundOn, setSoundOn] = useState(true);
  const [newOrderCount, setNewOrderCount] = useState(0);
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
  );
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<'all' | 'dinein' | 'drivethru' | 'walkin'>('all');

  const { playChime, ensureAudioReady, preloadChime, attachAudioResumeOnInteraction } = useKitchenAudio();
  const { flashTitle, clearFlash, syncTitle, resetTitle } = useTitleFlash();

  // Clock + tick — كل دقيقة (60s) لأن العرض بالدقائق
  useEffect(() => {
    const id = setInterval(() => {
      setTime(new Date().toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' }));
      setNow(Date.now());
    }, 60000);
    return () => clearInterval(id);
  }, []);

  // Preload chime on mount
  useEffect(() => {
    preloadChime();
    return attachAudioResumeOnInteraction();
  }, [preloadChime, attachAudioResumeOnInteraction]);

  // Flash title when new orders come in
  useEffect(() => {
    if (newOrderCount > 0) {
      flashTitle(newOrderCount);
    } else {
      clearFlash();
    }
    return () => clearFlash();
  }, [newOrderCount, flashTitle, clearFlash]);

  // Sync originalTitle on mount
  useEffect(() => {
    syncTitle();
    return () => resetTitle();
  }, [syncTitle, resetTitle]);

  // Notification helper
  const notifyNewOrder = useCallback((orderNum: number) => {
    if (soundOn) {
      playChime();
      try { navigator.vibrate?.(200); } catch {}
    }
    toast.message('🔔 طلب جديد', {
      description: `#${orderNum}`,
    });
    setNewOrderCount((c) => c + 1);
  }, [soundOn, playChime]);

  // Full refresh fallback
  const fullRefresh = useCallback(async () => {
    try {
      const supabase = createClient();
      // Paged loop (1000/page) — a plain limit(50) silently dropped the
      // OLDEST active tickets (the ones a cook needs most) on a busy shift.
      const PAGE = 1000;
      const rows: OrderRow[] = [];
      let from = 0;
      for (;;) {
        const { data } = await supabase
          .from('orders')
          .select('*, tables(number), order_items(*)')
          .eq('project_id', projectId)
          .in('status', ['pending', 'preparing', 'ready'])
          .is('service_type', null)
          .order('created_at', { ascending: true })
          .range(from, from + PAGE - 1);
        if (!data) return;
        rows.push(...(data as unknown as OrderRow[]));
        if (data.length < PAGE) break;
        from += PAGE;
      }

      // Oldest first (FIFO) — matches the server's initial query, so a poll
      // snapshot covers every open ticket, not just the first page.

      for (const o of rows) {
        if (!knownIds.current.has(o.id) && o.status === 'pending') {
          notifyNewOrder(o.order_number);
        }
        knownIds.current.add(o.id);
      }
      // Bound the dedupe set — drop ids of delivered/cancelled/old orders once
      // it grows too large (realtime ids are re-added on INSERT).
      if (knownIds.current.size > 300) {
        knownIds.current = new Set(rows.map((o) => o.id));
      }
      // Merge instead of wholesale replace: a ticket inserted via realtime
      // between this snapshot and its commit must not vanish from the board
      // just because the poll response arrived without it.
      setOrders((prev) => {
        const byId = new Map(rows.map((o) => [o.id, o]));
        for (const o of prev) {
          if (realtimeAddedRef.current.has(o.id) && !byId.has(o.id)) {
            byId.set(o.id, o);
          }
          // A realtime UPDATE may have landed after this snapshot was taken —
          // prefer the local row so the poll can't overwrite fresher state.
          const snap = byId.get(o.id);
          if (
            snap &&
            realtimeTouchedRef.current.has(o.id) &&
            (o.updated_at ?? '') >= (snap.updated_at ?? '')
          ) {
            byId.set(o.id, o);
          }
        }
        return [...byId.values()];
      });
      realtimeAddedRef.current.clear();
      realtimeTouchedRef.current.clear();
    } catch (err) {
      // Silently fail the refresh — keep the previous board state.
      console.error('fullRefresh failed', err);
    }
  }, [projectId, notifyNewOrder]);

  // Fetch single order
  const fetchSingleOrder = useCallback(
    async (orderId: string) => {
      const supabase = createClient();
      const { data } = await supabase
        .from('orders')
        .select('*, tables(number), order_items(*)')
        .eq('id', orderId)
        .eq('project_id', projectId)
        .single();
      return data as OrderRow | null;
    },
    [projectId]
  );

  // Realtime item updates from another screen — refetch that order so the
  // board stays in sync even when the change came from elsewhere.
  const refetchOrder = useCallback(
    async (orderId: string) => {
      const fresh = await fetchSingleOrder(orderId);
      if (!fresh) return;
      setOrders((prev) => {
        const exists = prev.some((o) => o.id === orderId);
        if (!exists) return prev;
        return prev.map((o) => (o.id === orderId ? fresh : o));
      });
    },
    [fetchSingleOrder]
  );

  // M3: keep the known-id set in sync with the board.
  useEffect(() => {
    knownOrderIdsRef.current = new Set(orders.map((o) => o.id));
  }, [orders]);

  // Realtime
  useEffect(() => {
    const supabase = createClient();

    // NOTE: no project_id filter on these channels. RLS (orders_staff_*
    // policies) already isolates events per tenant — verified live with a
    // probe: filter+RLS on the same column made realtime drop EVERY event,
    // so orders took up to 30s to appear (30s fallback poll). Without the
    // filter, events arrive in ~1s and cross-tenant events are still
    // blocked by RLS. See migration 0018 note.
    const itemRefetchTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const channel = supabase
      .channel(`kds-${projectId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        async (payload) => {
          const newOrder = payload.new as Partial<OrderRow>;
          const newId = newOrder.id as string;
          if (!newId || knownIds.current.has(newId)) return;
          if (newOrder.service_type) return;

          try {
            const fullOrder = await fetchSingleOrder(newId);
            if (!fullOrder) return;

            knownIds.current.add(newId);
            realtimeAddedRef.current.add(newId);
            notifyNewOrder(fullOrder.order_number);
            setOrders((prev) => [fullOrder, ...prev]);
          } catch (err) {
            // Keep the board as-is; the next poll will pick the order up.
            console.error('fetchSingleOrder failed', err);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          const updated = payload.new as Partial<OrderRow>;
          if (updated.id) realtimeTouchedRef.current.add(updated.id);
          setOrders((prev) => {
            if (updated.status === 'delivered' || updated.status === 'cancelled') {
              return prev.filter((o) => o.id !== updated.id);
            }
            return prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o));
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'orders' },
        (payload) => {
          const deletedId = payload.old?.id as string;
          setOrders((prev) => prev.filter((o) => o.id !== deletedId));
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'order_items' },
        (payload) => {
          // Item moved by another screen — refetch that order to keep the
          // board correct. M3: order_items has no project_id and realtime
          // can't join-filter, so drop events for orders not on our board
          // before fetching — other tenants' updates are pure noise.
          const itemOrderId = (payload.new as { order_id: string }).order_id;
          if (!knownOrderIdsRef.current.has(itemOrderId)) return;
          // Trailing-debounce per order (500ms, orders-client pattern): a
          // burst of order_items UPDATEs (POS editing several lines) must
          // collapse into ONE refetch of that order.
          const pending = itemRefetchTimers.get(itemOrderId);
          if (pending) clearTimeout(pending);
          itemRefetchTimers.set(
            itemOrderId,
            setTimeout(() => {
              itemRefetchTimers.delete(itemOrderId);
              void refetchOrder(itemOrderId);
            }, 500)
          );
        }
      )
      .subscribe();

    // Fallback polling every 30s
    const interval = setInterval(() => void fullRefresh(), 30000);

    return () => {
      itemRefetchTimers.forEach((t) => clearTimeout(t));
      itemRefetchTimers.clear();
      void supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [projectId, fullRefresh, fetchSingleOrder, notifyNewOrder, refetchOrder]);

  // Clear new order badge when user interacts with the page
  const clearBadge = useCallback(() => {
    setNewOrderCount(0);
  }, []);

  // ---------- Ticket-level KDS ----------

  // Advance a WHOLE order: every line → toItem, order → toOrder status.
  // Uses the transactional advance_order_status RPC — status-checked
  // (a stale screen can't revive a cancelled order) and atomic
  // (order + items advance together; no stuck-items window).
  const advanceOrder = useCallback(
    async (orderId: string, toItem: OrderItemStatus, toOrder: OrderStatus) => {
      const supabase = createClient();
      // Expected state = what THIS screen believes is current. If the DB has
      // moved on (cancelled/advanced elsewhere), the RPC rejects it.
      const current = orders.find((o) => o.id === orderId)?.status;
      if (!current) return; // not on the board anymore
      const { data, error } = await supabase.rpc('advance_order_status', {
        p_order_id: orderId,
        p_expected_status: current,
        p_new_status: toOrder,
      });
      if (error) {
        if (error.message.includes('STALE_STATUS')) {
          toast.error('تم تحديث حالة هذا الطلب من جهاز آخر', {
            description: 'جارٍ تحديث الشاشة…',
          });
          await fullRefresh();
        } else {
          toast.error('فشل تحديث حالة الطلب');
        }
        return;
      }
      if (!data) return;
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId
            ? {
                ...o,
                status: toOrder,
                order_items: (o.order_items ?? []).map((it) => ({ ...it, status: toItem })),
              }
            : o
        )
      );
    },
    [orders, fullRefresh]
  );

  // Deliver — order leaves the kitchen board. Status-checked via RPC:
  // only advances from 'ready', so a stale screen can't deliver a cancelled order.
  const deliverOrder = useCallback(
    async (orderId: string) => {
      const supabase = createClient();
      const current = orders.find((o) => o.id === orderId)?.status;
      if (!current) return;
      const { error } = await supabase.rpc('advance_order_status', {
        p_order_id: orderId,
        p_expected_status: current,
        p_new_status: 'delivered',
      });
      if (error) {
        if (error.message.includes('STALE_STATUS')) {
          toast.error('تم تحديث حالة هذا الطلب من جهاز آخر', {
            description: 'جارٍ تحديث الشاشة…',
          });
          await fullRefresh();
        } else {
          toast.error('فشل التحديث');
        }
        return;
      }
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
    },
    [orders, fullRefresh]
  );

  // Build tickets — one per order, identical lines merged inside.
  const buildTicket = useCallback((o: OrderRow): Ticket => {
    const lines = new Map<string, TicketLine>();
    let totalQty = 0;
    for (const it of o.order_items ?? []) {
      totalQty += it.quantity;
      const addons = Array.isArray(it.addons) ? (it.addons as { name: string }[]) : [];
      const key = `${it.product_id ?? ''}|${JSON.stringify(addons)}|${it.notes ?? ''}`;
      const existing = lines.get(key);
      if (existing) {
        existing.items.push(it);
        existing.quantity += it.quantity;
      } else {
        lines.set(key, {
          key,
          items: [it],
          quantity: it.quantity,
          productName: it.product_name,
          addons,
          notes: it.notes,
        });
      }
    }
    return { order: o, lines: [...lines.values()], totalQty };
  }, []);

  // Start EVERY pending order in one tap (fast-service flow).
  // Per-order RPC calls so a stale/cancelled order can't fail the whole
  // batch — failures are collected and surfaced, the rest still advance.
  const startAll = useCallback(async () => {
    const pendingOrders = orders.filter((o) => o.status === 'pending');
    if (!pendingOrders.length) return;
    const supabase = createClient();
    const results = await Promise.all(
      pendingOrders.map(async (o) => {
        const { data, error } = await supabase.rpc('advance_order_status', {
          p_order_id: o.id,
          p_expected_status: 'pending',
          p_new_status: 'preparing',
        });
        return { orderId: o.id, orderNumber: o.order_number, data, error };
      })
    );
    const failed = results.filter((r) => r.error);
    const staleCount = failed.filter((r) => r.error?.message.includes('STALE_STATUS')).length;
    const otherCount = failed.length - staleCount;
    if (staleCount > 0) {
      toast.error(`تغيّرت حالة ${staleCount} من الطلبات على جهاز آخر`, {
        description: 'لم يتم تشغيلها — جارٍ تحديث الشاشة…',
      });
    }
    if (otherCount > 0) {
      toast.error(`فشل تشغيل ${otherCount} من الطلبات`);
    }
    if (failed.length > 0) {
      await fullRefresh();
    } else {
      setOrders((prev) =>
        prev.map((o) =>
          o.status === 'pending'
            ? {
                ...o,
                status: 'preparing',
                order_items: (o.order_items ?? []).map((it) => ({ ...it, status: 'preparing' })),
              }
            : o
        )
      );
    }
  }, [orders, fullRefresh]);

  // ---------- Derived view ----------

  const tickets = orders.map(buildTicket);

  const countByTab = {
    all: tickets.length,
    dinein: tickets.filter((t) => t.order.type === 'dinein').length,
    drivethru: tickets.filter((t) => t.order.type === 'drivethru').length,
    walkin: tickets.filter((t) => t.order.type === 'walkin').length,
  };

  const visibleTickets =
    tab === 'all'
      ? tickets
      : tickets.filter((t) => (t.order.type ?? null) === tab);

  // Sort: new → preparing → ready; oldest first within each stage.
  const stageRank: Record<OrderStatus, number> = {
    pending: 0,
    preparing: 1,
    ready: 2,
    delivered: 3,
    cancelled: 4,
  };
  const sorted = [...visibleTickets].sort((a, b) => {
    const ra = stageRank[a.order.status] ?? 0;
    const rb = stageRank[b.order.status] ?? 0;
    if (ra !== rb) return ra - rb;
    return a.order.created_at.localeCompare(b.order.created_at);
  });

  const pendingCount = tickets.filter((t) => t.order.status === 'pending').length;
  // UX-U15: إحصاء الذروة الحي — عدد قيد التحضير
  const preparingCount = tickets.filter((t) => t.order.status === 'preparing').length;

  return (
    <div className="min-h-dvh bg-[var(--color-bg)]" onClick={clearBadge}>
      {/* Header — Scan Grid: title + tabs + actions */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-4">
        <div className="flex items-center gap-2.5">
          <h1 className="font-display text-[16px] font-bold text-[var(--color-text)]">
            {projectName} — شاشة المطبخ
          </h1>
          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--color-text-secondary)]">
            <span className="h-[7px] w-[7px] rounded-full bg-[var(--color-success)]" aria-hidden="true" />
            متصل مباشر
          </span>
        </div>

        <nav className="flex items-center gap-5 text-[13px]" aria-label="تصنيف الطلبات">
          {(['all', 'dinein', 'drivethru', 'walkin'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`relative min-h-[44px] font-semibold transition-colors ${
                tab === t
                  ? 'text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {TAB_LABELS[t]}
              <span className="ms-1 font-mono text-[11px] tabular-nums opacity-70">
                · {String(countByTab[t]).padStart(2, '0')}
              </span>
              {tab === t && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--color-primary)]" />
              )}
            </button>
          ))}
        </nav>

        {/* FIX-A-006: إعلام قارئ الشاشة بوصول طلبات جديدة */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {pendingCount > 0 ? `وصل ${pendingCount} طلبات جديدة` : ''}
        </div>

        <div className="flex items-center gap-2.5">
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={startAll}
              className="flex min-h-[44px] items-center gap-1.5 rounded-[7px] bg-[var(--color-primary)] px-4 text-[12px] font-bold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
            >
              ⚡ بدء الكل ({pendingCount})
            </button>
          )}
          {/* UX-U15: مؤشر الذروة الحي */}
          <span className="flex items-center gap-1.5 rounded-[7px] bg-[var(--color-primary-tint)] px-3 py-1.5 text-[12px] font-bold tabular-nums text-[var(--color-primary)]" aria-live="polite">
            قيد التحضير: {preparingCount}
          </span>
          <span className="font-mono text-[15px] tabular-nums text-[var(--color-text-muted)]" dir="ltr">
            {time}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSoundOn((s) => !s);
            }}
            aria-label={soundOn ? 'كتم الصوت' : 'تفعيل الصوت'}
            aria-pressed={soundOn}
            className="flex min-h-[44px] items-center rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)]"
          >
            <span aria-hidden="true">{soundOn ? '🔊' : '🔇'}</span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!soundOn) setSoundOn(true);
              playChime();
              toast.success('🔔 صوت التنبيه', { description: 'صوت الإشعار يعمل ✅' });
            }}
            title="اختبار الصوت"
            className="flex min-h-[44px] items-center rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-success)]"
          >
            <span aria-hidden="true">🔊</span> اختبار
          </button>
        </div>
      </header>

      {/* Board — Calm Surface mockup: three fixed stage columns */}
      <main
        className="flex gap-4 overflow-x-auto p-5"
        role="region"
        aria-label="تذاكر المطبخ"
        tabIndex={0}
      >
        {sorted.length === 0 ? (
          <div className="flex min-h-[40vh] w-full flex-col items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] text-[var(--color-text-tertiary)]">
            <span className="text-2xl">📡</span>
            <span className="mt-2 text-[13px]">بانتظار الطلبات…</span>
          </div>
        ) : (
          STAGE_COLUMNS.map(([stage, label]) => {
            const stageTickets = sorted.filter((t) => t.order.status === stage);
            return (
              <section
                key={stage}
                className={`flex shrink-0 flex-col gap-3 min-w-[280px] flex-1`}
                aria-label={label}
              >
                <div className="flex items-center justify-between px-0.5">
                  <h2 className="text-[13.5px] font-bold text-[var(--color-text-secondary)]">
                    {label}
                  </h2>
                  <span className="rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 py-0.5 text-[12px] font-bold tabular-nums text-[var(--color-text-tertiary)]">
                    {stageTickets.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2.5 overflow-y-auto pb-2">
                  {stageTickets.map((t) => (
                    <KitchenTicket
                      key={t.order.id}
                      ticket={t}
                      now={now}
                      onStart={() => advanceOrder(t.order.id, 'preparing', 'preparing')}
                      onReady={() => advanceOrder(t.order.id, 'ready', 'ready')}
                      onDeliver={() => deliverOrder(t.order.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </main>
    </div>
  );
}
