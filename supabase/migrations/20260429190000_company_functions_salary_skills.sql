-- Meeting Jeroen 2026-04-29 — company_functions: salaris-range + skills
-- Live toegepast via Supabase MCP als 20260429190000_company_functions_salary_skills.
--
-- Salaris-range op functie-niveau (klant: "geen vast uurtarief, range") + standaard-skills
-- per functie. Vacature erft beide als defaults; user kan overschrijven. Skills worden
-- ook gebruikt door talentpool "Genereer uit functie" om filter_criteria te vullen.

ALTER TABLE public.company_functions
  ADD COLUMN IF NOT EXISTS salary_min numeric(10,2),
  ADD COLUMN IF NOT EXISTS salary_max numeric(10,2),
  ADD COLUMN IF NOT EXISTS required_skills text[] DEFAULT '{}';

COMMENT ON COLUMN public.company_functions.salary_min IS 'Onderkant uurtarief-range; default voor nieuwe vacatures.';
COMMENT ON COLUMN public.company_functions.salary_max IS 'Bovenkant uurtarief-range; default voor nieuwe vacatures.';
COMMENT ON COLUMN public.company_functions.required_skills IS 'Standaard-vaardigheden voor deze functie. Wordt overgenomen bij vacature en gebruikt voor talentpool-matching.';
