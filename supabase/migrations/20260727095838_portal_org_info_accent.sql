-- Breid get_portal_org_info() uit met de accentkleur.
--
-- Het portaal is de plek waar medewerkers de PWA op hun telefoon installeren, dus daar
-- moet het manifest de organisatie volgen (naam, icoon, theme-kleur). Naam en logo gaf de
-- RPC al; `accent_color` ontbrak, en medewerkers mogen `organizations` niet direct lezen
-- (org_select vereist is_internal_user()).
--
-- Alleen de accentkleur wordt toegevoegd — een kleur is niet gevoelig en staat al in de
-- UI. De rest van `settings` blijft buiten bereik, want daar zitten onder meer
-- role_permissions in.
--
-- CREATE OR REPLACE kan de returns-signatuur niet wijzigen, dus eerst droppen.

BEGIN;

DROP FUNCTION IF EXISTS public.get_portal_org_info();

CREATE FUNCTION public.get_portal_org_info()
RETURNS TABLE (name text, logo_url text, welcome_video_url text, accent_color text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $$
  SELECT
    o.name,
    o.logo_url,
    nullif(o.settings->>'portal_welcome_video_url', ''),
    nullif(o.settings->>'accent_color', '')
  FROM public.organizations o
  WHERE o.id = public.get_user_org_id()
$$;

REVOKE ALL ON FUNCTION public.get_portal_org_info() FROM public;
REVOKE ALL ON FUNCTION public.get_portal_org_info() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_portal_org_info() TO authenticated;

COMMIT;
