'use client';

// FIX-C-003: Kitchen ticket actions — extracted verbatim from
// kitchen-client.tsx (audit item 2.4, pure move — no behavior change).
// All status changes go through the transactional advance_order_status RPC
// with the screen's expected state (KDS state-transition rule).

import { Dispatch, SetStateAction, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { OrderItemStatus, OrderStatus } from '@/lib/types';
import type { OrderRow } from '@/lib/kitchen-tickets';
import { toast } from 'sonner';

export function useKitchenActions({
  orders,
  setOrders,
  fullRefresh,
}: {
  orders: OrderRow[];
  setOrders: Dispatch<SetStateAction<OrderRow[]>>;
  fullRefresh: () => Promise<void>;
}) {
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
    // setOrders: React guarantees the useState setter's identity is stable —
    // listing it satisfies exhaustive-deps with zero behavioral change.
    [orders, setOrders, fullRefresh]
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
    [orders, setOrders, fullRefresh]
  );

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
  }, [orders, setOrders, fullRefresh]);

  return { advanceOrder, deliverOrder, startAll };
}
