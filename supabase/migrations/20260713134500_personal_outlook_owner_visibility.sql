-- Personal Outlook metadata is private to its owner. Organization mailbox
-- metadata remains visible only to active internal users in the same tenant.

BEGIN;

DROP POLICY IF EXISTS "mail_accounts tenant select" ON public.mail_accounts;
CREATE POLICY "mail_accounts tenant select"
ON public.mail_accounts
FOR SELECT TO authenticated
USING (
  organization_id = (SELECT public.get_user_org_id())
  AND (SELECT public.is_internal_user())
  AND EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = (SELECT auth.uid())
       AND p.organization_id = mail_accounts.organization_id
       AND p.is_active = true
  )
  AND deleted_at IS NULL
  AND (
    scope = 'organization'
    OR owner_user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "mail_account_user_access tenant select" ON public.mail_account_user_access;
CREATE POLICY "mail_account_user_access tenant select"
ON public.mail_account_user_access
FOR SELECT TO authenticated
USING (
  organization_id = (SELECT public.get_user_org_id())
  AND (SELECT public.is_internal_user())
  AND EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = (SELECT auth.uid())
       AND p.organization_id = mail_account_user_access.organization_id
       AND p.is_active = true
  )
  AND (
    user_id = (SELECT auth.uid())
    OR (SELECT public.get_user_role())::text = 'admin'
  )
);

COMMIT;
