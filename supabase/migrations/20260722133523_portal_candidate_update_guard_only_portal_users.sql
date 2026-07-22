-- De eerste opzet keerde de vraag verkeerd om: "laat door wie ik ken (service_role, superadmin,
-- intern), beperk de rest". Daardoor viel alles wat géén ingelogde gebruiker is óók in het
-- beperkte bakje — een migratie, een pg_cron-job of een directe adminverbinding kon geen enkele
-- kandidaatkolom meer bijwerken. Fail-closed op de verkeerde as.
--
-- Nu andersom: alleen een ingelogde portaalgebruiker (rol medewerker) wordt beperkt. Alle
-- andere contexten — service_role, interne rollen, superadmins, cron, migraties, postgres —
-- gaan ongemoeid door, want daar is de bescherming niet voor bedoeld en RLS regelt de rest.
create or replace function public.enforce_candidate_portal_update()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $$
declare
  -- Wat het medewerkersportaal daadwerkelijk schrijft: contactgegevens en adres
  -- (PortalProfile), de taalkeuze, de laatste login en de welkomstvideo-marker.
  -- search_unaccent is GENERATED ALWAYS: in een BEFORE-trigger nog niet berekend, dus die
  -- lijkt altijd gewijzigd. Niet rechtstreeks schrijfbaar, dus uitsluiten kost geen
  -- bescherming — maar komt er nog zo'n kolom bij, zet hem er dan bij.
  allowed constant text[] := array[
    'phone', 'email',
    'address_street', 'address_postal', 'address_city', 'address_lat', 'address_lng',
    'portal_language', 'portal_last_login', 'portal_welcome_video_seen_url',
    'updated_at', 'search_unaccent'
  ];
begin
  -- Geen ingelogde gebruiker (migratie, cron, directe verbinding): niets te beperken.
  if auth.uid() is null then
    return new;
  end if;

  -- Alleen de portaalrol wordt beperkt; interne rollen en superadmins niet.
  if not public.is_employee_user() then
    return new;
  end if;

  if (to_jsonb(old) - allowed) is distinct from (to_jsonb(new) - allowed) then
    raise exception 'Vanuit het portaal kun je alleen je eigen contactgegevens, adres en voorkeuren wijzigen'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
