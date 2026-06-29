-- Perf: redundante-index cleanup, vervolg op 20260628133123 (unused_index-advisor 2026-06-28).
-- Op deze (nu nog lege/kleine) tabellen betekent idx_scan=0 vooral "tabel is leeg", niet
-- "index is slecht". Daarom hier ALLEEN echte redundantie verwijderd (dubbele dekking),
-- geverifieerd tegen de query-shapes:
--
-- 1) candidate_signup_links had 3 indexen op slug. De enige lookup is .eq('slug', x) zonder
--    is_active-filter (candidate-signup getSignupLink). De UNIQUE candidate_signup_links_slug_key
--    dekt elke slug-equality -> idx_candidate_signup_links_slug (plain, identieke dekking) en
--    _slug_active (partial WHERE is_active, nooit getroffen door de filterloze lookup) zijn beide overbodig.
-- 2) organization_domains_domain_idx (plain domain) is overbodig: host->org-resolutie filtert altijd
--    removed_at IS NULL + status='verified' (resolve_organization_domain) en wordt gedekt door de UNIQUE
--    partial organization_domains_domain_unique (domain WHERE removed_at IS NULL).
--
-- Bewust BEHOUDEN (valide low-volume/lege-tabel paden, geen redundantie): idx_whatsapp_config_waba_id
-- (whatsapp-webhook .eq('waba_id')), communications email/voys partials, contracts signature_request_id,
-- registration_attempts ip_hash+time (rate-limit), talentpools dynamic-refresh, org wildcard_suffix,
-- payslips/annual_statements/hour_letters periode-indexen.
--
-- Reeds toegepast op prod via apply_migration (versie 20260628134223); dit bestand is de spiegel
-- voor lokale dev/CI-consistentie.

DROP INDEX IF EXISTS public.idx_candidate_signup_links_slug;
DROP INDEX IF EXISTS public.idx_candidate_signup_links_slug_active;
DROP INDEX IF EXISTS public.organization_domains_domain_idx;
