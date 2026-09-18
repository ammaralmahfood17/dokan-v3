/**
 * Cache provider abstraction — Dokan.
 *
 * Rate limiting needs a shared hash-store across serverless instances.
 * Vercel KV (Redis-compatible) is the current provider; Upstash Redis is a
 * drop-in replacement when/if we leave Vercel. Switching providers = touching
 * getCacheProvider() only (add the new provider class + flip the env var).
 */
export interface CacheProvider {
  hGetAll<T extends Record<string, unknown>>(key: string): Promise<T | null>;
  hSet(key: string, fields: Record<string, unknown>): Promise<void>;
  hIncrBy(key: string, field: string, by: number): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
}

/**
 * Vercel KV provider (Redis protocol). Loaded lazily so the package is only
 * imported when actually configured (KV_URL set).
 */
class VercelKVProvider implements CacheProvider {
  private kvPromise: Promise<typeof import('@vercel/kv')> | null = null;

  private async kv() {
    if (!this.kvPromise) this.kvPromise = import('@vercel/kv');
    return this.kvPromise;
  }

  async hGetAll<T extends Record<string, unknown>>(key: string): Promise<T | null> {
    const { kv } = await this.kv();
    return kv.hgetall<T>(key);
  }

  async hSet(key: string, fields: Record<string, unknown>): Promise<void> {
    const { kv } = await this.kv();
    await kv.hset(key, fields);
  }

  async hIncrBy(key: string, field: string, by: number): Promise<number> {
    const { kv } = await this.kv();
    return kv.hincrby(key, field, by);
  }

  async expire(key: string, seconds: number): Promise<void> {
    const { kv } = await this.kv();
    await kv.expire(key, seconds);
  }
}

let cacheProvider: CacheProvider | null = null;

/**
 * Resolve the active cache provider.
 *  - CACHE_PROVIDER=upstash → UpstashRedisProvider (add class here when needed)
 *  - default → VercelKVProvider
 */
export function getCacheProvider(): CacheProvider {
  if (!cacheProvider) {
    if (process.env.CACHE_PROVIDER === 'upstash') {
      // TODO: add UpstashRedisProvider (same Redis commands — HGETALL/HSET/
      // HINCRBY/EXPIRE) when migrating off Vercel. Swap = this line + env var.
      throw new Error('CACHE_PROVIDER=upstash is not wired up yet');
    }
    cacheProvider = new VercelKVProvider();
  }
  return cacheProvider;
}
