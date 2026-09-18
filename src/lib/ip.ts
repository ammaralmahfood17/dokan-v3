/** Minimal headers-compatible shape (NextRequest, Request, NextApiRequest). */
type WithHeaders = { headers: Headers };

/**
 * Resolve the real client IP for rate limiting.
 *
 * NEVER trust the leftmost value of `x-forwarded-for` — it is
 * client-controllable (an attacker can prepend any value and rotate it to
 * defeat every IP-based limiter). Proxies/Vercel APPEND the real IP to the
 * right, so the LAST non-empty entry is the trustworthy one. `x-real-ip` is
 * a secondary signal when present.
 */
export function getClientIp(request: WithHeaders): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',');
    // Walk from the right: skip empty segments.
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i].trim();
      if (part) return part;
    }
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp?.trim()) return realIp.trim();
  return 'unknown';
}
