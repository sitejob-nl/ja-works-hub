-- Meeting 29-06: klantreactie "op gesprek" is een voorgestelde afspraak,
-- geen definitief kantoor-/belmoment. Houd deze enum-toevoeging los van DML.

ALTER TYPE public.match_status ADD VALUE IF NOT EXISTS 'afspraak_voorgesteld' AFTER 'voorgesteld_bij_klant';
