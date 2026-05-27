-- Keep unit.status in sync with active housing assignments.
-- Manual blocking statuses (onderhoud/geblokkeerd) are preserved.

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_unit_status_from_assignments(p_unit_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT
    COUNT(*) FILTER (WHERE status = 'ingecheckt')::integer,
    COUNT(*) FILTER (WHERE status IN ('ingecheckt', 'gereserveerd'))::integer
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
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_unit_status_from_assignments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_unit_status_from_assignments(OLD.unit_id);
    RETURN OLD;
  END IF;

  PERFORM public.sync_unit_status_from_assignments(NEW.unit_id);

  IF TG_OP = 'UPDATE' AND OLD.unit_id IS DISTINCT FROM NEW.unit_id THEN
    PERFORM public.sync_unit_status_from_assignments(OLD.unit_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_unit_status_from_assignments ON public.housing_assignments;
CREATE TRIGGER trg_sync_unit_status_from_assignments
  AFTER INSERT OR DELETE OR UPDATE OF unit_id, status
  ON public.housing_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_unit_status_from_assignments();

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.units
    WHERE status NOT IN ('onderhoud', 'geblokkeerd')
  LOOP
    PERFORM public.sync_unit_status_from_assignments(r.id);
  END LOOP;
END;
$$;

COMMIT;
