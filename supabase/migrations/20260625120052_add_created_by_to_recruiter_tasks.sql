-- recruiter_tasks: maker vastleggen zodat "door mij gemaakt" te onderscheiden is van
-- "aan mij toegewezen" (assigned_to). Nullable: systeem-/AI-gegenereerde taken (cron,
-- match-response, sick-report, signup, placement-triggers) hebben geen maker.
-- Spiegelt de FK van assigned_to (-> profiles, NO ACTION).
ALTER TABLE public.recruiter_tasks
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.recruiter_tasks.created_by IS 'Profiel dat de taak aanmaakte (NULL voor systeem/AI-gegenereerde taken). Onderscheidt "door mij gemaakt" van "aan mij toegewezen" (assigned_to).';
