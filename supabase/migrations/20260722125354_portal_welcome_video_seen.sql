-- De welkomstvideo hoort maar één keer getoond te worden, niet elk bezoek tot iemand hem
-- wegklikt. Wegklikken stond in localStorage en gold dus per browser: wie op zijn telefoon
-- inlogde kreeg de video opnieuw. Daarom een marker per medewerker in de database.
--
-- We bewaren de *embed*-URL, niet de ruwe instelling: plakt een beheerder later dezelfde
-- video als youtu.be- in plaats van youtube.com-link, dan is de embed-URL gelijk en blijft
-- de video terecht weg. Zet hij een échte andere video neer, dan wijkt de waarde af en
-- verschijnt die eenmalig bij iedereen.
alter table public.candidates
  add column if not exists portal_welcome_video_seen_url text;

comment on column public.candidates.portal_welcome_video_seen_url is
  'Embed-URL van de welkomstvideo die deze medewerker al in het portaal heeft gezien. Leeg = nog niet getoond. Wordt door de portaalgebruiker zelf gezet (policy candidate_self_update).';
