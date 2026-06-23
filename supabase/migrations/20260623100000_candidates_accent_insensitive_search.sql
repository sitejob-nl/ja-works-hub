-- Z1 (meeting 17-06): accent-insensitief zoeken op kandidaten ("Jose" vindt "José").
-- unaccent() is STABLE; de 2-arg vorm unaccent(regdictionary, text) is IMMUTABLE en
-- mag dus in een generated column + index (canoniek Postgres-wiki patroon).
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.f_unaccent(text)
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  SET search_path = ''
AS $func$ SELECT extensions.unaccent('extensions.unaccent'::regdictionary, $1) $func$;

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS search_unaccent text
  GENERATED ALWAYS AS (
    lower(public.f_unaccent(
      coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' ||
      coalesce(address_city,'') || ' ' || coalesce(email,'') || ' ' ||
      coalesce(phone,'') || ' ' || coalesce(phone_nl,'')
    ))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_candidates_search_unaccent_trgm
  ON public.candidates USING gin (search_unaccent extensions.gin_trgm_ops);

COMMENT ON COLUMN public.candidates.search_unaccent IS
  'Accent-insensitief zoekveld (lower+unaccent van naam/stad/email/telefoon). Voor ilike-zoeken; client foldt de zoekterm ook.';
