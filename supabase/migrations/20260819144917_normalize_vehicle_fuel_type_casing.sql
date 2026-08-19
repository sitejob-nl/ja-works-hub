-- QA-bevinding: brandstof stond deels met hoofdletter opgeslagen ("Diesel" naast
-- "diesel" en "benzine"), waardoor het bewerkformulier het veld leeg toonde — de
-- keuzelijst is kleingeschreven, dus de Select vond geen match. De UI is inmiddels
-- tolerant, maar de opgeslagen waarden zelf horen ook gelijk te zijn: de lijst toonde
-- "Diesel" naast "benzine" in dezelfde kolom.
--
-- Alleen bekende waarden worden aangeraakt; iets onverwachts blijft staan zodat het
-- opvalt in plaats van stilletjes te veranderen.
update public.vehicles
set fuel_type = lower(fuel_type)
where fuel_type is not null
  and fuel_type <> lower(fuel_type)
  and lower(fuel_type) in ('benzine', 'diesel', 'elektrisch', 'hybride', 'lpg');
