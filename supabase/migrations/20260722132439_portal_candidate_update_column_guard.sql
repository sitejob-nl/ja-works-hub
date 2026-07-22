-- De policy candidate_self_update laat een portaalgebruiker zijn eigen kandidaatrij bijwerken,
-- maar RLS kent geen kolomrechten: tot nu toe kon een medewerker in principe élke kolom op
-- zichzelf zetten — status, employee_status, ai_classification, noem maar op. Kolomgrants
-- helpen niet, want interne gebruikers en portaalgebruikers zitten allebei in de rol
-- `authenticated`.
--
-- Vandaar een trigger, in dezelfde vorm als enforce_organization_settings_update: service_role,
-- superadmins en interne rollen gaan ongemoeid door; een portaalgebruiker mag alleen de velden
-- wijzigen die het portaal zelf aanbiedt.
--
-- De trigger heet bewust `a_...` zodat hij vóór encrypt_candidate_data draait. Daardoor zie ik
-- NEW precies zoals de client hem stuurde: laat de client bsn ongemoeid, dan is NEW.bsn gelijk
-- aan de opgeslagen (versleutelde) waarde; stuurt hij een nieuwe bsn mee, dan wijkt die af en
-- wordt de update geweigerd.
--
-- NB: deze eerste versie mist search_unaccent in de uitzonderingslijst en blokkeert daardoor
-- ook toegestane updates; dat wordt hersteld in 20260722132528.
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
    'updated_at'
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

drop trigger if exists a_portal_column_guard on public.candidates;
create trigger a_portal_column_guard
  before update on public.candidates
  for each row
  execute function public.enforce_candidate_portal_update();
