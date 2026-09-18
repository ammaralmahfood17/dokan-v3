/**
 * Next.js instrumentation — registers Sentry at server startup.
 * Safe to run without a DSN (Sentry initializers no-op).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
