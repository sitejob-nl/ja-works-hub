-- Buglijst 19-08, hoofdoorzaak achter de punten 2 en 12.
--
-- De Medewerkers-lijst filtert op candidates.employee_status, maar dat veld werd
-- alleen door de plaatsingswizard gezet. Alle lopende plaatsingen bij JA Werkt zijn
-- geimporteerd (created_by is overal leeg), dus het veld bleef leeg: 1 van de 123
-- mensen met een lopende plaatsing stond als medewerker in het systeem.
--
-- Wie een lopende plaatsing heeft, werkt voor ons. Alleen lege waarden worden
-- ingevuld; een handmatig gezette status (ziek, uit_dienst, onboarding) blijft staan.
-- Terug te draaien met dezelfde voorwaarde:
--   update candidates set employee_status = null where id in (<zelfde select>);
update public.candidates c
set employee_status = 'actief'
where c.employee_status is null
  and exists (
    select 1 from public.placements p
    where p.candidate_id = c.id
      and p.organization_id = c.organization_id
      and p.status = 'actief'
  );
