-- Perf: opvolging unused_index-advisor (Supabase advisors-run 2026-06-28, architectuur-audit Pri 4).
-- Stats zijn 202 dagen oud (reset 2025-12-08) => idx_scan=0 is hier betrouwbaar, geen koude-stats artefact.
-- Reeds toegepast op prod via apply_migration (versie 20260628133123); dit bestand is de spiegel
-- voor lokale dev/CI-consistentie.
--
-- Van de ~67 'unused' indexen is het overgrote deel BEWUST behouden:
--   * primary keys + unique-constraints (integriteit);
--   * de FK-covering-indexen uit 20260628125735 (vandaag toegevoegd -> nog 0 scans, maar nodig
--     tegen lock-escalatie bij parent-deletes/merges en om de unindexed-FK-advisor niet te heropenen);
--   * kleine partial-indexen voor nieuwe/low-volume features (email-threading email_conversation_id/
--     email_message_id, voys_call_id, contracts.signature_request_id, talentpools dynamic-refresh,
--     whatsapp waba_id, signup-link slug_active) -> 8-16 kB elk, gaan meelopen zodra de feature volume krijgt.
-- Slechts twee acties hebben echte waarde:
--
-- 1) idx_candidates_name_trgm is DOOD: opgevolgd door idx_candidates_search_unaccent_trgm
--    (accent-ongevoelig zoeken op de generated kolom candidates.search_unaccent; migratie 20260623074238).
--    UI zoekt nu op search_unaccent (Candidates.tsx / TopBar.tsx), niet meer op first_name||last_name.
--    824 kB, idx_scan=0 -> droppen.
--
-- 2) candidates_cv_fts_idx werd NOOIT gebruikt door een EXPRESSIE-MISMATCH: de index stond op
--    to_tsvector('dutch', COALESCE(cv_raw_text,'')) (migratie 20260402140000) maar PostgREST
--    .textSearch('cv_raw_text', q, {config:'dutch'}) genereert to_tsvector('dutch', cv_raw_text)
--    (zonder COALESCE) -> seq scan (kost 1375 vs 19 met index). Live feature: Candidates CV-zoek,
--    talentpool cv_search-filter, refresh-talentpool-members. Herbouw zonder COALESCE zodat de index
--    daadwerkelijk gebruikt wordt (bitmap index scan). tsvector van NULL matcht nooit een tsquery,
--    dus identieke resultaten + kleinere index.

DROP INDEX IF EXISTS public.idx_candidates_name_trgm;

DROP INDEX IF EXISTS public.candidates_cv_fts_idx;
CREATE INDEX IF NOT EXISTS candidates_cv_fts_idx ON public.candidates
  USING gin (to_tsvector('dutch'::regconfig, cv_raw_text));
