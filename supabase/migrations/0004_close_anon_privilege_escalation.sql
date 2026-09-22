-- 0004: close anon/authenticated EXECUTE leak on destructive super-admin RPCs
-- Root cause: ALTER DEFAULT PRIVILEGES (0000_init.sql ~L1998) auto-granted
-- EXECUTE to anon/authenticated at CREATE time; REVOKE ALL FROM public later
-- in the same file does not strip an explicit role grant. Confirmed live via
-- Supabase Security Advisor (anon_security_definer_function_executable) and
-- verified on this project: pg_proc shows anon:EXECUTE on all three, and a
-- raw anon PostgREST call reached the function BODY (error 'super admin only'
-- from the internal guard, not 'permission denied').
--
-- renew_subscription intentionally NOT revoked from authenticated (legitimate
-- owner-facing call site predates 0001's super-admin-only guard) — it is
-- structurally fixed in 0005 instead.

REVOKE EXECUTE ON FUNCTION public.super_admin_hard_delete_project(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.super_admin_archive_project(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.super_admin_deactivate_project(uuid, uuid) FROM anon, authenticated;
-- service_role keeps EXECUTE (already granted) — these stay callable only
-- from /api/super-admin/* routes via createAdminClient().
