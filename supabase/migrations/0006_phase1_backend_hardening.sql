-- 0006: Phase 1 backend hardening batch (advisor remediation: search_path,
-- extension placement, intentional-table docs, RLS initplan, FK indexes,
-- duplicate index, merged staff UPDATE policies).

-- ---------------------------------------------------------------------------
-- 1.1 function_search_path_mutable — pin search_path on the two flagged
-- plain functions (same pattern as the rest of the schema).
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.generate_basic_slug(input text) SET search_path TO 'public';
ALTER FUNCTION public.update_updated_at()  SET search_path TO 'public';

-- ---------------------------------------------------------------------------
-- 1.2 Extension hygiene — unaccent lives in public (shipped by initdb
-- legacy); move to a dedicated schema. Verified no dependent objects:
-- zero references in public function bodies, expression indexes, or column
-- defaults (catalog-checked before writing this migration).
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION unaccent SET SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 1.3 RLS-on / zero-policy tables — intentional (service_role-only). Self-
-- documenting for the next audit; silences rls_disabled_no_policy ambiguity.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.daily_order_counters   IS 'Intentional: RLS enabled with ZERO policies — reachable only via service_role (next_order_number RPC). Direct anon/authenticated access is denied by design.';
COMMENT ON TABLE public.impersonation_sessions IS 'Intentional: RLS enabled with ZERO policies — service_role-only (impersonation start/end routes); never readable by web roles directly.';
COMMENT ON TABLE public.rate_limits            IS 'Intentional: RLS enabled with ZERO policies — service_role-only via rate_limit_check RPC.';
COMMENT ON TABLE public.super_admin_audit_log  IS 'Intentional: RLS enabled with ZERO policies — written/read via service_role only (super-admin routes); append-only audit trail.';
COMMENT ON TABLE public.super_admins           IS 'Intentional: RLS enabled with ZERO policies — membership checked inside SECURITY DEFINER functions (service_role); web roles never query this table directly.';

-- ---------------------------------------------------------------------------
-- 1.4 auth_rls_initplan + 1.7 merged duplicate permissive UPDATE policies.
-- staff_update_own_prefs (user_id = auth.uid()) and staff_update_owner
-- (is_project_owner) were both permissive FOR UPDATE — identical row
-- semantics as ONE policy with an OR, so merging is behavior-preserving
-- (original intent, 0000_init batch: staff toggles own notify prefs; owner
-- manages staff rows in their project). All auth.uid() calls wrapped as
-- (SELECT auth.uid()) so Postgres evaluates them ONCE per query (initplan).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS staff_update_own_prefs ON public.staff_members;
DROP POLICY IF EXISTS staff_update_owner     ON public.staff_members;
CREATE POLICY staff_update_own_or_owner ON public.staff_members
  FOR UPDATE
  USING  ((user_id = (SELECT auth.uid())) OR public.is_project_owner(project_id))
  WITH CHECK ((user_id = (SELECT auth.uid())) OR public.is_project_owner(project_id));

ALTER POLICY projects_insert_authenticated ON public.projects
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

ALTER POLICY push_subscriptions_delete ON public.push_subscriptions
  USING ((SELECT auth.uid()) = user_id);

ALTER POLICY push_subscriptions_select ON public.push_subscriptions
  USING ((SELECT auth.uid()) = user_id);

ALTER POLICY push_subscriptions_insert ON public.push_subscriptions
  WITH CHECK (((SELECT auth.uid()) = user_id) AND EXISTS (
    SELECT 1 FROM public.staff_members sm
    WHERE sm.user_id = (SELECT auth.uid())
      AND sm.project_id = push_subscriptions.project_id));

ALTER POLICY staff_select_own_or_owner ON public.staff_members
  USING ((user_id = (SELECT auth.uid())) OR public.is_project_owner(project_id));

ALTER POLICY staff_insert_first_owner ON public.staff_members
  WITH CHECK ((user_id = (SELECT auth.uid()))
    AND (role = 'owner'::text)
    AND public.project_has_no_members(project_id)
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = staff_members.project_id
        AND p.created_by = (SELECT auth.uid())));

-- ---------------------------------------------------------------------------
-- 1.5 Missing FK indexes — live catalog audit (pg_constraint vs pg_index,
-- leading-column coverage) confirmed these 6 unindexed. The doc list also
-- named orders.table_id, products.category_id, service_requests.table_id,
-- telegram_links.user_id — those are ALREADY covered by existing indexes
-- (verified live); skipped deliberately.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_order_items_order_id       ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id     ON public.order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_projects_created_by        ON public.projects(created_by);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_created_by  ON public.telegram_link_codes(created_by);
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_project_id  ON public.telegram_link_codes(project_id);

-- ---------------------------------------------------------------------------
-- 1.6 Duplicate index: idx_push_sub_project and idx_push_subscriptions_project_id
-- are identical btree(project_id) (verified via pg_indexes). Drop the older
-- short name, keep the consistently named one.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_push_sub_project;
