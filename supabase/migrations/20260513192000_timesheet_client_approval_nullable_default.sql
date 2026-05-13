-- Client approval is tri-state:
--   NULL  = nog te beoordelen
--   TRUE  = goedgekeurd
--   FALSE = expliciet afgekeurd
-- The previous default FALSE made new/unreviewed hours appear as rejected in the client portal.

ALTER TABLE public.timesheets
  ALTER COLUMN client_approved DROP DEFAULT;

UPDATE public.timesheets
SET client_approved = NULL
WHERE client_approved = FALSE
  AND client_approved_at IS NULL
  AND client_approved_by IS NULL
  AND client_rejection_notes IS NULL;
