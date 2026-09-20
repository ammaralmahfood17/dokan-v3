-- 0003: security hardening — batch 1 (2026-09-20 audit)
-- 1) public schema: Supabase ships PUBLIC with CREATE here; any DB role can
--    then litter the schema (or worse, pair it with a future SQL-injection
--    primitive). PostgREST needs USAGE only.
-- 2) web roles must not hold TRIGGER/TRUNCATE/REFERENCES on tenant tables —
--    an attacker-attached trigger on orders would fire inside service_role
--    writes and bypass RLS entirely. The app never creates triggers from a
--    web role; 0000's blanket GRANT ALL leftovers are revoked per table.
-- 3) future postgres-created objects must not auto-grant ALL to anon/
--    authenticated — new tables/functions get explicit, scoped grants the
--    way every 0000 object already does.
-- 4) projects UPDATE was table-level for ANY member → staff could extend
--    subscription_expires_at, hijack slug, un-archive. Column-scoped to the
--    four fields the settings page legitimately edits (verified against
--    settings-client.tsx — the only client-side projects.update caller).
--    service_role (routes/admin) is untouched.
-- 5) is_project_member_for(user,project) is only called from SECURITY
--    DEFINER internals (run as owner) — its direct authenticated EXECUTE
--    grant was a membership oracle. RLS policies use is_project_member(id)
--    (untouched).

-- 1) schema CREATE
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 2) per-table dangerous privileges for web roles (existing tables)
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format(
      'REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.%I FROM anon, authenticated',
      t.tablename
    );
  END LOOP;
END
$$;

-- 3) default privileges for future objects
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 4) projects: column-scoped merchant update
REVOKE UPDATE ON public.projects FROM authenticated;
GRANT UPDATE (name, currency, primary_color, is_active) ON public.projects TO authenticated;

-- 5) membership oracle closed
REVOKE EXECUTE ON FUNCTION public.is_project_member_for(uuid, uuid) FROM authenticated;
