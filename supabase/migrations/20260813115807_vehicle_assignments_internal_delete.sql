-- BUG 5 — een voertuigtoewijzing verwijderen deed niets: geen foutmelding, maar de rij bleef
-- staan (stille 0-rijen-delete). Oorzaak: de DELETE-policy op public.vehicle_assignments was
-- nog admin-only (get_user_role() = 'admin'), terwijl tenant_select/tenant_insert/tenant_update
-- al op is_internal_user() staan. RLS filtert een DELETE weg in plaats van hem te weigeren, dus
-- een intercedent/backoffice/finance kreeg geen 42501 maar een lege response.
--
-- Deze migratie trekt DELETE gelijk met de rest van het transport-cluster
-- (vehicle_damage_reports_delete_policy, fuel_card_transactions_delete_policy): org-scope +
-- is_internal_user(). De portal-rollen medewerker/opdrachtgever en de facility-rol krijgen
-- bewust géén delete — is_internal_user() sluit ze uit; hun eigen self-policies (bv.
-- vehicle_assignment_self_select) blijven ongemoeid en zijn read-only.
--
-- De oude policy stond op rol {public}; de nieuwe op {authenticated}, conform het patroon van
-- de recente policy-migraties. SELECT-wrapping van de helpers voor het initplan (zie
-- 20260615093315_perf_rls_initplan.sql). Idempotent.

BEGIN;

DROP POLICY IF EXISTS tenant_delete ON public.vehicle_assignments;
CREATE POLICY tenant_delete ON public.vehicle_assignments
  FOR DELETE TO authenticated
  USING (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
  );

COMMIT;

-- Verificatie na uitrol (verwacht: tenant_delete op {authenticated} met is_internal_user()):
--   SELECT policyname, roles, cmd, qual
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'vehicle_assignments' AND cmd = 'DELETE';
