-- ============================================================================
-- 0016 — retention sweeps for the tables that only ever grew
-- ============================================================================
--
-- BUG (audit 2026-09-26, ops): four tables had no retention of any kind.
--   * order_audit_logs      — one row per order event, forever
--   * super_admin_audit_log — one row per admin action, forever
--   * impersonation_sessions— one row per impersonation, forever. Holds
--                             SUPERSEDED SESSION TOKENS, so this is also a
--                             standing retention liability, not just disk.
--   * daily_order_counters  — one row per (project, day), forever. Grows by
--                             (projects × days) and is the one that genuinely
--                             never stops.
-- rate_limits already self-purges (migration 0009, amortized inside the RPC)
-- and web_vitals has purge_web_vitals() from 0015, so this migration covers
-- the remaining four.
--
-- RETENTION WINDOWS are chosen from what the data is actually FOR, not from a
-- round number:
--   * order_audit_logs      180 days — an audit trail for tax/dispute
--                              purposes. Long enough to matter legally.
--   * super_admin_audit_log 365 days — admin actions are the highest-stakes
--                              trail in the app (who archived or deleted a
--                              paying store).
--   * impersonation_sessions  30 days — purely operational; the marker is dead
--                              within minutes, and old rows carry old tokens.
--   * daily_order_counters   90 days — needed for day-over-day analytics; the
--                              month view is the longest a dashboard asks for.
--
-- SAFETY, and this is the part that matters:
--   * A row is never deleted while it is still the live one. The sweep is
--     BATCHED and IDEMPOTENT, so it never holds a long lock and never blocks
--     writes. Batch size 500 chosen to be safely under any statement_timeout on
--     a small table.
--   * daily_order_counters is keyed (project_id, date) and the sweep uses the
--     date column, never the counter — deleting a live counter would corrupt
--     order numbering for that store, which is the one thing in this app that
--     must never be wrong.
--   * Nothing here touches orders, order_items, or anything a merchant's
--     revenue depends on.
--   * Every function is service_role-only. cron runs as the database owner and
--     calls it directly; no web role can reach these.
--
-- Runs daily at 04:10 UTC, offset from the existing expire_subscriptions() job
-- (03:00) on purpose: two heavy sweeps landing in the same minute is how you
-- find out your database has a lock budget.

-- ---------------------------------------------------------------------------
-- 1. order_audit_logs (180 days)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_order_audit_logs()
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.order_audit_logs
   WHERE id IN (
     SELECT id FROM public.order_audit_logs
      WHERE created_at < now() - interval '180 days'
      LIMIT 500
   );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. super_admin_audit_log (365 days)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_super_admin_audit_log()
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.super_admin_audit_log
   WHERE id IN (
     SELECT id FROM public.super_admin_audit_log
      WHERE created_at < now() - interval '365 days'
      LIMIT 500
   );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. impersonation_sessions (30 days)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_impersonation_sessions()
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.impersonation_sessions
   WHERE id IN (
     SELECT id FROM public.impersonation_sessions
      WHERE created_at < now() - interval '30 days'
      LIMIT 500
   );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. daily_order_counters (90 days) — keyed on the DATE, never the counter
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_daily_order_counters()
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.daily_order_counters
   WHERE ctid IN (
     SELECT ctid FROM public.daily_order_counters
      WHERE date < (now() - interval '90 days')::date
      LIMIT 500
   );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ---------------------------------------------------------------------------
-- One entry point, so cron has a single job and an operator has one thing to
-- call. Each sweep is independent: a failure in one does not stop the others.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_retention_sweeps()
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_n integer;
BEGIN
  BEGIN v_n := public.purge_order_audit_logs();       EXCEPTION WHEN others THEN v_n := -1; END;
  v_result := v_result || jsonb_build_object('order_audit_logs', v_n);

  BEGIN v_n := public.purge_super_admin_audit_log();  EXCEPTION WHEN others THEN v_n := -1; END;
  v_result := v_result || jsonb_build_object('super_admin_audit_log', v_n);

  BEGIN v_n := public.purge_impersonation_sessions(); EXCEPTION WHEN others THEN v_n := -1; END;
  v_result := v_result || jsonb_build_object('impersonation_sessions', v_n);

  BEGIN v_n := public.purge_daily_order_counters();    EXCEPTION WHEN others THEN v_n := -1; END;
  v_result := v_result || jsonb_build_object('daily_order_counters', v_n);

  -- web_vitals is 0015's job; included so a single call covers every table.
  BEGIN v_n := public.purge_web_vitals();             EXCEPTION WHEN others THEN v_n := -1; END;
  v_result := v_result || jsonb_build_object('web_vitals', v_n);

  RETURN v_result;
END;
$$;

-- service_role only. anon/authenticated must never be able to delete audit
-- history — that is the whole point of an audit log.
REVOKE ALL ON FUNCTION public.purge_order_audit_logs() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_super_admin_audit_log() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_impersonation_sessions() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_daily_order_counters() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_retention_sweeps() FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.purge_order_audit_logs() TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_super_admin_audit_log() TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_impersonation_sessions() TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_daily_order_counters() TO service_role;
GRANT EXECUTE ON FUNCTION public.run_retention_sweeps() TO service_role;

-- ---------------------------------------------------------------------------
-- Schedule. 04:10 UTC, deliberately not 03:00 where expire_subscriptions runs.
-- cron.schedule is idempotent by jobname, so re-running this migration updates
-- the existing job instead of stacking duplicates.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_jobid integer;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'dokan-retention-sweeps';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'dokan-retention-sweeps',
    '10 4 * * *',
    'select public.run_retention_sweeps();'
  );
END $$;
