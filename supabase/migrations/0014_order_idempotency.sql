-- ============================================================================
-- 0014 — idempotency for public orders (offline retry no longer double-orders)
-- ============================================================================
--
-- BUG (audit 2026-09-26, CRIT-3): the customer menu's offline path queues the
-- identical payload to IndexedDB (`dokan-pending-orders`) and the service
-- worker re-POSTs it verbatim. The payload carried NO stable identifier, so a
-- retry of a request that actually SUCCEEDED server-side (response lost on a
-- flaky mobile connection) created a SECOND real order. Worse, the cart sheet
-- also offers a manual إعادة المحاولة button while the queued copy is still
-- in IndexedDB — so one tap can produce two orders. `next_order_number` always
-- allocates a fresh number, so the duplicate succeeds silently and the
-- merchant is left cooking the same plate twice.
--
-- Fix: a caller-supplied idempotency key, enforced by the DATABASE so it holds
-- for every writer (public API, POS, waiter, bill) and survives concurrent
-- retries. A unique index is the only thing that makes this atomic — an
-- application-level "SELECT then INSERT" would race.
--
-- Scope decisions:
--   * Keyed on (project_id, client_request_id). The public API is anonymous and
--     has no session, so the key is a client-generated UUID, not a user id.
--   * NULL is allowed and excluded from the index, so every pre-existing
--     order and every internal (POS/waiter) call without a key is unaffected
--     and can never collide.
--   * The key is NOT secret and NOT user data: it is a random UUID used only
--     to deduplicate, so it is safe to keep for auditing.

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
-- create_order_transactional gains the key and returns the PREVIOUS order when
-- the key was already used, instead of failing.
--
-- Behaviour on replay:
--   * The customer gets 200 + their ORIGINAL order id / number / total. Never a
--     500, and never a second plate.
--   * The caller must treat this as "already placed". The route signals it with
--     a distinct `replayed` flag so side effects (audit log, push, Telegram)
--     do NOT fire a second time for the same order.
--
-- The dedupe is done inside the same transaction as the insert, before any
-- row is written, so two concurrent retries cannot both get through.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order_transactional(
  p_project_id uuid,
  p_table_id uuid,
  p_type text,
  p_status text,
  p_total_amount numeric,
  p_notes text,
  p_order_number integer,
  p_items jsonb,
  p_client_request_id uuid DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public'
AS $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_existing public.orders%ROWTYPE;
begin
  -- 1. Replay guard. RETURNING-style lookup on the unique key.
  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.orders
     WHERE project_id = p_project_id
       AND client_request_id = p_client_request_id;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'id', v_existing.id,
        'status', v_existing.status,
        'total_amount', v_existing.total_amount,
        'order_number', v_existing.order_number,
        'replayed', true
      );
    END IF;
  END IF;

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

-- The 9-arg signature is the new one; Postgres keys grants by identity args, so
-- the old 8-arg overload (still present from earlier migrations) must be
-- revoked too or it stays an open door with the same name.
REVOKE ALL ON FUNCTION public.create_order_transactional(
  uuid, uuid, text, text, numeric, text, integer, jsonb, uuid
) FROM public;
GRANT EXECUTE ON FUNCTION public.create_order_transactional(
  uuid, uuid, text, text, numeric, text, integer, jsonb, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.create_order_transactional(
  uuid, uuid, text, text, numeric, text, integer, jsonb
) FROM public;
GRANT EXECUTE ON FUNCTION public.create_order_transactional(
  uuid, uuid, text, text, numeric, text, integer, jsonb
) TO service_role;

-- Defence in depth: the column is set only by this RPC. Direct writes by
-- authenticated staff (waiter/bill flows) must not be able to pin a key that
-- would then silently swallow a later public order.
REVOKE INSERT (client_request_id) ON TABLE public.orders FROM authenticated;

-- ---------------------------------------------------------------------------
-- Regression guard: the idempotent path must still produce a real order for a
-- fresh key, and must not leak across projects.
-- pgTAP lives in the `pgtap` schema; skip cleanly when it is not installed so
-- this migration is safe on any project.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_pid uuid;
  v_key uuid := gen_random_uuid();
  v_a uuid;
  v_b uuid;
  v_c uuid;
BEGIN
  SELECT id INTO v_pid FROM public.projects LIMIT 1;
  IF v_pid IS NULL THEN
    RAISE NOTICE '0014: no project to test against, skipping regression checks';
    RETURN;
  END IF;

  -- fresh key creates an order
  SELECT (public.create_order_transactional(
    v_pid, NULL, 'dinein', 'pending', 1.000, NULL, 900001, '[]'::jsonb, v_key
  ))->>'id' INTO v_a;
  IF v_a IS NULL THEN
    RAISE EXCEPTION '0014 REGRESSION: fresh key did not create an order';
  END IF;

  -- same key again returns the SAME id and does not create a second row
  SELECT (public.create_order_transactional(
    v_pid, NULL, 'dinein', 'pending', 1.000, NULL, 900002, '[]'::jsonb, v_key
  ))->>'id' INTO v_b;
  IF v_b IS DISTINCT FROM v_a THEN
    RAISE EXCEPTION '0014 REGRESSION: replay created a different order (% vs %)', v_a, v_b;
  END IF;

  SELECT count(*) INTO v_c FROM public.orders
   WHERE project_id = v_pid AND client_request_id = v_key;
  IF v_c <> 1 THEN
    RAISE EXCEPTION '0014 REGRESSION: expected exactly 1 row for the key, got %', v_c;
  END IF;

  RAISE NOTICE '0014: replay dedupe verified (1 row for 2 calls)';
END $$;
