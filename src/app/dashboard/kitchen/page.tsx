import { redirect } from 'next/navigation';
import { getCurrentProject } from '@/lib/project';
import { createClient } from '@/lib/supabase/server';
import { KitchenClient } from './kitchen-client';
import type { Order, OrderItem } from '@/lib/types';

export default async function KitchenPage() {
  const ctx = await getCurrentProject();
  if (!ctx) redirect('/onboarding');

  const supabase = await createClient();
  const { data: orders } = await supabase
    .from('orders')
    .select('*, tables(number), order_items(*)')
    .eq('project_id', ctx.project.id)
    .in('status', ['pending', 'preparing', 'ready'])
    .is('service_type', null)
    .order('created_at', { ascending: true })
    .limit(50);

  return (
    <KitchenClient
      projectId={ctx.project.id}
      projectName={ctx.project.name}
      initialOrders={
        (orders ?? []) as unknown as (Order & {
          tables?: { number: number } | null;
          order_items?: OrderItem[];
        })[]
      }
    />
  );
}
