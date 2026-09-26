-- 0013_close_privilege_escalation_paths.sql
--
-- Audit 2026-09-26. Four privilege gaps, each PROVEN live against production
-- with a real `authenticated` JWT before this migration existed:
--
--   C1  projects: table-level INSERT was never revoked. 0000_init.sql:1907
--       granted ALL to `authenticated`; 0003 revoked only UPDATE. The INSERT
--       policy is just `auth.uid() IS NOT NULL`, so ANY signed-up user could
--       POST /rest/v1/projects and mint a store with any
--       subscription_expires_at (live PoC: 201, expiry 2099). This bypassed
--       onboard_project_transactional entirely — the one-project-per-user
--       guard, slug allocation, and the 3/hour rate limit are all route-only.
--
--   C2  orders: INSERT (incl. total_amount) was granted to `authenticated`.
--       All real pricing lives in createSecureOrder, but nothing forced its
--       use (live PoC: a 0.100 product written as total_amount 0.001).
--       orders_protect_amounts is BEFORE UPDATE only — it never fires on
--       INSERT, which made the table look defended when it was not.
--
--   C4  record_payment_and_renew was EXECUTE-granted to anon+authenticated,
--       contradicting 0010's own REVOKE. The internal
--       `auth.role() <> 'service_role'` guard held under a live anon probe
--       (400 "forbidden: service_role only"), so this is defence-in-depth,
--       not a live bypass — but the grant is the security boundary.
--
--   H2  projects.is_active was updatable by any member, so a suspended store
--       could flip itself back on. CAREFUL: the settings page
--       (settings-client.tsx:110) writes is_active from the browser as a
--       deliberate merchant feature (توقيف المتجر), so the grant STAYS.
--       What is removed is the ability to also touch entitlement columns in
--       the same statement, and the ability to INSERT at all.
--
-- Verified before writing: every order write in the codebase goes through the
-- admin (service_role) client — public/order, public/bill, public/waiter,
-- pos/cancel all use createAdminClient(); the four client components that
-- touch `orders` (orders-client, pos-client, tables-client, use-kitchen-orders)
-- only ever SELECT. No browser code inserts orders or order_items.

-- ---------------------------------------------------------------------------
-- C1 — creation of a project belongs to the service-role RPC only
-- ---------------------------------------------------------------------------
REVOKE INSERT ON public.projects FROM authenticated;

-- Same column-level trap as `orders`: projects carries 11 column-level INSERT
-- grants on top of the table-level one. Revoke the columns too.
DO $$
DECLARE v_col text;
BEGIN
  FOR v_col IN
    SELECT a.attname FROM pg_attribute a
     WHERE a.attrelid = 'public.projects'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format('REVOKE INSERT (%I) ON public.projects FROM authenticated', v_col);
    EXECUTE format('REVOKE UPDATE (%I) ON public.projects FROM authenticated', v_col);
  END LOOP;
END $$;

-- The raw-INSERT policy is now unreachable; drop it so a future
-- GRANT cannot silently re-open the path, and so `projects_insert_authenticated`
-- stops showing up in any policy audit as "allowed".
DROP POLICY IF EXISTS projects_insert_authenticated ON public.projects;

-- ---------------------------------------------------------------------------
-- C2 — orders/order_items are written by trusted server code only
-- ---------------------------------------------------------------------------
-- The client never inserts; advance_order_status (SECURITY DEFINER, granted to
-- authenticated) is the browser's only legitimate write path, and it is a
-- function call, not a table INSERT.
--
-- CRITICAL POSTGRES DETAIL (verified live during this audit): `orders` has NO
-- table-level INSERT grant — it has EIGHT COLUMN-level INSERT grants
-- (created_at, notes, project_id, service_type, status, table_id,
-- total_amount, type). In Postgres a table-level REVOKE does NOT remove
-- column-level grants; the two are independent. `REVOKE INSERT ON TABLE
-- orders` alone would have been a silent no-op and the money bug would have
-- survived. Both layers must be revoked.
REVOKE INSERT ON public.orders FROM authenticated;
REVOKE INSERT (created_at, notes, project_id, service_type, status, table_id,
               total_amount, type)
  ON public.orders FROM authenticated;
