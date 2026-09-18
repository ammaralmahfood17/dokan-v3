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
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
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
