import { getSiteUrl } from '@/lib/site-url';

/**
 * sitemap.xml — static routes. Storefront pages are dynamic and not included
 * until a per-store sitemap is warranted.
 */
export default function sitemap() {
  const siteUrl = getSiteUrl();
  const staticRoutes = ['', '/register', '/login', '/terms', '/privacy'];

  return staticRoutes.map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === '' ? ('weekly' as const) : ('monthly' as const),
    priority: route === '' ? 1.0 : 0.6,
  }));
}