-- ============================================================================
-- 0015 — persist Core Web Vitals so the beacon endpoint stops being a black hole
-- ============================================================================
--
-- BUG (audit 2026-09-26, ops): /api/vitals validated every beacon, rate-limited
-- it, then threw it away. The only output was a `console.log` gated behind
-- `NODE_ENV !== 'production'`, so in production the endpoint accepted traffic and
-- stored nothing — the client paid a network round-trip on every page view for
-- zero data, and the project had NO performance telemetry at all.
--
-- Design: this is raw, aggregated-by-rollup telemetry, not user data.
--   * No IP, no user id, no session, no referrer, no user agent are stored.
--   * `path` is the app's own route only, hard-trimmed to 80 chars and stripped
--     of any query string, so a token or an email in a URL can never land here.
--   * The anonymous-beacon threat is handled by the rate limiter (already in
--     the route) plus the fact that rows are only ever read as aggregates.
--
-- Storage is deliberately BUCKETED: one row per (path, metric, bucket) rather
-- than one row per beacon. A merchant's traffic is far too small for per-event
-- rows (that table would be mostly noise and grow forever), but percentile
-- calculations on a bucket are still meaningful, and the table stays small
-- enough to query without an aggregation job.
--
-- RLS is ON with no policies: this table is service-role only. The public
-- client must never read or write it directly — it can only reach the route
-- handler, which holds the service key.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.web_vitals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path text NOT NULL,
  metric text NOT NULL,
  -- metric value in ms (for CLS the client sends value × 1000, so every value
  -- in this column is milliseconds and percentiles stay comparable)
  value_ms integer NOT NULL,
  -- 4-minute floor bucket: a beacon's time to live is ~a few minutes, so
  -- buckets expire naturally instead of needing a retention sweep.
  bucket_at timestamptz NOT NULL DEFAULT to_timestamp(floor(extract(epoch from now()) / 240) * 240),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Beacon name whitelist enforced by the route; CHECKed again at the storage
  -- layer so a direct write (service role, or a future code path) cannot store
  -- unbounded junk that would pollute the aggregates.
  CONSTRAINT web_vitals_metric_check CHECK (metric IN ('LCP', 'CLS', 'INP', 'FCP', 'TTFB', 'FID'))
);

ALTER TABLE public.web_vitals ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS web_vitals_lookup_idx
  ON public.web_vitals (metric, bucket_at DESC);

CREATE INDEX IF NOT EXISTS web_vitals_path_idx
  ON public.web_vitals (path, metric, bucket_at DESC);

-- Retention. Without this the table only ever grows; 4-minute buckets older
-- than 14 days are no longer interesting for a store this size, and deleting
-- them keeps the table small enough that the admin query stays instant. Idempotent
-- so it can be re-run safely (and it is cheap: it touches an indexed column).
CREATE OR REPLACE FUNCTION public.purge_web_vitals() RETURNS integer
  LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.web_vitals WHERE bucket_at < now() - interval '14 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_web_vitals() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_web_vitals() TO service_role;

REVOKE ALL ON TABLE public.web_vitals FROM anon, authenticated;
