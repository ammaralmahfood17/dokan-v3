import { redirect } from 'next/navigation';
import { getCurrentProject } from '@/lib/project';
import { createClient } from '@/lib/supabase/server';
import { TablesClient } from './tables-client';
import type { Table } from '@/lib/types';

export default async function TablesPage() {
  const ctx = await getCurrentProject();
  if (!ctx) redirect('/onboarding');

  const supabase = await createClient();
  const { data: tables } = await supabase
    .from('tables')
    .select('*')
    .eq('project_id', ctx.project.id)
    .order('number');

  // Which tables have ACTIVE orders right now (pending/preparing/ready)?
  // Shown as a مشغولة/متاحة chip on each table card.
  const { data: activeOrders } = await supabase
    .from('orders')
    .select('table_id')
    .eq('project_id', ctx.project.id)
    .is('service_type', null)
    .not('table_id', 'is', null)
    .in('status', ['pending', 'preparing', 'ready']);
  const occupiedTableIds = new Set(
    (activeOrders ?? []).map((o) => o.table_id).filter(Boolean)
  );

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
    'http://localhost:3000';

  return (
    <TablesClient
      projectId={ctx.project.id}
      projectSlug={ctx.project.slug}
      siteUrl={siteUrl}
      initialTables={(tables ?? []) as Table[]}
      occupiedTableIds={occupiedTableIds}
    />
  );
}
