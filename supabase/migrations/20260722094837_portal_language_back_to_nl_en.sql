-- Het portaal biedt weer alleen Nederlands en Engels aan: de vaste UI-teksten worden nu
-- vertaald met een meegebouwd woordenboek in plaats van een vertaaldienst, en daarvan is
-- alleen een Engelse versie gemaakt. Geverifieerd dat geen enkele rij pl/ro heeft.
alter table public.employees drop constraint if exists employees_portal_language_check;
alter table public.employees add constraint employees_portal_language_check
  check (portal_language is null or portal_language = any (array['nl','en']));
