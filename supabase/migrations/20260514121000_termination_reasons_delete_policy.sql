-- Allow internal users to fully manage termination reasons from Settings.
-- The table had SELECT/UPDATE policies after portal role gating, but no DELETE
-- policy, so the UI delete action was blocked by RLS.

DROP POLICY IF EXISTS tenant_insert ON public.termination_reasons;
CREATE POLICY tenant_insert ON public.termination_reasons
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.is_internal_user()
  );

DROP POLICY IF EXISTS tenant_delete ON public.termination_reasons;
CREATE POLICY tenant_delete ON public.termination_reasons
  FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.is_internal_user()
  );
