import { notFound } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { createAnonClient } from '@/lib/supabase/anon';
import { MenuClient } from './menu-client';
import type { Category, Product, ProductAddon, Project, Table } from '@/lib/types';

// The page itself is DYNAMIC (no `export const revalidate`): the subscription
// cutoff flips projects.is_active=false and that must cut the public menu
// IMMEDIATELY, not up to 60s later (a cached page would keep serving a
// deactivated store). Performance is preserved by unstable_cache on the menu
// queries below (60s, project-tagged, purged on edit via /api/revalidate-menu).
export const dynamicParams = true;

// M5: on-demand invalidation. Product/category edits call
// /api/revalidate-menu, which revalidateTag()s `menu-${projectId}`. The menu
// queries below are cached under that project-scoped tag, so an edit shows on
// the live QR menu immediately instead of waiting up to 60s (or longer with
// SWR). Wrapped in a function so the tag can be project-scoped (unstable_cache
// options are evaluated per call).
async function getMenuData(projectId: string, tableId: string) {
  return unstable_cache(
    async () => {
      const supabase = createAnonClient();
      const [{ data: categories }, { data: products }] = await Promise.all([
        supabase
          .from('categories')
          .select('id, name, sort_order, is_active')
          .eq('project_id', projectId)
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        supabase
          .from('products')
          .select('*, product_addons(*)')
          .eq('project_id', projectId)
          .eq('is_available', true)
          .order('sort_order'),
      ]);
      return {
        categories: (categories ?? []) as Category[],
        products: (products ?? []) as (Product & { product_addons: ProductAddon[] })[],
      };
    },
    ['menu-data', projectId, tableId],
    { revalidate: 60, tags: [`menu-${projectId}`] }
  )();
}

// Enable ISR for any slug combination: without generateStaticParams, async
// `params` force dynamic rendering (cache-control: no-store) regardless of
// revalidate. An empty list + dynamicParams=true opts into on-demand
// static generation: first visit builds the page, then it's cached & revalidated.
export async function generateStaticParams() {
  return [];
}

export default async function PublicMenuPage({
  params,
}: {
  params: Promise<{ projectSlug: string; tableSlug: string }>;
}) {
  const { projectSlug, tableSlug } = await params;
  // anon client (no user cookies) → RLS anon role → public menu data,
  // so signed-in users see other restaurants' menus too
  const supabase = createAnonClient();

  // Resolve active project by slug + HARD subscription check via the
  // SECURITY DEFINER RPC (anon can't read subscription_expires_at — 0006
  // column-scoped grants — and pg_cron's is_active flip is daily, which
  // would leak up to 24h of free service after expiry). Exact cutoff.
  const { data: isAvailable } = await supabase.rpc('is_project_publicly_available', {
    p_slug: projectSlug,
  });
  if (!isAvailable) notFound();

  // Explicit column list (NOT select('*')): anon has column-scoped grants
  // on projects (0006 hides created_by and subscription_expires_at).
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, slug, currency, primary_color, logo_url, is_active')
    .eq('slug', projectSlug)
    .eq('is_active', true)
    .maybeSingle();

  if (!project) notFound();

  // Resolve active table inside project
  const { data: table } = await supabase
    .from('tables')
    .select('id, number, slug, is_active, project_id')
    .eq('project_id', project.id)
    .eq('slug', tableSlug)
    .eq('is_active', true)
    .maybeSingle();

  if (!table) notFound();

  // M5: cached + project-tagged — see getMenuData above.
  const { categories, products } = await getMenuData(project.id, table.id);

  return (
    <>
      {/* FIX-M-006: JSON-LD structured data (Restaurant) — خاصية jsonLd مدعومة
          في React 19 runtime لكن @types/react لا يعرّفها بعد — cast محلي فقط.
          بدون dangerouslySetInnerHTML: يبقى المشروع صفر استخدام له. */}
      <script
        type="application/ld+json"
        {...({
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'Restaurant',
            name: project.name,
            url: `https://www.dokanstore.xyz/${projectSlug}`,
            servesCuisine: 'Gulf',
          },
        } as object)}
      />
      <MenuClient
        project={project as Project}
        table={table as Table}
        categories={categories}
        products={products}
      />
    </>
  );
}
