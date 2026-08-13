-- BUG 1 — "Kan geen nieuwe eigenaar aanmaken van een woning" (42501, melding
-- "Onvoldoende rechten voor insert op property_owner").
--
-- Oorzaak was NIET de RLS: `tenant_insert` op public.property_owners staat de insert
-- gewoon toe (org-scope + is_internal_user()). De blokkade zat in de rolrechten-trigger
-- `role_permission_write_guard`, die in 20260713120000_enforce_role_permissions_end_to_end.sql
-- op property_owners is aangehaakt met permissie 'settings.manage'. Bij JA Werkt heeft geen
-- enkele niet-admin die permissie, dus intercedent/backoffice/finance liepen vast terwijl de
-- RLS ze wél doorliet — een mismatch tussen twee autorisatielagen op dezelfde tabel.
--
-- Inhoudelijk hoort een eigenaar/verhuurder bij de operationele master-data van de
-- huisvestingsflow (je maakt hem aan terwijl je een woning invoert), niet bij de
-- organisatie-instellingen. `properties` en `units` hebben deze guard dan ook niet.
-- Daarom: INSERT/UPDATE los van settings.manage, DELETE blijft eraan hangen — verwijderen
-- van master-data waar woningen aan hangen blijft een beheerdersactie.
--
-- LET OP: migratie 20260713120000 hangt de guard bij een schone `db push` opnieuw met
-- 'settings.manage' aan (INSERT OR UPDATE OR DELETE). Deze migratie heeft daarom een latere
-- timestamp: ze draait ná die DO-loop en zet de trigger terug naar alleen DELETE.

BEGIN;

DROP TRIGGER IF EXISTS role_permission_write_guard ON public.property_owners;

CREATE TRIGGER role_permission_write_guard
-- Alleen INSERT wordt vrijgegeven: dat is wat de huisvestingsflow nodig heeft (de dialog
-- 'Nieuwe eigenaar' kan uitsluitend aanmaken). Bewerken en verwijderen van eigenaar-
-- master-data blijft achter settings.manage, want het enige beheerscherm daarvoor
-- (PropertyOwnersSettings) zit sowieso achter diezelfde permissie.
BEFORE UPDATE OR DELETE ON public.property_owners
FOR EACH ROW EXECUTE FUNCTION public.enforce_role_permission_write('settings.manage');

COMMENT ON TABLE public.property_owners IS
  'Master-data voor verhuurder/eigenaar. Eén rij per unieke owner per organisatie; properties verwijzen via owner_id. '
  'Aanmaken/bijwerken mag elke interne rol (RLS: org-scope + is_internal_user()) omdat dit onderdeel is van de '
  'huisvestingsflow; alleen verwijderen vereist de permissie settings.manage via role_permission_write_guard.';

COMMIT;

-- Verificatie na uitrol (verwacht: één rij, tgtype zonder INSERT/UPDATE):
--   SELECT tgname, pg_get_triggerdef(oid)
--   FROM pg_trigger
--   WHERE tgrelid = 'public.property_owners'::regclass AND NOT tgisinternal;
