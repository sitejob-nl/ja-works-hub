-- Buglijst 19-08: schemauitbreidingen voor de punten 13, 20 en 22.
--
-- Punt 13 — "We willen zien wie welke toewijzing heeft gedaan."
-- placements/matches leggen de gebruiker al vast; huisvestings- en voertuig-
-- toewijzingen niet. Alleen vooruit invulbaar: voor bestaande rijen is de
-- actor nergens bewaard (deze inserts gaan niet door audit_log heen).
alter table public.vehicle_assignments
  add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.housing_assignments
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

comment on column public.vehicle_assignments.created_by is
  'Interne gebruiker die de toewijzing maakte. Leeg voor rijen van vóór 19-08-2026.';
comment on column public.housing_assignments.created_by is
  'Interne gebruiker die de toewijzing maakte. Leeg voor rijen van vóór 19-08-2026.';

-- Punt 20 — afvalkosten en internetkosten als eigen maandlast (zaten tot nu toe
-- verstopt in cost_other), plus het daadwerkelijk betaalde borgbedrag naast het
-- bestaande ja/nee-vinkje.
alter table public.properties
  add column if not exists cost_waste numeric,
  add column if not exists cost_internet numeric;
alter table public.housing_assignments
  add column if not exists deposit_amount numeric;

comment on column public.housing_assignments.deposit_amount is
  'Betaald borgbedrag. deposit_paid blijft de ja/nee-vlag.';

-- Punt 22 — indexatiedatum van de huur; housing-reminder-cron maakt hier een
-- taak van zodra de datum binnen twee weken valt.
alter table public.properties
  add column if not exists indexation_date date;

comment on column public.properties.indexation_date is
  'Eerstvolgende huurindexatie. Voedt de herinnering (2 weken vooraf) in housing-reminder-cron.';
