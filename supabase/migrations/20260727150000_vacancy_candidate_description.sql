-- Kandidaatomschrijving op de vacature (meeting 27-07).
--
-- Tot nu toe had een vacature één `description`: een korte interne notitie van de recruiter,
-- die óók in het kandidatenportaal werd getoond. Alle uitgebreide, wervende tekst zat in
-- `vacancy_seo_content` en was op de website gericht (markdown, SEO-koppen, JSON-LD).
--
-- Kandidaten krijgen nu een eigen, door AI geschreven omschrijving: platte tekst, wervend,
-- zonder markdown-tekens en zonder opdrachtgevernaam. Die tekst is wat de kandidaat ziet in
-- het portaal en wanneer hij op een vacature wordt gematcht. `description` blijft de interne
-- korte omschrijving — bewust gescheiden, zodat een recruiternotitie nooit bij de kandidaat
-- terechtkomt en een wervende tekst nooit de interne lijstweergave vervuilt.

alter table public.vacancies
  add column if not exists candidate_description text;

comment on column public.vacancies.candidate_description is
  'Wervende omschrijving voor kandidaten (portaal + match). Platte tekst zonder markdown. Gegenereerd door generate-vacancy; handmatig te bewerken.';
