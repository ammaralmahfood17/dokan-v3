import { getSiteUrl } from '@/lib/site-url';

/**
 * robots.txt — allow all crawlers on canonical domain, disallow dashboard/api.
 * On *.vercel.app hosts, X-Robots-Tag: noindex is set via next.config.ts
 * (A2 domain canonicalization) so search engines never index preview deploys.
 */
export default function robots() {
  const siteUrl = getSiteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard', '/api', '/super-admin'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}