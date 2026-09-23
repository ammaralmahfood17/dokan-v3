/**
 * Shared public-project resolution — DRY between storefront and menu pages.
 * Both need the same slug→project resolution with the RPC availability
 * check, anon client, and column-scoped select list.
 */
import { createAnonClient } from '@/lib/supabase/anon';
import type { Project } from '@/lib/types';

export async function getPublicProject(
  slug: string,
): Promise<(Pick<Project, 'id' | 'name' | 'slug' | 'currency' | 'primary_color' | 'logo_url' | 'is_active'>) | null> {
  const supabase = createAnonClient();

  // HARD subscription check — anon can't read subscription_expires_at (0006
  // column-scoped grants). The SECURITY DEFINER RPC does the exact cutoff.
  const { data: isAvailable } = await supabase.rpc('is_project_publicly_available', {
    p_slug: slug,
  });
  if (!isAvailable) return null;

  // Explicit column list: anon has column-scoped grants on projects (0006).
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, slug, currency, primary_color, logo_url, is_active')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  return project ?? null;
}