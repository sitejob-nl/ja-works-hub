-- Add configurable HTML signatures for Outlook sender accounts.

BEGIN;

ALTER TABLE public.mail_accounts
  ADD COLUMN IF NOT EXISTS signature_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS signature_html text NULL,
  ADD COLUMN IF NOT EXISTS signature_json jsonb NULL;

ALTER TABLE public.mail_accounts
  DROP CONSTRAINT IF EXISTS mail_accounts_signature_html_length_chk;

ALTER TABLE public.mail_accounts
  ADD CONSTRAINT mail_accounts_signature_html_length_chk
  CHECK (signature_html IS NULL OR char_length(signature_html) <= 50000);

COMMIT;
