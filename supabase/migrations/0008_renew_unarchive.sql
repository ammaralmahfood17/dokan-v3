-- ============================================================================
-- 0008 — renew_subscription must un-archive (UX-report C3)
--
-- Bug: archive-project sets deleted_at + is_active=false (0005/0007 lineage),
-- but renew_subscription flips only is_active=true. A paying merchant coming
-- back from the archive got ACTIVE but still soft-deleted — every query that
-- filters on deleted_at (menu availability, analytics, super-admin lists)
-- kept treating the store as gone: a half-resurrected zombie tenant.
--
-- Fix: renew clears deleted_at alongside is_active=true. Structure copied
-- byte-for-byte from the 0005 hardened definition (service_role-gated
-- p_caller_user_id, initplan-safe auth.uid() usage, search_path pinned).
-- Grants: unchanged by 0005 (already service_role-only per batch-3 audit;
-- re-asserted here defensively).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.renew_subscription(p_project_id uuid, p_days integer DEFAULT 30, p_caller_user_id uuid DEFAULT NULL::uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller uuid;
  v_new_expiry timestamptz;
begin
  v_caller := auth.uid();
  -- 0005: p_caller_user_id is honored ONLY for genuine service_role
  -- backend calls — never inferred when the request is anon.
  if v_caller is null and auth.role() = 'service_role' then
    v_caller := p_caller_user_id;
  end if;
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Super admin only (owner self-renewal removed).
  if not exists (
    select 1 from public.super_admins sa
    where sa.user_id = v_caller
  ) then
    raise exception 'super admin only' using errcode = '42501';
  end if;

  update public.projects
  set subscription_expires_at =
        greatest(coalesce(subscription_expires_at, now()), now()) + (p_days || ' days')::interval,
      is_active = true,
      deleted_at = null  -- C3: a renewal from the archive is a full restore
  where id = p_project_id
  returning subscription_expires_at into v_new_expiry;

  if v_new_expiry is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  return v_new_expiry;
end;
$function$;

REVOKE ALL ON FUNCTION public.renew_subscription(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_subscription(uuid, integer, uuid) TO service_role;
