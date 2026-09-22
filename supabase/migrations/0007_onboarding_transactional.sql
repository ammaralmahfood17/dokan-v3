-- 0007: transactional project onboarding (audit item 1.10).
-- The route previously did projects INSERT → staff_members INSERT with a
-- best-effort compensating DELETE on failure — a crash between the two (or a
-- failed delete) orphaned a project the user could never reach or recreate.
-- This RPC performs both inserts in ONE transaction: any failure rolls the
-- whole thing back; there is no compensating code.
--
-- Slug collision handling moves inside the function: the route's pre-check
-- loop was TOCTOU-racy (check-then-insert). Here the unique_violation from
-- the actual INSERT drives retry with '-1'..'-19' suffixes (same policy the
-- route applied), and the losing insert never leaves the transaction.
--
-- Grants: created AFTER 0000_init's ALTER DEFAULT PRIVILEGES, so
-- anon/authenticated would receive EXECUTE implicitly at CREATE — revoked
-- explicitly in this same file (the 0004 bug class). service_role only:
-- the route calls it via createAdminClient().

CREATE OR REPLACE FUNCTION public.onboard_project_transactional(
  p_name text,
  p_slug text,
  p_currency text,
  p_primary_color text,
  p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_slug text := p_slug;
  v_attempt int := 0;
  v_project_id uuid;
begin
  if p_created_by is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Service-backend contract: caller identity must be a real auth user and
  -- must not already own a project (mirrors the route's 409 guard; RLS-
  -- bypassing service_role calls are trusted, this is defense-in-depth).
  if exists (select 1 from public.staff_members sm where sm.user_id = p_created_by) then
    raise exception 'already has project' using errcode = 'P0001';
  end if;

  loop
    begin
      insert into public.projects (name, slug, currency, primary_color, is_active, created_by)
      values (p_name, v_slug, p_currency, p_primary_color, true, p_created_by)
      returning id into v_project_id;
      exit;
    exception when unique_violation then
      -- slug taken concurrently: retry with suffix (same policy as the old
      -- route loop, but atomic — no half-created state).
      v_attempt := v_attempt + 1;
      if v_attempt >= 20 then
        raise exception 'no available slug' using errcode = 'P0001';
      end if;
      v_slug := public.generate_basic_slug(p_slug || '-' || v_attempt::text);
    end;
  end loop;

  insert into public.staff_members (project_id, user_id, role)
  values (v_project_id, p_created_by, 'owner');

  return jsonb_build_object('id', v_project_id, 'name', p_name, 'slug', v_slug);
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.onboard_project_transactional(text, text, text, text, uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.onboard_project_transactional(text, text, text, text, uuid) TO service_role;
