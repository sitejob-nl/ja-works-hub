-- Keep the vehicle damage report constraint in sync with the UI damage taxonomy.
-- Old values remain allowed so historical records stay valid.
ALTER TABLE public.vehicle_damage_reports
  DROP CONSTRAINT IF EXISTS vehicle_damage_reports_damage_type_check;

ALTER TABLE public.vehicle_damage_reports
  ADD CONSTRAINT vehicle_damage_reports_damage_type_check
  CHECK (damage_type IN (
    'lekke_band',
    'dashboardlampje',
    'pech_stilstand',
    'ongeval',
    'schade_exterieur',
    'schade_interieur',
    'onderhoud',
    'overig',
    'motorstoring',
    'carrosserie',
    'ruitschade'
  ));
