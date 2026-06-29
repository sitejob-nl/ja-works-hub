-- Fix #124 follow-up: the intended single-column FK covering index for
-- candidate_signup_links.vacancy_id was not created on prod, because an older
-- composite partial index already used the name idx_candidate_signup_links_vacancy_id:
--
--   (organization_id, vacancy_id) WHERE vacancy_id IS NOT NULL
--
-- PostgreSQL therefore treated CREATE INDEX IF NOT EXISTS ... (vacancy_id) as
-- a no-op. Keep the existing composite index for tenant-scoped lookups, and add
-- an explicitly named single-column index so the vacancy_id FK is left-prefix
-- covered for parent vacancy updates/deletes.

CREATE INDEX IF NOT EXISTS idx_candidate_signup_links_vacancy_id_fk
  ON public.candidate_signup_links (vacancy_id);
