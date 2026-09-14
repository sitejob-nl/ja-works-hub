-- Operational staff may remove fines; the existing active-profile policy remains.
DROP POLICY IF EXISTS tenant_delete ON public.vehicle_fines;
CREATE POLICY tenant_delete ON public.vehicle_fines FOR DELETE TO authenticated
USING (
  organization_id = (SELECT public.get_user_org_id())
  AND (SELECT public.is_internal_user())
  AND (SELECT public.get_user_role()) IN ('admin', 'backoffice', 'intercedent')
);

-- Count history on the server: intercedents may not see financial rows through RLS.
CREATE OR REPLACE FUNCTION public.get_placement_delete_impact(p_placement_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR NOT private.is_active_user()
     OR NOT public.is_internal_user()
     OR public.get_user_role()::text NOT IN ('admin', 'backoffice', 'intercedent')
     OR NOT public.has_role_permission('placements.edit') THEN
    RAISE EXCEPTION 'Je hebt geen rechten om deze plaatsing te verwijderen.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.placements WHERE id = p_placement_id AND organization_id = public.get_user_org_id()) THEN
    RAISE EXCEPTION 'Plaatsing niet gevonden of niet toegankelijk.' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'timesheets', (SELECT count(*) FROM public.timesheets WHERE placement_id = p_placement_id),
    'hourLetters', (SELECT count(*) FROM public.hour_letters WHERE placement_id = p_placement_id),
    'sickReports', (SELECT count(*) FROM public.sick_reports WHERE placement_id = p_placement_id),
    'invoiceLines', (SELECT count(*) FROM public.invoice_lines WHERE placement_id = p_placement_id),
    'hoursWeeks', (SELECT count(*) FROM public.hours_week_members WHERE placement_id = p_placement_id)
  );
END;
$$;

-- Keep direct DELETE admin-only. Other staff use this checked, atomic write path.
CREATE OR REPLACE FUNCTION public.delete_placement_record(p_placement_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_placement public.placements%rowtype;
  v_impact jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR NOT private.is_active_user()
     OR NOT public.is_internal_user()
     OR public.get_user_role()::text NOT IN ('admin', 'backoffice', 'intercedent')
     OR NOT public.has_role_permission('placements.edit') THEN
    RAISE EXCEPTION 'Je hebt geen rechten om deze plaatsing te verwijderen.' USING ERRCODE = '42501';
  END IF;
  -- Lock before counting: concurrent FK inserts must finish before the count or
  -- wait until this transaction ends. The actual delete and audit commit together.
  SELECT * INTO v_placement FROM public.placements
  WHERE id = p_placement_id AND organization_id = public.get_user_org_id()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plaatsing niet gevonden of niet toegankelijk.' USING ERRCODE = 'P0002';
  END IF;
  v_impact := public.get_placement_delete_impact(p_placement_id);
  IF EXISTS (SELECT 1 FROM jsonb_each_text(v_impact) WHERE value::bigint > 0) THEN
    RAISE EXCEPTION 'Deze plaatsing heeft gekoppelde uren, urenbrieven, ziekmeldingen of factuurregels. Beëindig de plaatsing om de historie te bewaren.' USING ERRCODE = '23503';
  END IF;
  DELETE FROM public.placements WHERE id = p_placement_id;
  INSERT INTO public.audit_log(organization_id, user_id, action, table_name, record_id, old_values, reason)
  VALUES (v_placement.organization_id, auth.uid(), 'delete', 'placements', p_placement_id,
          to_jsonb(v_placement), 'Onjuiste of testplaatsing definitief verwijderd');
  RETURN p_placement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_placement_delete_impact(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_placement_record(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_placement_delete_impact(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_placement_record(uuid) TO authenticated;
