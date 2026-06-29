-- M1: voorkom dubbele matches voor dezelfde kandidaat/vacature binnen een organisatie.
--
-- De UI sluit bestaande matches client-side uit en vangt 23505 al netjes af, maar zonder
-- DB-constraint blijven race conditions en directe API-calls duplicaten toelaten.

CREATE TEMP TABLE tmp_duplicate_match_map ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER match_group AS keeper_id,
    row_number() OVER match_group AS rn
  FROM public.matches
  WINDOW match_group AS (
    PARTITION BY organization_id, vacancy_id, candidate_id
    ORDER BY
      CASE status::text
        WHEN 'geplaatst' THEN 0
        WHEN 'geaccepteerd' THEN 1
        WHEN 'voorgesteld_bij_klant' THEN 2
        ELSE 3
      END,
      match_score DESC NULLS LAST,
      updated_at DESC NULLS LAST,
      created_at DESC NULLS LAST,
      id
  )
)
SELECT id AS duplicate_id, keeper_id
FROM ranked
WHERE rn > 1;

UPDATE public.match_feedback_events feedback
SET match_id = duplicate.keeper_id
FROM tmp_duplicate_match_map duplicate
WHERE feedback.match_id = duplicate.duplicate_id;

UPDATE public.match_proposal_tokens token
SET match_id = duplicate.keeper_id
FROM tmp_duplicate_match_map duplicate
WHERE token.match_id = duplicate.duplicate_id;

DELETE FROM public.matches match
USING tmp_duplicate_match_map duplicate
WHERE match.id = duplicate.duplicate_id;

CREATE UNIQUE INDEX IF NOT EXISTS matches_org_vacancy_candidate_unique_idx
  ON public.matches (organization_id, vacancy_id, candidate_id);
