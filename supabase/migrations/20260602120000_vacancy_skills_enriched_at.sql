-- Marker voor de AI vacature-skill-verrijking (enrich-vacancies).
--
-- Zonder marker is een vacature met required_skills = [] (geen catalogus-match) niet te
-- onderscheiden van "nog nooit verwerkt" → zou bij elke run opnieuw naar Gemini gaan +
-- opnieuw afgeschreven worden. Met skills_enriched_at filtert enrich-vacancies op IS NULL,
-- zet de marker bij elke terminale uitkomst (done/skipped/failed) en convergeert zo netjes,
-- idempotent over re-runs en self-triggers (status-cursor i.p.v. offset).
ALTER TABLE public.vacancies ADD COLUMN IF NOT EXISTS skills_enriched_at timestamptz;