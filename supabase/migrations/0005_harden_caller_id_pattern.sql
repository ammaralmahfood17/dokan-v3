-- 0005: structural fix for the p_caller_user_id trust pattern.
-- Every SECURITY DEFINER RPC below resolved the caller as
--   v_caller := coalesce(auth.uid(), p_caller_user_id)
-- which let ANY role with EXECUTE (see 0004) spoof a caller by passing
-- p_caller_user_id, because auth.uid() is NULL for unauthenticated calls.
-- Now the parameter is only honored when the actual session role is
-- service_role (PostgREST sets it from the verified JWT claim — it cannot be
-- forged with an anon/authenticated key). The GRANT/REVOKE table becomes the
-- second line of defense instead of the only one.
--
-- Bodies are the LIVE definitions (pg_get_functiondef at apply time), with
-- ONLY the trust block changed. Call-path audit before applying:
--   advance_order_status      → kitchen-client (authenticated, uid non-null) ✓
--   create_order_transactional / next_order_number → /api/public + /api/pos
--                               via service_role; anon path passes NULL ✓
--   rate_limit_check          → lib/rate-limit via service_role (or anon with
--                               NULL caller — behavior unchanged) ✓
--   renew_subscription / super_admin_{archive,deactivate,hard_delete}_project
--                             → /api/super-admin/* via createAdminClient ✓

CREATE OR REPLACE FUNCTION public.advance_order_status(p_order_id uuid, p_expected_status text, p_new_status text, p_caller_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project_id uuid;
  v_caller uuid;
  v_rows int;
begin
  -- Resolve the order's project — also proves the order exists.
  select project_id into v_project_id
  from public.orders
  where id = p_order_id;

  if v_project_id is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  -- Tenant guard: caller (browser auth.uid() or explicit server-passed id)
  -- must be a member of the order's project. Rejects cross-tenant calls and
  -- any future grant widening on this RPC.
  v_caller := auth.uid();
  -- 0005: p_caller_user_id is honored ONLY for genuine service_role
  -- backend calls — never inferred when the request is anon.
  if v_caller is null and auth.role() = 'service_role' then
    v_caller := p_caller_user_id;
  end if;
  if v_caller is null or not public.is_project_member_for(v_caller, v_project_id) then
    raise exception 'not authorized for this project' using errcode = '42501';
  end if;

  -- Atomic status transition — only advances if the order is exactly in the
  -- expected state (blocks reviving cancelled orders from a stale screen).
  update public.orders
  set status = p_new_status::public.order_status
  where id = p_order_id
    and status = p_expected_status::public.order_status;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'STALE_STATUS: order state changed on another device'
      using errcode = 'P0001';
  end if;

  -- Advance line items in the SAME transaction. order_items.status is text
  -- with CHECK (pending|preparing|ready) — 'delivered' is order-level only,
  -- so items are left at 'ready' on delivery (matches the previous behaviour).
  if p_new_status in ('preparing', 'ready') then
    update public.order_items
    set status = p_new_status
    where order_id = p_order_id;
  end if;

  return jsonb_build_object('id', p_order_id, 'status', p_new_status);
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_order_transactional(p_project_id uuid, p_type text, p_status text, p_total_amount numeric, p_order_number integer, p_items jsonb, p_table_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_caller_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_id uuid;
  v_item jsonb;
  v_caller uuid;
begin
  -- Tenant guard — see 0010 header comment. Anonymous public path passes
  -- NULL caller (route-level validation applies); authenticated POS passes
  -- the staff id so the RPC itself enforces membership.
  v_caller := auth.uid();
  -- 0005: p_caller_user_id is honored ONLY for genuine service_role
  -- backend calls — never inferred when the request is anon.
  if v_caller is null and auth.role() = 'service_role' then
    v_caller := p_caller_user_id;
  end if;
  if v_caller is not null and not public.is_project_member_for(v_caller, p_project_id) then
    raise exception 'not authorized for this project' using errcode = '42501';
  end if;

  insert into public.orders (project_id, table_id, type, status, total_amount, notes, order_number)
  values (p_project_id, p_table_id, p_type::order_type, p_status::order_status, p_total_amount, p_notes, p_order_number)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, addons, notes)
    values (
      v_order_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      (v_item->>'quantity')::integer,
      (v_item->>'unit_price')::numeric,
      coalesce(v_item->'addons', '[]'::jsonb),
      v_item->>'notes'
    );
  end loop;

  return jsonb_build_object(
    'id', v_order_id,
    'status', p_status,
    'total_amount', p_total_amount,
    'order_number', p_order_number
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.next_order_number(p_project_id uuid, p_caller_user_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_next integer;
  v_caller uuid;
begin
  v_caller := auth.uid();
  -- 0005: p_caller_user_id is honored ONLY for genuine service_role
  -- backend calls — never inferred when the request is anon.
  if v_caller is null and auth.role() = 'service_role' then
    v_caller := p_caller_user_id;
  end if;
  if v_caller is not null and not public.is_project_member_for(v_caller, p_project_id) then
    raise exception 'not authorized for this project' using errcode = '42501';
  end if;

  insert into public.daily_order_counters (project_id, date, counter)
  values (p_project_id, current_date, 1)
  on conflict (project_id, date)
  do update set counter = daily_order_counters.counter + 1
  returning counter into v_next;

  return v_next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rate_limit_check(p_key text, p_limit integer, p_window_ms integer, p_project_id uuid DEFAULT NULL::uuid, p_caller_user_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count int;
  v_reset_at timestamptz;
  v_now timestamptz := now();
  v_remaining int;
  v_reset_in numeric;
  v_caller uuid;
begin
  -- Defense-in-depth: when a project is provided, the caller must be a member.
  if p_project_id is not null then
    v_caller := auth.uid();
    -- 0005: p_caller_user_id is honored ONLY for genuine service_role
    -- backend calls — never inferred when the request is anon.
    if v_caller is null and auth.role() = 'service_role' then
      v_caller := p_caller_user_id;
    end if;
    if v_caller is not null and not public.is_project_member_for(v_caller, p_project_id) then
      raise exception 'not authorized for this project' using errcode = '42501';
    end if;
  end if;

  select count, reset_at into v_count, v_reset_at
  from public.rate_limits
  where key = p_key;

  if v_reset_at is null or v_now > v_reset_at then
    insert into public.rate_limits (key, count, reset_at)
    values (p_key, 1, v_now + (p_window_ms || ' milliseconds')::interval)
    on conflict (key) do update
      set count = 1, reset_at = excluded.reset_at;
    return json_build_object('allowed', true, 'remaining', p_limit - 1, 'reset_in', p_window_ms);
  end if;

  if v_count >= p_limit then
    v_reset_in := extract(epoch from (v_reset_at - v_now)) * 1000;
    return json_build_object('allowed', false, 'remaining', 0, 'reset_in', v_reset_in);
  end if;

  update public.rate_limits set count = count + 1 where key = p_key;
  v_remaining := p_limit - v_count - 1;
  v_reset_in := extract(epoch from (v_reset_at - v_now)) * 1000;
  return json_build_object('allowed', true, 'remaining', v_remaining, 'reset_in', v_reset_in);
end;
$function$;

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
      is_active = true
  where id = p_project_id
  returning subscription_expires_at into v_new_expiry;

  if v_new_expiry is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  return v_new_expiry;
end;
$function$;

CREATE OR REPLACE FUNCTION public.super_admin_archive_project(p_project_id uuid, p_caller_user_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_caller uuid;
    v_updated int;
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

    if not exists (select 1 from public.super_admins sa where sa.user_id = v_caller) then
        raise exception 'super admin only' using errcode = '42501';
    end if;

    update public.projects
    set deleted_at = now(),
        is_active = false
    where id = p_project_id
      and deleted_at is null;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        raise exception 'project not found or already archived' using errcode = 'P0002';
    end if;

    return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.super_admin_deactivate_project(p_project_id uuid, p_caller_user_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_caller uuid;
    v_updated int;
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

    if not exists (
        select 1 from public.super_admins sa
        where sa.user_id = v_caller
    ) then
        raise exception 'super admin only' using errcode = '42501';
    end if;

    update public.projects
    set is_active = false
    where id = p_project_id;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        raise exception 'project not found' using errcode = 'P0002';
    end if;

    return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.super_admin_hard_delete_project(p_project_id uuid, p_caller_user_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_caller uuid;
    v_updated int;
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

    if not exists (select 1 from public.super_admins sa where sa.user_id = v_caller) then
        raise exception 'super admin only' using errcode = '42501';
    end if;

    -- All child rows cascade (FKs defined ON DELETE CASCADE in baseline).
    delete from public.projects
    where id = p_project_id;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
        raise exception 'project not found' using errcode = 'P0002';
    end if;

    return true;
end;
$function$;
