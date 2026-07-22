-- search_unaccent is GENERATED ALWAYS en wordt pas ná de BEFORE-triggers berekend. In de
-- trigger is NEW.search_unaccent dus nog leeg terwijl OLD hem wel heeft, waardoor élke update
-- er als een wijziging uitzag en de guard ook toegestane velden blokkeerde.
--
-- Generated columns kun je sowieso niet rechtstreeks schrijven — Postgres weigert dat zelf —
-- dus ze buiten de vergelijking laten kost geen bescherming. Komt er later nog zo'n kolom bij,
-- dan blokkeert deze guard opnieuw alles op die tabel; dat is luidruchtig en dus te vinden,
-- maar zet de nieuwe kolom hier dan bij.
create or replace function public.enforce_candidate_portal_update()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $$
declare
  -- Wat het medewerkersportaal daadwerkelijk schrijft: contactgegevens en adres
  -- (PortalProfile), de taalkeuze, de laatste login en de welkomstvideo-marker.
  allowed constant text[] := array[
    'phone', 'email',
    'address_street', 'address_postal', 'address_city', 'address_lat', 'address_lng',
    'portal_language', 'portal_last_login', 'portal_welcome_video_seen_url',
    'updated_at',
    -- afgeleid, niet schrijfbaar; zie toelichting hierboven
    'search_unaccent'
  ];
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if public.is_superadmin() or public.is_internal_user() then
    return new;
  end if;

  if (to_jsonb(old) - allowed) is distinct from (to_jsonb(new) - allowed) then
    raise exception 'Vanuit het portaal kun je alleen je eigen contactgegevens, adres en voorkeuren wijzigen'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
