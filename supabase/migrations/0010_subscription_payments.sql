-- 0010: subscription_payments table + record_payment RPC
-- Manual payment tracking for super-admins (bank transfer / stc pay).
-- Paired with renew_subscription to unblock real renewals before Stripe.

CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  amount      numeric(10,3) NOT NULL CHECK (amount > 0),
  currency    text NOT NULL DEFAULT 'BHD',
  method      text NOT NULL CHECK (method IN ('bank-transfer', 'stc-pay')),
  receipt     text,                     -- optional receipt / reference number
  paid_at     timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL,            -- super_admin user_id
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS: only super_admins can read/write
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can select subscription_payments"
  ON public.subscription_payments FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid()));

CREATE POLICY "Super admins can insert subscription_payments"
  ON public.subscription_payments FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid()));

-- Index for project payment history
CREATE INDEX idx_subscription_payments_project
  ON public.subscription_payments(project_id, paid_at DESC);

-- Function: record a manual payment AND renew the subscription in one atomic call.
-- Returns the new expiry date. Only callable by service_role (called from the
-- API route which re-checks super-admin membership before invoking).
CREATE OR REPLACE FUNCTION public.record_payment_and_renew(
  p_project_id   uuid,
  p_amount       numeric,
  p_method       text,
  p_receipt      text DEFAULT NULL,
  p_notes        text DEFAULT NULL,
  p_days         int  DEFAULT 30,
  p_caller_id    uuid DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid;
  v_expiry  timestamptz;
BEGIN
  v_caller := coalesce(p_caller_id, auth.uid());
  IF v_caller IS NULL OR auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: service_role only';
  END IF;

  -- Record the payment
  INSERT INTO subscription_payments (project_id, amount, currency, method, receipt, recorded_by, notes)
  VALUES (p_project_id, p_amount, 'BHD', p_method, p_receipt, v_caller, p_notes);

  -- Renew the subscription
  UPDATE projects
     SET subscription_expires_at = greatest(subscription_expires_at, now()) + make_interval(days => p_days),
         is_active = true,
         deleted_at = NULL
   WHERE id = p_project_id
   RETURNING subscription_expires_at INTO v_expiry;

  RETURN v_expiry;
END $$;

REVOKE ALL ON FUNCTION public.record_payment_and_renew(uuid, numeric, text, text, text, int, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_and_renew(uuid, numeric, text, text, text, int, uuid) TO service_role;