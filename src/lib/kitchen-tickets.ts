// FIX-C-003: Kitchen ticket domain — extracted verbatim from kitchen-client.tsx
// (audit item 2.4, pure move — no behavior change). Same home pattern as
// products-utils.ts for pure kitchen logic.

import type { Order, OrderItem, OrderStatus } from '@/lib/types';

export type OrderRow = Order & {
  tables?: { number: number } | null;
  order_items?: OrderItem[];
  service_type?: string | null;
  updated_at?: string;
};

/** Kitchen ticket = ONE full order (not a single item). */
export type Ticket = {
  order: OrderRow;
  /** Merged identical lines inside the ticket: "قهوة عربية بالهيل ×4" */
  lines: TicketLine[];
  totalQty: number;
};

export type TicketLine = {
  key: string;
  items: OrderItem[];
  quantity: number;
  productName: string;
  addons: { name: string }[];
  notes: string | null;
};

export const TAB_LABELS: Record<string, string> = {
  all: 'الكل',
  dinein: 'الطاولات',
  drivethru: 'الدرايف ثرو',
  walkin: 'كاونتر',
};

/* v1.1 Calm Surface mockup — three fixed stage columns (kanban board). */
export const STAGE_COLUMNS: [OrderStatus, string][] = [
  ['pending', 'جديد'],
  ['preparing', 'قيد التحضير'],
  ['ready', 'جاهز للتسليم'],
];

// Sort: new → preparing → ready; oldest first within each stage.
export const STAGE_RANK: Record<OrderStatus, number> = {
  pending: 0,
  preparing: 1,
  ready: 2,
  delivered: 3,
  cancelled: 4,
};

// Build tickets — one per order, identical lines merged inside.
export function buildTicket(o: OrderRow): Ticket {
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
}
