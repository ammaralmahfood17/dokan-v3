-- 0012: product-images storage bucket + member-scoped RLS
--
-- Root cause (2026-09-24): the v3 project was built from the SQL baseline,
-- which never creates storage buckets — storage.buckets was EMPTY, so every
-- product-image upload died with "Bucket not found" behind a generic
-- "فشل رفع الصورة" toast.
--
-- Design:
-- * PUBLIC bucket: the customer menu references images directly via
--   getPublicUrl (src/components/dashboard/products/image-uploader.tsx),
--   CSP + next/image remotePatterns already allow https://*.supabase.co.
--   Reads go through the /object/public/ path (bucket flag, not policies).
-- * Limits mirror the client contract (image-uploader.tsx): 5MB, jpg/png/webp.
-- * INSERT/UPDATE/DELETE require PROJECT MEMBERSHIP: the first path folder
--   (projectId) must belong to a project where auth.uid() is a member in
--   staff_members (same predicate the is_project_member RPC uses;
--   staff_members has no is_active column). Without a membership policy any
--   logged-in user could spray files into another store's folder.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880,
  ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "product_images_member_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND EXISTS (
    SELECT 1 FROM public.staff_members sm
    WHERE sm.user_id = auth.uid()
      AND sm.project_id::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY "product_images_member_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'product-images'
  AND EXISTS (
    SELECT 1 FROM public.staff_members sm
    WHERE sm.user_id = auth.uid()
      AND sm.project_id::text = (storage.foldername(name))[1]
  )
)
WITH CHECK (
  bucket_id = 'product-images'
  AND EXISTS (
    SELECT 1 FROM public.staff_members sm
    WHERE sm.user_id = auth.uid()
      AND sm.project_id::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY "product_images_member_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'product-images'
  AND EXISTS (
    SELECT 1 FROM public.staff_members sm
    WHERE sm.user_id = auth.uid()
      AND sm.project_id::text = (storage.foldername(name))[1]
  )
);
