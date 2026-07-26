-- Blacklist op kandidaten (meeting 17-07).
--
-- Jeroen: "Het is een kandidaat, maar we doen er niks mee — gewoon blacklist." Iemand die
-- je nooit gaat uitzenden (onbereikbaar, onbeschoft, al vertrokken) moet in de database
-- blijven staan — dat was zijn harde eis — maar mag nooit meer uit de matcher komen.
--
-- Waarom een aparte kolom en niet gewoon een status: status verandert continu mee met de
-- funnel (in_behandeling → werkzoekend → geplaatst → …). Een blacklist die aan status hangt,
-- verdwijnt bij de eerstvolgende statuswijziging. Deze markering is bewust orthogonaal: hij
-- overleeft elke status, en de toelatingspoort (MATCHABLE_CANDIDATE_STATUSES) blijft doen
-- waar hij voor is — wél/niet toegelaten in de funnel.

alter table public.candidates
  add column if not exists is_blacklisted boolean not null default false,
  add column if not exists blacklist_reason text,
  add column if not exists blacklisted_at timestamptz,
  add column if not exists blacklisted_by uuid;

comment on column public.candidates.is_blacklisted is
  'Kandidaat wordt nooit voorgesteld of gematcht. Blijft wél in de database staan. Los van status.';

-- Partieel: alleen de (kleine) blacklist zelf hoeft opzoekbaar te zijn. De pool-query in
-- rank-candidates filtert op `is_blacklisted = false`, en die selectiviteit levert een index
-- op de gehele kolom niets op.
create index if not exists idx_candidates_blacklisted
  on public.candidates (organization_id)
  where is_blacklisted;
