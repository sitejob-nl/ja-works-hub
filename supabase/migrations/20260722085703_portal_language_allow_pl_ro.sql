-- De portaaltalen zijn uitgebreid met Pools en Roemeens (fase B), maar employees had nog
-- een CHECK op alleen nl/en. Daardoor liep activeren in een andere taal stuk op
-- "employees_portal_language_check". candidates.portal_language heeft geen constraint.
alter table public.employees drop constraint if exists employees_portal_language_check;
alter table public.employees add constraint employees_portal_language_check
  check (portal_language is null or portal_language = any (array['nl','en','pl','ro']));
