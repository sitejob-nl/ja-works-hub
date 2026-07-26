-- Duur van de meest recente rol als slanke matcher-kolom (meeting 17-07).
--
-- Jeroen over de 97%-match: "die gast heeft dit maar één maand gedaan, dus waarschijnlijk
-- was hij er slecht in." De matcher las skills binair — één maand aluminium telde even zwaar
-- als vijf jaar. De duur zat wél in `ai_analysis.werkhistorie.werkgevers[0].duur_maanden`,
-- maar de matcher haalt die jsonb bewust niet op (te duur over de hele pool).
--
-- Zelfde patroon als most_recent_role / most_recent_role_year / drivers_license_categories:
-- `_shared/cv-write.ts` schrijft de waarde weg bij elke (her)analyse. Niet handmatig vullen.

alter table public.candidates
  add column if not exists most_recent_role_months integer;

comment on column public.candidates.most_recent_role_months is
  'Duur in maanden van de meest recente rol (ai_analysis.werkhistorie.werkgevers[0].duur_maanden). Gevuld door cv-write.ts; NULL = onbekend.';

-- Backfill voor al geanalyseerde dossiers, zodat de duur-regel meteen werkt en niet pas na
-- een herbeoordeling. Alleen waar de waarde daadwerkelijk een getal is; de rest blijft NULL
-- (= onbekend, en onbekend mag nooit als "kort" gelden).
update public.candidates c
   set most_recent_role_months = (c.ai_analysis #>> '{werkhistorie,werkgevers,0,duur_maanden}')::integer
 where c.most_recent_role_months is null
   and jsonb_typeof(c.ai_analysis #> '{werkhistorie,werkgevers,0,duur_maanden}') = 'number';
