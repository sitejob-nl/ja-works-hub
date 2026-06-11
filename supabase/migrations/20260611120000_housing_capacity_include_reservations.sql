-- UX/meeting-coverage audit 2026-06-11 (B4): overboeking-trigger dekte alleen
-- ingecheckte toewijzingen, waardoor twee intercedenten dezelfde kamer dubbel
-- konden reserveren vóór check-in. Tel nu ook 'gereserveerd' mee.
-- Geverifieerd: geen bestaande unit zit over capaciteit als reserveringen meetellen.

CREATE OR REPLACE FUNCTION public.check_unit_capacity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
declare
  current_occupancy int;
  max_capacity int;
begin
  if new.status in ('ingecheckt','gereserveerd') then
    select count(*) into current_occupancy
    from public.housing_assignments
    where unit_id = new.unit_id
      and status in ('ingecheckt','gereserveerd')
      and id != coalesce(new.id, uuid_generate_v4());

    select capacity into max_capacity
    from public.units where id = new.unit_id;

    if current_occupancy >= max_capacity then
      raise exception 'Kamer is vol. Capaciteit: %, bezetting (incl. reserveringen): %',
        max_capacity, current_occupancy;
    end if;
  end if;
  return new;
end;
$function$;