REVOKE INSERT ON public.order_items FROM authenticated;
DO $$
DECLARE v_col text;
BEGIN
  FOR v_col IN
    SELECT a.attname FROM pg_attribute a
     WHERE a.attrelid = 'public.order_items'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format('REVOKE INSERT (%I) ON public.order_items FROM authenticated', v_col);
  END LOOP;
END $$;

-- Same for the order-row DELETE that sat as a table grant with no DELETE
-- policy behind it. pos/cancel uses the admin client, so this is unused.
REVOKE DELETE ON public.orders FROM authenticated;
REVOKE DELETE ON public.order_items FROM authenticated;

-- Belt-and-braces: even if a write path ever slips in, recompute the amount
-- from order_items on INSERT instead of trusting the client. The UPDATE guard
-- (orders_protect_amounts) already exists; this closes the INSERT side.
CREATE OR REPLACE FUNCTION public.orders_validate_amount_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sum numeric;
BEGIN
  -- service_role writes the authoritative total; only police other roles.
  IF auth.role() = 'service_role' THEN
    RETURN new;
  END IF;

  SELECT COALESCE(SUM(quantity * unit_price), 0) INTO v_sum
    FROM public.order_items
   WHERE order_id = new.id;

  IF new.total_amount IS DISTINCT FROM v_sum THEN
    RAISE EXCEPTION 'total_amount must match order_items sum (got %, expected %)',
      new.total_amount, v_sum
      USING ERRCODE = '42501';
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS orders_validate_amount_on_insert ON public.orders;
CREATE TRIGGER orders_validate_amount_on_insert
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_validate_amount_on_insert();

-- ---------------------------------------------------------------------------
-- C4 — the money RPC is service_role only, as 0010 intended
-- ---------------------------------------------------------------------------
-- Signature verified live via pg_get_function_identity_arguments — 7 args,
-- with p_caller_id last. A wrong arity here fails silently at REVOKE time.
REVOKE ALL ON FUNCTION public.record_payment_and_renew(
  uuid, numeric, text, text, text, integer, uuid
) FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- H2 — entitlement columns are not member-writable
-- ---------------------------------------------------------------------------
-- is_active stays writable (merchant-controlled pause), but the remaining
-- entitlement surface is explicitly withheld at the grant layer so a future
-- column addition cannot ride along on a blanket table grant.
REVOKE UPDATE ON public.projects FROM authenticated;
GRANT UPDATE (name, currency, primary_color, is_active)
  ON public.projects TO authenticated;

-- ---------------------------------------------------------------------------
-- Audit-trail integrity: order_audit_logs is append-only and written solely by
-- the order route's admin client (public/order/route.ts:115). A member could
-- otherwise fabricate 'delivered' entries for their own store.
--
-- INSERT stays (pos/cancel and the public routes write audit rows through the
-- admin client, but the table grant is what made fabrication possible): this
-- revokes UPDATE/DELETE so entries are immutable, and removes the table-level
-- INSERT in favour of service_role. 9 column-level INSERT grants also exist.
REVOKE UPDATE ON public.order_audit_logs FROM authenticated;
REVOKE DELETE ON public.order_audit_logs FROM authenticated;
REVOKE INSERT ON public.order_audit_logs FROM authenticated;
DO $$
DECLARE v_col text;
BEGIN
  FOR v_col IN
    SELECT a.attname FROM pg_attribute a
     WHERE a.attrelid = 'public.order_audit_logs'::regclass
       AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format('REVOKE INSERT (%I) ON public.order_audit_logs FROM authenticated', v_col);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Record what is now true, so the next audit does not have to re-derive it.
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION public.orders_validate_amount_on_insert() IS
  'Audit 2026-09-26 (C2): non-service_role order inserts must have total_amount equal to the order_items sum.';
COMMENT ON TABLE public.projects IS
  'Tenant roots. INSERT is service_role-only via onboard_project_transactional (audit 2026-09-26, C1); members may UPDATE only name/currency/primary_color/is_active.';
