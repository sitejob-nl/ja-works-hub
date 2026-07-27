-- Kandidaatomschrijving terugwinnen uit oudere vacatures (meeting 27-07, opvolging).
--
-- Vóór de SEO-tab bestond, plakten recruiters de héle AI-output in `vacancies.description`:
-- de websitetekst, het AI-matchingprofiel, de zoekwoorden én de interne eindcontrole-lijst,
-- gescheiden door `## `-koppen. Na de invoering van `candidate_description` kwam die dump
-- onder het kopje "Interne omschrijving" te staan — verkeerd gelabeld (het ís de vacaturetekst)
-- en met de opmaakcodes zichtbaar. Erger: het portaal viel terug op `description`, zodat een
-- kandidaat de eerste regels van die dump te zien kon krijgen, inclusief "## Volledige
-- SEO-vacaturetekst".
--
-- Deze backfill haalt alleen het eerste blok — de vacaturetekst zelf — naar
-- `candidate_description`. `description` blijft ongemoeid: geen dataverlies, en de UI toont
-- daar voortaan alleen nog het interne deel (zie splitGeneratedVacancyDescription in
-- src/lib/rich-text.ts, die exact dezelfde knip maakt).
--
-- Idempotent: raakt alleen rijen zonder kandidaatomschrijving. Op productie uitgevoerd op
-- 2026-07-27 (26 vacatures in de JA Werkt-org).

with dump as (
  select id,
         regexp_replace(description, E'^[\\s\\S]*?#{1,6}[ \\t]*Volledige SEO-vacaturetekst[^\\n]*\\n', '') as rest
  from public.vacancies
  where candidate_description is null
    and description ~ E'#{1,6}[ \\t]*Volledige SEO-vacaturetekst'
), split as (
  select id, btrim(split_part(rest, E'\n## ', 1)) as kandidaattekst
  from dump
)
update public.vacancies v
   set candidate_description = s.kandidaattekst
  from split s
 where v.id = s.id
   -- Ondergrens tegen een mislukte knip: een echte vacaturetekst is nooit een paar regels.
   and length(s.kandidaattekst) > 300;
