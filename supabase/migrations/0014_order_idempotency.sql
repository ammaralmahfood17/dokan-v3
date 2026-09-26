-- ============================================================================
-- 0014 — idempotency for public orders (offline retry no longer double-orders)
-- ============================================================================
--
-- BUG (audit 2026-09-26, CRIT-3): the customer menu's offline path queues the
-- identical payload to IndexedDB (`dokan-pending-orders`) and the service
-- worker re-POSTs it verbatim. The payload carried NO stable identifier, so a
-- retry of a request that actually SUCCEEDED server-side (the response lost on
-- a flaky mobile connection) created a SECOND real order. Worse, the cart sheet
-- also offers a manual إعادة المحاولة button while the queued copy is still in
-- IndexedDB — so one tap could produce two orders. `next_order_number` always
-- allocates a fresh number, so the duplicate succeeded silently and the
-- merchant was left cooking the same plate twice.
--
-- Fix: a caller-supplied idempotency key, enforced by the DATABASE so it holds
-- for every writer and survives concurrent retries. A unique index is the only
-- thing that makes this atomic — an application-level "SELECT then INSERT"
-- would race.
--
-- Scope decisions:
--   * Keyed on (project_id, client_request_id). The public API is anonymous and
--     has no session, so the key is a client-generated UUID, not a user id.
--   * NULL is allowed and excluded from the index, so every pre-existing order
--     and every internal (POS/waiter) call without a key is unaffected and can
--     never collide.
--
-- IMPORTANT: the signature below is derived from the LIVE function definition
-- (`pg_get_functiondef`), not from the squashed 0000 baseline. The deployed
-- function already carries `p_caller_user_id` plus the membership guard, and its
-- argument ORDER differs from the baseline copy. Re-typing it from the baseline
-- would have silently dropped the tenant guard — so the body is reproduced
-- verbatim and only the dedupe is added.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

COMMENT ON COLUMN public.orders.client_request_id IS
  'Caller-supplied idempotency key. Same (project_id, client_request_id) is created once.';

