-- whatsapp_templates: DELETE + INSERT intern-gaten (consistent met SELECT/UPDATE die al
-- is_internal_user() eisen). Voorheen org-breed → elke in-org rol (incl. medewerker/
-- opdrachtgever) kon rijen deleten/inserten. De UI muteert templates via de Meta-API
-- (whatsapp-api, intern-gated) en sync via service-role; deze policies dekken directe
-- tabeltoegang af. Idempotent.
DROP POLICY IF EXISTS tenant_delete_wa_tpl ON public.whatsapp_templates;
CREATE POLICY tenant_delete_wa_tpl ON public.whatsapp_templates
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_insert_wa_tpl ON public.whatsapp_templates;
CREATE POLICY tenant_insert_wa_tpl ON public.whatsapp_templates
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());
