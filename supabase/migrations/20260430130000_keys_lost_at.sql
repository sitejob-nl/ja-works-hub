-- Sleutel "verloren" status: nieuwe kolom lost_at
-- Een sleutel kan in 3 staten zijn:
--   uitgegeven  : returned_at IS NULL AND lost_at IS NULL
--   ingeleverd  : returned_at IS NOT NULL
--   verloren    : lost_at IS NOT NULL
-- Verloren is een eind-status; ingeleverd ook. Mutual exclusief.

ALTER TABLE public.key_registrations
  ADD COLUMN IF NOT EXISTS lost_at timestamptz;
