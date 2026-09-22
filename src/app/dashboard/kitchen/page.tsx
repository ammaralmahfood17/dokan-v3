import { redirect } from 'next/navigation';
import { getCurrentProject } from '@/lib/project';
import { createClient } from '@/lib/supabase/server';
import { KitchenClient } from './kitchen-client';
import type { Order, OrderItem } from '@/lib/types';

export default async function KitchenPage() {
  const ctx = await getCurrentProject();
  if (!ctx) redirect('/onboarding');

  const supabase = await createClient();

  // Fetch ALL active tickets, paged (1000/page) — a plain limit(50) silently
  // dropped the OLDEST tickets on a busy shift, exactly the ones the cook
  // needs to see first. Matches the analytics collectOrders pattern.
  const PAGE = 1000;
  const allOrders: unknown[] = [];
  let from = 0;
  for (;;) {
    const { data } = await supabase
      .from('orders')
      .select('*, tables(number), order_items(*)')
      .eq('project_id', ctx.project.id)
      .in('status', ['pending', 'preparing', 'ready'])
      .is('service_type', null)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    allOrders.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return (
    <KitchenClient
      projectId={ctx.project.id}
      projectName={ctx.project.name}
      initialOrders={
        allOrders as (Order & {
          tables?: { number: number } | null;
          order_items?: OrderItem[];
        })[]
      }
    />
  );
}
