-- 0011: Show sold-out products on the public menu (UX: "غير متوفر" badge)
--
-- The old policy hid is_available=false rows from anon entirely, so customers
-- saw items silently disappear when a merchant marked them unavailable —
-- making the menu look shorter/emptier than the store actually is.
-- Industry norm (Talabat/HungerStation): show the item greyed-out with a
-- sold-out badge. Order safety is unaffected: /api/public/order →
-- createSecureOrder re-validates is_available server-side and rejects the
-- line (400) before any insert, so a crafted request still cannot order it.
--
-- Read scope only: the project MUST still be active (subscription cutoff
-- unchanged). Addons policy deliberately untouched — unavailable addons stay
-- hidden from the picker (a sold-out extra adds no information).

DROP POLICY IF EXISTS products_public_read ON public.products;

CREATE POLICY products_public_read ON public.products FOR SELECT TO anon USING (
  EXISTS (
    SELECT 1 FROM public.projects pr
    WHERE pr.id = products.project_id AND pr.is_active = true
  )
);
