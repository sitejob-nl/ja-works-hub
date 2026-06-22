-- Tracer bullet (meeting 17-06): statusflow opschonen.
-- 'afspraak_op_kantoor' komt ná 'voorgesteld_bij_klant' in de match-pipeline.
-- 'in_gesprek' blijft bestaan (Postgres kan een enum-waarde niet DROPpen) maar
-- verdwijnt uit de zichtbare flow in src/lib/match-status.ts (dormant).
--
-- LET OP: een ALTER TYPE ... ADD VALUE moet committen vóór de nieuwe waarde
-- in DML/checks gebruikt wordt. Daarom staat deze ADD VALUE in een EIGEN
-- migratiebestand, zonder enig gebruik van de waarde in hetzelfde bestand.

ALTER TYPE public.match_status ADD VALUE IF NOT EXISTS 'afspraak_op_kantoor' AFTER 'voorgesteld_bij_klant';
