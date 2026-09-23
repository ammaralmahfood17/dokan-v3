import { redirect } from 'next/navigation';
import { getCurrentProject } from '@/lib/project';
import { createClient } from '@/lib/supabase/server';
import { OrdersClient } from './orders-client';
import type { Order, OrderItem } from '@/lib/types';

export default async function OrdersPage() {
  const ctx = await getCurrentProject();
  if (!ctx) redirect('/onboarding');

  const supabase = await createClient();

  // Filter: only real orders (not waiter/bill requests), today only
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // UX-report C1: a busy day silently truncated at 50 rows — day totals and
  // status counts were computed client-side from the first 50 orders only.
  // Paged loop per repo contract (1000/page); hard stop 5 pages (5000/day is
  // far beyond any Dokan merchant; client then shows what it got).
  const orders: NonNullable<Awaited<ReturnType<typeof fetchOrderPage>>> = [];
  for (let p = 0; p < 5; p++) {
    const page = await fetchOrderPage(supabase, ctx.project.id, today, p);
    if (!page) break;
    orders.push(...page);
    if (page.length < 1000) break;
  }

  async function fetchOrderPage(
    client: Awaited<ReturnType<typeof createClient>>,
    projectId: string,
    since: Date,
    pageIndex: number
  ) {
    const { data } = await client
      .from('orders')
      .select('*, tables(number, slug), order_items(*)')
      .eq('project_id', projectId)
      .is('service_type', null) // null = real order (not waiter/bill)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .range(pageIndex * 1000, pageIndex * 1000 + 999);
    return data;
  }

  return (
    <OrdersClient
      projectId={ctx.project.id}
      currency={ctx.project.currency}
      initialOrders={orders as unknown as (Order & {
        tables?: { number: number; slug: string } | null;
        order_items?: OrderItem[];
      })[]}
    />
  );
}