-- Partial unique index: only rows that actually carry a key participate, so
-- orders created without one (all internal flows) are never constrained.
CREATE UNIQUE INDEX IF NOT EXISTS orders_client_request_id_uniq
  ON public.orders (project_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Adds p_client_request_id and returns the PREVIOUS order when the key was
-- already used, instead of failing or inserting a duplicate.
--
-- Behaviour on replay:
--   * The customer gets 200 + their ORIGINAL order id / number / total. Never a
--     500, and never a second plate.
--   * The caller must treat this as "already placed": the route signals it with
--     a distinct `replayed` flag so side effects (audit log, push, Telegram)
--     do NOT fire a second time for the same order.
--
-- The dedupe is done inside the same transaction, before any row is written, so
-- two concurrent retries cannot both get through. The membership guard and the
-- whole insert path below are UNCHANGED from the deployed definition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order_transactional(
  p_project_id uuid,
  p_type text,
  p_status text,
  p_total_amount numeric,
  p_order_number integer,
  p_items jsonb,
  p_table_id uuid DEFAULT NULL::uuid,
  p_notes text DEFAULT NULL::text,
  p_caller_user_id uuid DEFAULT NULL::uuid,
  p_client_request_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_caller uuid;
  v_existing public.orders%ROWTYPE;
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

  -- Replay guard. Runs AFTER the tenant guard on purpose: authorization must be
  -- settled before we reveal that a key already exists, otherwise the response
  -- becomes an oracle for "did someone else's checkout use this key".
  if p_client_request_id is not null then
    select * into v_existing
      from public.orders
     where project_id = p_project_id
       and client_request_id = p_client_request_id;

    if found then
      return jsonb_build_object(
        'id', v_existing.id,
        'status', v_existing.status,
        'total_amount', v_existing.total_amount,
        'order_number', v_existing.order_number,
        'replayed', true
      );
    end if;
  end if;

  insert into public.orders (
    project_id, table_id, type, status, total_amount, notes, order_number, client_request_id
  )
  values (
    p_project_id, p_table_id, p_type::order_type, p_status::order_status,
    p_total_amount, p_notes, p_order_number, p_client_request_id
  )
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
    'order_number', p_order_number,
    'replayed', false
  );
end;
$$;

-- Grants are keyed by identity args, so the legacy 9-arg overload (still
-- present) is a SEPARATE object and would stay an open door under the same
-- name — a caller hitting the old arity gets the pre-idempotency behaviour.
REVOKE ALL ON FUNCTION public.create_order_transactional(
  uuid, text, text, numeric, integer, jsonb, uuid, text, uuid, uuid
) FROM public;
GRANT EXECUTE ON FUNCTION public.create_order_transactional(
  uuid, text, text, numeric, integer, jsonb, uuid, text, uuid, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.create_order_transactional(
  uuid, text, text, numeric, integer, jsonb, uuid, text, uuid
) FROM public;
GRANT EXECUTE ON FUNCTION public.create_order_transactional(
  uuid, text, text, numeric, integer, jsonb, uuid, text, uuid
) TO service_role;

-- Defence in depth: the column is set only by this RPC. Direct writes by
-- authenticated staff (waiter/bill flows) must not be able to pin a key that
-- would then silently swallow a later public order.
REVOKE INSERT (client_request_id) ON TABLE public.orders FROM authenticated;

-- ---------------------------------------------------------------------------
-- Regression guard, run inside the migration. Deliberately NOT using pgTAP (not
-- installed here) — a DO block that raises is enough, and it removes every row
-- it created so live merchant data is never polluted by the check.
--
-- The probe order carries ONE real line whose unit_price equals the order
-- total: `orders_validate_amount_on_insert` compares total_amount against the
-- sum of order_items, so a zero-item order would be rejected before the dedupe
-- could be exercised at all. A real product is used (a synthetic uuid would
-- fail the order_items_validate_project trigger).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_pid uuid;
  v_product uuid;
  v_key uuid := gen_random_uuid();
  v_a uuid;
  v_b uuid;
  v_c integer;
  v_created uuid;
  v_items jsonb;
BEGIN
  SELECT id INTO v_pid FROM public.projects WHERE is_active LIMIT 1;
  IF v_pid IS NULL THEN
    RAISE NOTICE '0014: no active project, skipping regression checks';
    RETURN;
  END IF;

  SELECT id INTO v_product FROM public.products
   WHERE project_id = v_pid AND is_available LIMIT 1;
  IF v_product IS NULL THEN
    RAISE NOTICE '0014: project % has no available product, skipping regression checks', v_pid;
    RETURN;
  END IF;

  -- One line, unit_price 1.000, quantity 1 → the amounts line up.
  v_items := jsonb_build_array(jsonb_build_object(
    'product_id', v_product, 'product_name', 'probe', 'quantity', 1, 'unit_price', 1.000
  ));

  -- The probe must run as service_role, exactly like the real caller.
  -- `orders_validate_amount_on_insert` short-circuits ONLY for
  -- auth.role() = 'service_role' (it trusts the backend's authoritative total);
  -- every other role has its total recomputed from order_items. A direct psql
  -- session reports auth.role() = '' , so without this the probe is rejected
  -- before the dedupe is ever reached. This GUC is precisely what PostgREST
  -- sets from the JWT, so the probe exercises the real code path.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- 1. A fresh key creates exactly one order.
  select (public.create_order_transactional(
    v_pid, 'dinein', 'pending', 1.000, 900001, v_items, null, null, null, v_key
  ))->>'id' into v_a;
  IF v_a IS NULL THEN
    RAISE EXCEPTION '0014 REGRESSION: fresh key did not create an order';
  END IF;

  -- 2. Replaying the same key returns the SAME id.
  select (public.create_order_transactional(
    v_pid, 'dinein', 'pending', 1.000, 900002, v_items, null, null, null, v_key
  ))->>'id' into v_b;
  IF v_b is distinct from v_a THEN
    RAISE EXCEPTION '0014 REGRESSION: replay created a different order (% vs %)', v_a, v_b;
  END IF;

  -- 3. And still exactly one row exists for that key.
  select count(*) into v_c from public.orders
   where project_id = v_pid and client_request_id = v_key;
  IF v_c <> 1 THEN
    RAISE EXCEPTION '0014 REGRESSION: expected 1 row for the key, got %', v_c;
  END IF;

  -- 4. A NULL key still works (the internal POS/waiter path is unconstrained)
  --    and two of them coexist.
  select (public.create_order_transactional(
    v_pid, 'dinein', 'pending', 1.000, 900003, v_items, null, null, null, null
  ))->>'id' into v_created;
  select (public.create_order_transactional(
    v_pid, 'dinein', 'pending', 1.000, 900004, v_items, null, null, null, null
  ))->>'id' into v_created;
  select count(*) into v_c from public.orders
   where project_id = v_pid and client_request_id is null and order_number in (900003, 900004);
  IF v_c <> 2 THEN
    RAISE EXCEPTION '0014 REGRESSION: NULL-key inserts collided (% rows, expected 2)', v_c;
  END IF;

  -- 5. Clean up every row this check created — this is live merchant data.
  delete from public.order_items where order_id in (
    select id from public.orders
     where project_id = v_pid and order_number in (900001, 900002, 900003, 900004)
  );
  delete from public.orders
   where project_id = v_pid and order_number in (900001, 900002, 900003, 900004);

  RAISE NOTICE '0014: replay dedupe verified (1 row for 2 calls, NULL keys unconstrained), test rows removed';
END $$;
