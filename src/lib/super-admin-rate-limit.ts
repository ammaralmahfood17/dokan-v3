import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { rateLimit, createRateLimitResponse } from './rate-limit';

/**
 * Shared throttle for the /api/super-admin/* surface.
 *
 * WHY (audit 2026-09-26): every super-admin route was individually gated by
 * `is_super_admin()` and the underlying RPCs are `service_role`-only, so this is
 * defence in depth rather than a fix for a live bypass — an attacker with a
 * valid admin session could still hammer these endpoints, and each call runs a
 * `getUser()` plus an `is_super_admin()` RPC before the work is rejected.
 *
 * The budget is keyed on the ADMIN'S OWN USER ID, not their IP: these are
 * authenticated mutations, so an IP key would let one shared office connection
 * lock out a real admin while a single attacker rotating IPs is unaffected.
 *
 * The limit is generous (30/min) on purpose. It exists to stop a runaway loop
 * or a stolen-session flood, not to slow down a human clicking through the
 * super-admin panel — the archive/renew/record-payment screens are interactive
 * and a tight budget would cause real 429s during normal use.
 *
 * Call it AFTER authentication, so an anonymous flood is rejected by the 401
 * path (which is cheaper) rather than consuming an admin's budget.
 */
export async function limitSuperAdmin(
  request: NextRequest,
  userId: string,
  action: string
): Promise<NextResponse | null> {
  const result = await rateLimit(`sa:${userId}:${action}`, {
    limit: 30,
    windowMs: 60 * 1000,
    keyPrefix: 'super-admin',
  });
  if (result.allowed) return null;

  const { error, status } = createRateLimitResponse(result.resetIn);
  return NextResponse.json({ error }, { status });
}
