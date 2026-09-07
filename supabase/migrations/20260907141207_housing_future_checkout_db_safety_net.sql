-- Databasevangnet voor een uitcheck in de toekomst (vervolg op #253).
--
-- #253 maakte uitchecken per een toekomstige datum mogelijk en liet de frontend daar
-- goed mee rekenen (`bedsOccupiedOn()` in src/lib/housing-availability.ts): een
-- 'uitgecheckt'-toewijzing bezet het bed tot de uitcheckdatum. De databasevangnetten
-- deden dat nog niet:
--
--   * check_unit_capacity() (overboekingstrigger, 20260611120000) telde alleen
--     'ingecheckt' en 'gereserveerd'. Na een uitcheck per 14-09 accepteerde de trigger
--     vandaag al een reservering met incheck 10-09 -- in #253 live bewezen met een
--     rollback-probe op de demokamer.
--   * sync_unit_status_from_assignments() (20260527173000) zette units.status meteen
--     op 'beschikbaar' zodra de rij op 'uitgecheckt' stond, ook bij een uitcheckdatum
--     in de toekomst.
--
-- Criterium (voorstel uit #253): een 'uitgecheckt'-rij telt mee zolang
-- `check_out_date > coalesce(new.check_in_date, current_date)`. Een uitcheck in het
-- verleden blokkeert dus niets, en een uitcheck op precies de nieuwe incheckdatum ook
-- niet -- dat spiegelt bedsOccupiedOn(), waar de kamer op de uitcheckdatum vrij is.
--
-- Het verstrijken van een uitcheckdatum muteert geen enkele rij, dus geen trigger kan
-- de kamer daarna vrijgeven. Daarvoor is resync_unit_statuses() + een eigen dagelijkse
-- pg_cron-job (02:15 UTC, net voor housing-reminder-daily van 02:30). Bewuste keuze
-- voor een pure SQL-job in plaats van een stap in housing-reminder-cron: het vangnet
-- moet ook overeind blijven als de edge runtime plat ligt of het cron-secret is
-- geroteerd, en heeft zo geen HTTP-hop en geen secret nodig.

-- 1. Overboekingstrigger: tel een uitcheck in de toekomst mee.
CREATE OR REPLACE FUNCTION public.check_unit_capacity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
declare
  current_occupancy int;
  max_capacity int;
  v_start date;
begin
  if new.status in ('ingecheckt','gereserveerd') then
    -- Vanaf welke dag zou deze toewijzing het bed innemen?
    v_start := coalesce(new.check_in_date, current_date);

    select count(*) into current_occupancy
    from public.housing_assignments
    where unit_id = new.unit_id
      and id is distinct from new.id
      and (
        status in ('ingecheckt','gereserveerd')
        -- Uitgecheckt, maar pas na v_start vertrokken: het bed is op v_start nog bezet.
        or (status = 'uitgecheckt' and check_out_date is not null and check_out_date > v_start)
      );

    select capacity into max_capacity
    from public.units where id = new.unit_id;

    if current_occupancy >= max_capacity then
      raise exception 'Kamer is vol op %. Capaciteit: %, bezetting (incl. reserveringen en nog niet vertrokken bewoners): %',
        to_char(v_start, 'DD-MM-YYYY'), max_capacity, current_occupancy;
    end if;
  end if;
  return new;
end;
$function$;

-- 2. Kamerstatus: blijf 'bezet' tot en met de dag voor de uitcheckdatum.
CREATE OR REPLACE FUNCTION public.sync_unit_status_from_assignments(p_unit_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $sync$
DECLARE
  v_capacity integer;
  v_current_status public.unit_status;
  v_checked_in_count integer;
  v_active_count integer;
  v_next_status public.unit_status;
BEGIN
  SELECT capacity, status
  INTO v_capacity, v_current_status
  FROM public.units
  WHERE id = p_unit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_current_status IN ('onderhoud', 'geblokkeerd') THEN
    RETURN;
  END IF;

  -- Een uitcheck in de toekomst houdt het bed vandaag nog bezet; op de uitcheckdatum
  -- zelf telt hij niet meer mee (zelfde regel als bedsOccupiedOn in de frontend).
  SELECT
    COUNT(*) FILTER (
      WHERE status = 'ingecheckt'
         OR (status = 'uitgecheckt' AND check_out_date IS NOT NULL AND check_out_date > CURRENT_DATE)
    )::integer,
    COUNT(*) FILTER (
      WHERE status IN ('ingecheckt', 'gereserveerd')
         OR (status = 'uitgecheckt' AND check_out_date IS NOT NULL AND check_out_date > CURRENT_DATE)
    )::integer
  INTO v_checked_in_count, v_active_count
  FROM public.housing_assignments
  WHERE unit_id = p_unit_id;

  IF COALESCE(v_capacity, 0) <= 0 THEN
    v_next_status := 'beschikbaar';
  ELSIF v_checked_in_count >= v_capacity THEN
    v_next_status := 'bezet';
  ELSIF v_active_count >= v_capacity THEN
    v_next_status := 'gereserveerd';
  ELSE
    v_next_status := 'beschikbaar';
  END IF;

  IF v_current_status IS DISTINCT FROM v_next_status THEN
    UPDATE public.units
    SET status = v_next_status,
        updated_at = now()
    WHERE id = p_unit_id;
  END IF;
END;
$sync$;

-- 3. Ook op een gecorrigeerde uitcheckdatum hersynchroniseren (voorheen alleen
--    unit_id en status), zodat een verzette datum de kamerstatus direct bijtrekt.
DROP TRIGGER IF EXISTS trg_sync_unit_status_from_assignments ON public.housing_assignments;
CREATE TRIGGER trg_sync_unit_status_from_assignments
  AFTER INSERT OR DELETE OR UPDATE OF unit_id, status, check_out_date
  ON public.housing_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_unit_status_from_assignments();

-- 4. Dagelijkse hersynchronisatie: het verstrijken van een uitcheckdatum raakt geen
--    rij, dus zonder deze sweep zou de kamer handmatig vrijgemaakt moeten worden.
CREATE OR REPLACE FUNCTION public.resync_unit_statuses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $resync$
DECLARE
  v_unit record;
  v_new_status public.unit_status;
  v_changed integer := 0;
BEGIN
  FOR v_unit IN
    SELECT id, status
    FROM public.units
    WHERE status NOT IN ('onderhoud', 'geblokkeerd')
  LOOP
    PERFORM public.sync_unit_status_from_assignments(v_unit.id);
    SELECT status INTO v_new_status FROM public.units WHERE id = v_unit.id;
    IF v_new_status IS DISTINCT FROM v_unit.status THEN
      v_changed := v_changed + 1;
    END IF;
  END LOOP;

  RETURN v_changed;
END;
$resync$;

-- Alleen de cron-job (postgres) draait dit; geen anon/authenticated-toegang.
REVOKE ALL ON FUNCTION public.resync_unit_statuses() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resync_unit_statuses() FROM anon, authenticated;

DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'housing-unit-status-resync-daily') THEN
      PERFORM cron.unschedule('housing-unit-status-resync-daily');
    END IF;
    PERFORM cron.schedule(
      'housing-unit-status-resync-daily',
      '15 2 * * *',
      $cron$SELECT public.resync_unit_statuses();$cron$
    );
  END IF;
END
$mig$;

-- Eenmalig meteen gelijktrekken met de nieuwe regel.
SELECT public.resync_unit_statuses();
