'use client';

import { useReportWebVitals } from 'next/web-vitals';

/**
 * Collects Core Web Vitals in production and beacons them to /api/vitals
 * (visible in Vercel function logs). Dev builds log to console only.
 */
export function WebVitals() {
  useReportWebVitals((metric) => {
    const payload = JSON.stringify({
      id: metric.id,
      name: metric.name,
      value: metric.value,
      rating: 'rating' in metric ? metric.rating : undefined,
      delta: metric.delta,
      path: window.location.pathname,
    });

    if (process.env.NODE_ENV === 'development') {
      console.debug(`[WebVitals] ${metric.name}:`, metric.value);
      return;
    }

    // Production: beacon to Vercel function logs (no external dependency)
    try {
      navigator.sendBeacon?.('/api/vitals', payload);
    } catch {
      // ignore — metrics are best-effort
    }
  });

  return null;
}
