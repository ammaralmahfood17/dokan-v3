import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/ip';

/** Core Web Vitals whitelist — anything else is a forged beacon. */
const METRIC_NAMES = new Set(['LCP', 'CLS', 'INP', 'FCP', 'TTFB', 'FID']);

/**
 * Collects Core Web Vitals beacons (see src/components/web-vitals.tsx).
 * No sensitive data — metric id/name/value/delta/path only.
 * Visible in Vercel function logs: "web-vitals LCP 1842ms /dashboard"
 * Rate-limited like every other public route: metrics are telemetry, not
 * worth a log-flood; over-limit beacons are dropped silently ({ok:true}).
 */
export async function POST(request: Request) {
  try {
    const limit = await rateLimit(`ip:${getClientIp(request)}`, {
      limit: 240,
      windowMs: 60 * 1000,
      keyPrefix: 'vitals-ip',
    });
    if (!limit.allowed) {
      return NextResponse.json({ ok: true });
    }

    const body = await request.text();
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(body); } catch { /* ignore malformed */ }

    if (
      parsed?.name &&
      typeof parsed.value === 'number' &&
      Number.isFinite(parsed.value) &&
      METRIC_NAMES.has(String(parsed.name))
    ) {
      const path = typeof parsed.path === 'string' ? parsed.path.slice(0, 80) : '/';
      // 1.11: dev-only — this route is a hot beacon endpoint; logging every
      // metric per-request in production is pure noise (1.5x traffic volume).
      if (process.env.NODE_ENV !== 'production') {
        console.log(`web-vitals ${parsed.name} ${parsed.value}ms path=${path}`);
      }
    }
  } catch {
    // never block the page on a metrics beacon
  }

  return NextResponse.json({ ok: true });
}
