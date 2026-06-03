-- Verruim ai_usage_log.provider CHECK met 'gemini'.
--
-- Het Gemini-pad in analyze-cv roept logAiUsage() aan met provider = 'gemini'.
-- De oorspronkelijke constraint stond alleen ('vps','cloud') toe, waardoor die
-- INSERT op de CHECK faalde. logAiUsage is silent-fail, dus de hoofdflow brak niet,
-- maar geen enkele Gemini-analyse landde in ai_usage_log (verlies van usage-/billing-audit).
ALTER TABLE public.ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;
ALTER TABLE public.ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check CHECK (provider IN ('vps', 'cloud', 'gemini'));
