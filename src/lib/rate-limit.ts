/**
 * Rate limiter for Dokan API routes.
 * Priority: Vercel KV (Redis) → Supabase Postgres (production default) → in-memory Map.
 *
 * Vercel KV: shared across serverless instances when KV_URL is configured.
 * Supabase: atomic counter via SECURITY DEFINER RPC (rate_limit_check) — works on
 *   serverless without extra services. This is the production path.
 * In-memory: local development only (per-instance, resets on cold starts).
 *
 * KV access goes through src/lib/cache (CacheProvider) — swapping Vercel KV
 * for Upstash later is a one-line change in getCacheProvider().
 */

type RateLimitRecord = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateLimitRecord>();

interface RateLimitOptions {
  limit: number;      // max requests
  windowMs: number;   // time window in ms
  keyPrefix?: string;
  /** Optional tenant context forwarded to the DB guard on the
   * rate_limit_check RPC (defense-in-depth when the route knows the caller). */
  projectId?: string;
  callerUserId?: string;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

/**
 * Try using Vercel KV if configured, otherwise use in-memory Map.
 */
async function kvRateLimit(
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult | null> {
  try {
    if (!process.env.KV_URL) return null; // KV not configured

    const cache = (await import('@/lib/cache')).getCacheProvider();
    const now = Date.now();
    const windowSeconds = Math.ceil(options.windowMs / 1000);
    const result = await cache.hGetAll<{ count: number; resetAt: number }>(key);

    if (!result || now > result.resetAt) {
      await cache.hSet(key, { count: 1, resetAt: now + options.windowMs });
      await cache.expire(key, windowSeconds);
      return { allowed: true, remaining: options.limit - 1, resetIn: options.windowMs };
    }

    if (result.count >= options.limit) {
      return { allowed: false, remaining: 0, resetIn: result.resetAt - now };
    }

    await cache.hIncrBy(key, 'count', 1);
    return { allowed: true, remaining: options.limit - result.count - 1, resetIn: result.resetAt - now };
  } catch {
    return null; // Fall through to in-memory
  }
}

/**
 * Supabase Postgres rate limiter — atomic counter via SECURITY DEFINER RPC.
 * Works on serverless (shared DB, no per-instance state).
 */
async function supabaseRateLimit(
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult | null> {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('rate_limit_check', {
      p_key: key,
      p_limit: options.limit,
      p_window_ms: options.windowMs,
      ...(options.projectId ? { p_project_id: options.projectId } : {}),
      ...(options.callerUserId ? { p_caller_user_id: options.callerUserId } : {}),
    });
    if (error) return null;
    const result = data as unknown as {
      allowed: boolean;
      remaining: number;
      reset_in: number;
    } | null;
    if (!result) return null;
    return {
      allowed: result.allowed,
      remaining: result.remaining,
      resetIn: Math.round(result.reset_in),
    };
  } catch {
    return null; // Fall through to in-memory
  }
}

export async function rateLimit(
  identifier: string,
  options: RateLimitOptions = { limit: 10, windowMs: 60 * 1000 }
): Promise<RateLimitResult> {
  const key = options.keyPrefix ? `${options.keyPrefix}:${identifier}` : identifier;

  // 1. Vercel KV if configured
  const kvResult = await kvRateLimit(key, options);
  if (kvResult) return kvResult;

  // 2. Supabase Postgres (production path)
  const supabaseResult = await supabaseRateLimit(key, options);
  if (supabaseResult) return supabaseResult;

  // 3. Fallback: in-memory Map (local dev only)
  const now = Date.now();
  const record = store.get(key);

  if (!record || now > record.resetAt) {
    // Opportunistic eviction — expired keys otherwise grow unbounded.
    if (store.size > 10_000) {
      for (const [k, v] of store) {
        if (now > v.resetAt) store.delete(k);
      }
    }
    store.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, remaining: options.limit - 1, resetIn: options.windowMs };
  }

  if (record.count >= options.limit) {
    return { allowed: false, remaining: 0, resetIn: record.resetAt - now };
  }

  record.count += 1;
  return { allowed: true, remaining: options.limit - record.count, resetIn: record.resetAt - now };
}

export function createRateLimitResponse(resetIn: number): { error: string; status: number } {
  const seconds = Math.ceil(resetIn / 1000);
  return {
    error: `طلبات كثيرة. حاول مرة أخرى بعد ${seconds} ثوانٍ.`,
    status: 429,
  };
}
