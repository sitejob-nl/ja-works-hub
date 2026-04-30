-- Housing — huurcontract-dates voor reminder-flow
-- Adds rental_contract_start_date + rental_contract_end_date to `properties`
-- Used by `housing-reminder-cron` edge function to flag contracts expiring within 90 days.

BEGIN;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS rental_contract_start_date date,
  ADD COLUMN IF NOT EXISTS rental_contract_end_date date,
  ADD COLUMN IF NOT EXISTS rental_contract_notes text;

CREATE INDEX IF NOT EXISTS idx_properties_rental_contract_end_date
  ON public.properties (rental_contract_end_date)
  WHERE rental_contract_end_date IS NOT NULL;

COMMIT;
