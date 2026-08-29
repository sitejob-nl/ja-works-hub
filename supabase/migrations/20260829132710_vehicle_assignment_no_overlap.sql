-- Punt 17, opmerking Maria (28-08): "Deze oplossing gaat fouten opleveren."
--
-- Een auto reserveren werkt door een toewijzing een startdatum in de toekomst te
-- geven; tot die datum blijft de auto beschikbaar. Alleen zag je bij het toewijzen
-- vanuit de medewerker nergens dat een auto verderop al vergeven was, en niets hield
-- tegen dat er twee toewijzingen over dezelfde dagen ontstonden. Dat is geen
-- theoretisch risico: er staat er nu al een in productie (kenteken KG596V, twee
-- personen op 17 en 18 augustus).
--
-- De waarschuwing zit in het scherm; deze grendel zorgt dat het langs geen enkele
-- weg meer kan -- ook niet via de plaatsingswizard, de voertuigkant of een import.
--
-- Een bestaande botsing moet je wel kunnen rechtzetten. Daarom geldt bij een
-- wijziging alleen een botsing die er vóór die wijziging nog niet was: opruimen mag,
-- verergeren niet.

create or replace function public.enforce_vehicle_assignment_no_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_new_from date := coalesce(new.assigned_date, '-infinity'::date);
  v_new_to   date := coalesce(new.returned_date, 'infinity'::date);
  -- Bij INSERT is er geen oude periode: een leeg interval overlapt niets.
  v_old_from date := 'infinity'::date;
  v_old_to   date := '-infinity'::date;
  v_conflict record;
begin
  if new.vehicle_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old_from := coalesce(old.assigned_date, '-infinity'::date);
    v_old_to   := coalesce(old.returned_date, 'infinity'::date);
  end if;

  select va.id, va.assigned_date, va.returned_date
    into v_conflict
  from public.vehicle_assignments va
  where va.vehicle_id = new.vehicle_id
    and va.id is distinct from new.id
    and coalesce(va.assigned_date, '-infinity'::date) < v_new_to
    and v_new_from < coalesce(va.returned_date, 'infinity'::date)
    and not (
      coalesce(va.assigned_date, '-infinity'::date) < v_old_to
      and v_old_from < coalesce(va.returned_date, 'infinity'::date)
    )
  order by va.assigned_date
  limit 1;

  if found then
    raise exception 'Dit voertuig is in die periode al toegewezen (% t/m %)',
      coalesce(to_char(v_conflict.assigned_date, 'DD-MM-YYYY'), 'onbekend'),
      coalesce(to_char(v_conflict.returned_date, 'DD-MM-YYYY'), 'onbepaald')
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;

revoke all on function public.enforce_vehicle_assignment_no_overlap() from public, anon, authenticated;

drop trigger if exists vehicle_assignments_no_overlap on public.vehicle_assignments;
create trigger vehicle_assignments_no_overlap
before insert or update of vehicle_id, assigned_date, returned_date on public.vehicle_assignments
for each row execute function public.enforce_vehicle_assignment_no_overlap();

-- Twee triggers voerden dezelfde controle uit op elke insert. Onschuldig, maar het
-- is dubbel werk en het maakt de volgende lezer onzeker over welke leidend is.
drop trigger if exists check_vehicle_license on public.vehicle_assignments;
