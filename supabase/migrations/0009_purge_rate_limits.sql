-- ============================================================================
-- 0009 — rate_limits rows were never purged (UX-report C6)
--
-- rate_limit_check upserts by key and resets expired windows lazily, but a
-- key that is never reused (public-order:<slug>:<ip> churn, signup-ip:*,
-- per-user POS keys from churned staff) stays in the table forever — unbounded
-- growth on the busiest table on the write path.
--
-- Fix: bounded amortized sweep inside the RPC — at most 200 dead rows (window
-- expired more than 24h ago) per call, chosen by ctid (no index needed for
-- the LIMIT; the table is small and the predicate cheap). 24h grace so a row
-- can never be purged while still rate-limiting anyone.
-- Body copied from the 0005 hardened definition; ONLY the sweep block added.
-- ============================================================================

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
  -- 0009: amortized garbage collection of expired windows (see header).
  delete from public.rate_limits
  where ctid in (
    select ctid from public.rate_limits
    where reset_at < v_now - interval '24 hours'
    limit 200
  );

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
