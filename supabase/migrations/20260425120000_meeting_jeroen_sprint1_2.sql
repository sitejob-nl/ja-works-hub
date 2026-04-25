-- Meeting Jeroen 2026-04-25 — Sprint 1 + 2 schema-wijzigingen
-- Zie /Users/kas/.claude/plans/zie-mijn-laatste-meeting-ethereal-wilkinson.md
--
-- B1.5: urgency NOT NULL DEFAULT 2 + clamp naar 1-3
-- B2:   vacancies.function_id FK naar company_functions, vacancies.start_date_text
-- B3:   properties.name nullable (adres-gedreven panden)
-- B4:   units drop monthly_cost + deposit_amount (klant wil maandkosten weg, borg op beleidsniveau)

BEGIN;

-- =================================================================
-- B1.5 — urgency normaliseren naar 1-3 schaal en NOT NULL maken
-- =================================================================
-- Bestaande waarden 4 en 5 → 3 (Hoog), 0/null → 2 (Normaal)
UPDATE public.vacancies SET urgency = 3 WHERE urgency >= 3;
UPDATE public.vacancies SET urgency = 2 WHERE urgency IS NULL OR urgency < 1;

ALTER TABLE public.vacancies
  ALTER COLUMN urgency SET DEFAULT 2,
  ALTER COLUMN urgency SET NOT NULL,
  ADD CONSTRAINT vacancies_urgency_range CHECK (urgency BETWEEN 1 AND 3);

-- =================================================================
-- B2 — Functie-koppeling op vacatures + Direct/ZSM tekstveld (C1)
-- =================================================================
ALTER TABLE public.vacancies
  ADD COLUMN function_id uuid REFERENCES public.company_functions(id) ON DELETE SET NULL,
  ADD COLUMN start_date_text varchar(40);

CREATE INDEX vacancies_function_id_idx ON public.vacancies(function_id);

COMMENT ON COLUMN public.vacancies.function_id IS
  'Optionele koppeling naar standaard-functie van het bedrijf. Vrije tekst in title blijft toegestaan voor uitzonderingen.';
COMMENT ON COLUMN public.vacancies.start_date_text IS
  'Tekstuele aanduiding van startdatum (bv. "Direct", "ZSM", "Q2 2026"). Naast start_date; renderer kiest tekst boven datum als beide gevuld.';

-- =================================================================
-- B3 — properties.name optioneel (klant wil adres als primaire identifier)
-- =================================================================
ALTER TABLE public.properties
  ALTER COLUMN name DROP NOT NULL;

COMMENT ON COLUMN public.properties.name IS
  'Optionele bijnaam voor het pand. Standaard wordt het adres getoond als naam ontbreekt.';

-- =================================================================
-- B4 — units: maandkosten en borg verwijderen
-- =================================================================
-- Borg op beleidsniveau (organizations.settings.deposit_default_amount), niet per kamer
-- Maandkosten kan altijd berekend worden als weekly_cost * 4.33 indien nodig
-- View v_unit_occupancy moet eerst worden ge-dropt omdat hij u.monthly_cost selecteert
DROP VIEW IF EXISTS public.v_unit_occupancy;

ALTER TABLE public.units
  DROP COLUMN IF EXISTS monthly_cost,
  DROP COLUMN IF EXISTS deposit_amount;

CREATE VIEW public.v_unit_occupancy AS
SELECT
  u.id AS unit_id,
  u.name AS unit_name,
  p.name AS property_name,
  p.address_city,
  p.address_postal,
  p.address_lat,
  p.address_lng,
  u.organization_id,
  u.capacity,
  u.weekly_cost,
  u.status,
  COALESCE(
    (SELECT COUNT(*)
     FROM public.housing_assignments ha
     WHERE ha.unit_id = u.id AND ha.status = 'ingecheckt'),
    0
  )::integer AS current_occupancy,
  GREATEST(
    u.capacity - COALESCE(
      (SELECT COUNT(*)
       FROM public.housing_assignments ha
       WHERE ha.unit_id = u.id AND ha.status = 'ingecheckt'),
      0
    ),
    0
  )::integer AS available_spots
FROM public.units u
JOIN public.properties p ON p.id = u.property_id;

COMMIT;
