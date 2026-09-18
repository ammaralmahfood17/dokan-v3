-- ============================================================================
-- Restrict renew_subscription() to super admins only.
--
-- Policy change (2026-08-06): subscribers no longer self-renew. The
-- "تسجيل تجديد 30 يوم" button and /api/admin/renew-subscription were removed
-- from the dashboard settings — subscriptions/extensions are controlled
-- exclusively by the admin team via /api/super-admin/renew.
--
-- The RPC previously accepted the project's owner, which left a bypass: any
-- owner could call renew_subscription() directly from their session. It now
-- rejects everyone except global super admins.
--
-- Grants are unchanged (authenticated + service_role) — super admins
-- authenticate as regular users, so their own sessions still pass the check;
-- owners hit 'super admin only'.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.renew_subscription(
  p_project_id uuid,
  p_days integer DEFAULT 30,
  p_caller_user_id uuid DEFAULT NULL
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_caller uuid;
  v_new_expiry timestamptz;
begin
  v_caller := coalesce(auth.uid(), p_caller_user_id);
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
      is_active = true
  where id = p_project_id
  returning subscription_expires_at into v_new_expiry;

  if v_new_expiry is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  return v_new_expiry;
end;
$$;
