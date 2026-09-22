/**
 * Sentry client config — browser errors.
 * Disabled until SENTRY_DSN is set in Vercel env (SDK no-ops without a DSN).
 *
 * PII policy: sendDefaultPii is OFF, and beforeSend strips the IP that some
 * browser integrations (Replay) may attach — merchant/customer data must
 * never leave the org via error telemetry.
 */
import * as Sentry from '@sentry/nextjs';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1,
    environment: process.env.VERCEL_ENV || 'development',
    sendDefaultPii: false,
    beforeSend(event) {
      // Browser events have no `request` object (that's server/edge); the only
      // PII that can appear here is user.ip_address via Replay integration.
      if (event.user) delete event.user.ip_address;
      return event;
    },
  });
}
