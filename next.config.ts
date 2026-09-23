import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  // F1: Content-Security-Policy. Next.js needs 'unsafe-inline'/'unsafe-eval'
  // for its runtime scripts; Google Fonts (Cairo via next/font) needs
  // fonts.googleapis.com (style) + fonts.gstatic.com (font data); Supabase
  // is the API/WS origin; Sentry for error reporting. frame-ancestors 'none'
  // hardens against clickjacking on top of X-Frame-Options.
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.sentry.io https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' blob: data: https://*.supabase.co",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://sentry.io https://*.ingest.sentry.io",
      "font-src 'self' https://fonts.gstatic.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  async redirects() {
    // A2/UX-report: www + apex were duplicate content. Env-driven (never
    // hardcode a domain — repo contract): redirect www.<apex> → apex, 308.
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!siteUrl) return [];
    let host: string;
    try {
      host = new URL(siteUrl).hostname;
    } catch {
      return [];
    }
    if (host === 'localhost') return [];
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: `www.${host}` }],
        destination: `https://${host}/:path*`,
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      // A2: <project>.vercel.app serves the same app (e2e target) — keep it
      // out of search engines so the canonical domain is the only one indexed.
      {
        source: '/(.*)',
        has: [{ type: 'host', value: '(?<host>.+)\\.vercel\\.app' }],
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

// Sentry wraps the config; harmless without SENTRY_DSN (SDK no-ops).
// Auth tokens: no sentry.authToken set → CI/source-map upload disabled until
// the user adds Sentry credentials in the dashboard.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  telemetry: false,
  widenClientFileUpload: true,
});
