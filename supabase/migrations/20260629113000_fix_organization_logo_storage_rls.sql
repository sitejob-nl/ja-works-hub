-- Fix organization logo uploads through Supabase Storage.
--
-- The app uploads organization logos from the browser to:
--   organization-logos/{organization_id}/logo.ext
--
-- Existing logo policies were scoped to the authenticated database role, but
-- production uploads can still hit Storage as a public role with a valid
-- auth.uid() claim. Keep the policy narrow: only an active admin can read or
-- mutate logo objects inside their own organization folder.

BEGIN;

DROP POLICY IF EXISTS organization_logos_admin_select_own_org ON storage.objects;
DROP POLICY IF EXISTS organization_logos_admin_insert_own_org ON storage.objects;
DROP POLICY IF EXISTS organization_logos_admin_update_own_org ON storage.objects;

CREATE POLICY organization_logos_admin_select_own_org
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'organization-logos'
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.is_active IS TRUE
      AND p.role = 'admin'::public.user_role
      AND p.organization_id::text = split_part(name, '/', 1)
  )
);

CREATE POLICY organization_logos_admin_insert_own_org
ON storage.objects
FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'organization-logos'
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.is_active IS TRUE
      AND p.role = 'admin'::public.user_role
      AND p.organization_id::text = split_part(name, '/', 1)
  )
);

CREATE POLICY organization_logos_admin_update_own_org
ON storage.objects
FOR UPDATE
TO public
USING (
  bucket_id = 'organization-logos'
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.is_active IS TRUE
      AND p.role = 'admin'::public.user_role
      AND p.organization_id::text = split_part(name, '/', 1)
  )
)
WITH CHECK (
  bucket_id = 'organization-logos'
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.is_active IS TRUE
      AND p.role = 'admin'::public.user_role
      AND p.organization_id::text = split_part(name, '/', 1)
  )
);

COMMIT;
