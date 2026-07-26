-- Facility is an operational role with a deliberately fixed, narrow surface.
-- It is intentionally NOT part of is_internal_user(): broad internal policies
-- include recruitment, finance and full-row PII that Facility must never see.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'facility';

ALTER TABLE public.internal_user_invites
  DROP CONSTRAINT IF EXISTS internal_user_invites_internal_role;

ALTER TABLE public.internal_user_invites
  ADD CONSTRAINT internal_user_invites_internal_role
  CHECK (
    role::text = ANY (
      ARRAY['admin', 'intercedent', 'backoffice', 'finance', 'facility']::text[]
    )
  );

CREATE OR REPLACE FUNCTION public.facility_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.organization_id
  FROM public.profiles AS p
  WHERE p.id = auth.uid()
    AND p.role::text = 'facility'
    AND p.is_active = true
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_facility_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.facility_org_id() IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.facility_org_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_facility_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_org_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_facility_user() TO authenticated, service_role;

-- Preserve the current per-user override precedence for existing configurable
-- roles. Facility always fails closed before any user/org override is read.
CREATE OR REPLACE FUNCTION public.has_role_permission(p_permission text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_role text;
  v_override boolean;
  v_permissions jsonb;
  v_defaults jsonb;
BEGIN
  v_user_id := auth.uid();
  v_org_id := public.get_user_org_id();
  v_role := public.get_user_role()::text;

  IF v_user_id IS NULL OR v_org_id IS NULL OR v_role IS NULL OR NULLIF(p_permission, '') IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'admin' THEN RETURN true; END IF;
  IF v_role = 'facility' THEN RETURN false; END IF;
  IF v_role NOT IN ('intercedent', 'backoffice', 'finance') THEN RETURN false; END IF;

  SELECT allowed
    INTO v_override
    FROM public.user_permission_overrides
   WHERE organization_id = v_org_id
     AND user_id = v_user_id
     AND permission_key = p_permission;
  IF FOUND THEN
    RETURN v_override;
  END IF;

  v_defaults := public.role_permission_defaults(v_role);
  SELECT settings->'role_permissions'->v_role
    INTO v_permissions
    FROM public.organizations
   WHERE id = v_org_id;

  IF jsonb_typeof(v_permissions) = 'array' THEN
    RETURN v_permissions ? p_permission;
  END IF;
  IF jsonb_typeof(v_permissions) = 'object'
     AND jsonb_typeof(v_permissions->p_permission) = 'boolean' THEN
    RETURN (v_permissions->>p_permission)::boolean;
  END IF;

  RETURN COALESCE((v_defaults->>p_permission)::boolean, false);
END;
$function$;

-- Narrow shell context: branding is allowlisted instead of exposing the full
-- organizations.settings object (which contains module and role configuration).
CREATE OR REPLACE FUNCTION public.facility_shell_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid := public.facility_org_id();
  v_result jsonb;
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'facility access required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'logo_url', o.logo_url,
    'branding', jsonb_strip_nulls(jsonb_build_object(
      'accent_color', o.settings->>'accent_color',
      'sidebar_bg', o.settings->>'sidebar_bg',
      'sidebar_fg', o.settings->>'sidebar_fg',
      'sidebar_fg_active', o.settings->>'sidebar_fg_active',
      'background', o.settings->>'background',
      'card', o.settings->>'card',
      'heading', o.settings->>'heading',
      'border_radius', o.settings->>'border_radius'
    ))
  )
  INTO v_result
  FROM public.organizations AS o
  WHERE o.id = v_org_id;

  RETURN v_result;
END;
$$;

-- Minimal identity projection. No email, phone, address, birth data, document
-- fields, notes, payroll, insurance or banking columns are returned.
CREATE OR REPLACE FUNCTION public.facility_worker_directory()
RETURNS TABLE (
  candidate_id uuid,
  employee_id uuid,
  first_name text,
  last_name text,
  employee_number text,
  employee_status text,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid := public.facility_org_id();
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'facility access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    e.id,
    c.first_name,
    c.last_name,
    COALESCE(c.employee_number, e.employee_number),
    COALESCE(c.employee_status, e.status::text),
    e.status::text
  FROM public.employees AS e
  JOIN public.candidates AS c
    ON c.id = e.candidate_id
   AND c.organization_id = e.organization_id
  WHERE e.organization_id = v_org_id
    AND c.anonymized_at IS NULL
  ORDER BY c.first_name, c.last_name, c.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.facility_profile_directory()
RETURNS TABLE (id uuid, full_name text, role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid := public.facility_org_id();
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'facility access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.id, p.full_name, p.role::text
  FROM public.profiles AS p
  WHERE p.organization_id = v_org_id
    AND p.is_active = true
    AND p.role::text IN ('admin', 'intercedent', 'backoffice', 'facility')
  ORDER BY p.full_name NULLS LAST, p.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.facility_housing_snapshot(p_property_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid := public.facility_org_id();
  v_result jsonb;
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'facility access required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'properties', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', p.id,
        'organization_id', p.organization_id,
        'name', p.name,
        'address_street', p.address_street,
        'address_postal', p.address_postal,
        'address_city', p.address_city,
        'address_lat', p.address_lat,
        'address_lng', p.address_lng,
        'total_capacity', p.total_capacity,
        'is_active', p.is_active,
        'has_rental_permit', p.has_rental_permit,
        'max_persons_permit', p.max_persons_permit,
        'rental_permit_number', p.rental_permit_number,
        'rental_permit_expiry', p.rental_permit_expiry,
        'has_snf_certificate', p.has_snf_certificate,
        'snf_certificate_number', p.snf_certificate_number,
        'snf_certificate_expiry', p.snf_certificate_expiry,
        'ownership_type', p.ownership_type,
        'created_at', p.created_at,
        'updated_at', p.updated_at
      )) ORDER BY p.name NULLS LAST, p.address_city, p.id)
      FROM public.properties AS p
      WHERE p.organization_id = v_org_id
        AND (p_property_id IS NULL OR p.id = p_property_id)
    ), '[]'::jsonb),
    'units', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', u.id,
        'organization_id', u.organization_id,
        'property_id', u.property_id,
        'name', u.name,
        'capacity', u.capacity,
        'status', u.status::text,
        'floor', u.floor,
        'created_at', u.created_at,
        'updated_at', u.updated_at
      )) ORDER BY u.property_id, u.name, u.id)
      FROM public.units AS u
      WHERE u.organization_id = v_org_id
        AND (p_property_id IS NULL OR u.property_id = p_property_id)
    ), '[]'::jsonb),
    'housing_assignments', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', a.id,
        'organization_id', a.organization_id,
        'unit_id', a.unit_id,
        'employee_id', a.employee_id,
        'candidate_id', a.candidate_id,
        'check_in_date', a.check_in_date,
        'check_out_date', a.check_out_date,
        'status', a.status::text,
        'created_at', a.created_at,
        'updated_at', a.updated_at
      )) ORDER BY a.check_in_date DESC, a.id)
      FROM public.housing_assignments AS a
      JOIN public.units AS u ON u.id = a.unit_id AND u.organization_id = a.organization_id
      WHERE a.organization_id = v_org_id
        AND (p_property_id IS NULL OR u.property_id = p_property_id)
    ), '[]'::jsonb),
    'cleaning_tasks', COALESCE((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC, t.id)
      FROM public.housing_cleaning_tasks AS t
      WHERE t.organization_id = v_org_id
        AND (p_property_id IS NULL OR t.property_id = p_property_id)
    ), '[]'::jsonb),
    'inspections', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', i.id,
        'organization_id', i.organization_id,
        'property_id', i.property_id,
        'unit_id', i.unit_id,
        'housing_assignment_id', i.housing_assignment_id,
        'inspection_date', i.inspection_date,
        'description', i.description,
        'inspection_type', i.inspection_type::text,
        'condition_rating', i.condition_rating,
        'photos', i.photos,
        'photo_mattress', i.photo_mattress,
        'photo_room_overview', i.photo_room_overview,
        'photo_bathroom', i.photo_bathroom,
        'photo_kitchen', i.photo_kitchen,
        'photo_damage', i.photo_damage,
        'resolved', i.resolved,
        'resolved_at', i.resolved_at,
        'confirmed_by_resident', i.confirmed_by_resident,
        'confirmed_at', i.confirmed_at,
        'created_at', i.created_at
      )) ORDER BY i.inspection_date DESC, i.id)
      FROM public.housing_inspections AS i
      WHERE i.organization_id = v_org_id
        AND (p_property_id IS NULL OR i.property_id = p_property_id)
    ), '[]'::jsonb),
    'key_registrations', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', k.id,
        'organization_id', k.organization_id,
        'unit_id', k.unit_id,
        'employee_id', k.employee_id,
        'candidate_id', k.candidate_id,
        'key_number', k.key_number,
        'issued_at', k.issued_at,
        'returned_at', k.returned_at,
        'lost_at', k.lost_at
      )) ORDER BY k.issued_at DESC, k.id)
      FROM public.key_registrations AS k
      JOIN public.units AS u ON u.id = k.unit_id AND u.organization_id = k.organization_id
      WHERE k.organization_id = v_org_id
        AND (p_property_id IS NULL OR u.property_id = p_property_id)
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.facility_transport_snapshot(p_vehicle_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid := public.facility_org_id();
  v_result jsonb;
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'facility access required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'vehicles', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', v.id,
        'organization_id', v.organization_id,
        'license_plate', v.license_plate,
        'brand', v.brand,
        'model', v.model,
        'year', v.year,
        'status', v.status::text,
        'fuel_type', v.fuel_type,
        'current_mileage', v.current_mileage,
        'tank_capacity_liters', v.tank_capacity_liters,
        'color', v.color,
        'seats', v.seats,
        'weight', v.weight,
        'apk_expiry', v.apk_expiry,
        'first_registration', v.first_registration,
        'first_registration_nl', v.first_registration_nl,
        'doors', v.doors,
        'created_at', v.created_at,
        'updated_at', v.updated_at
      )) ORDER BY v.license_plate, v.id)
      FROM public.vehicles AS v
      WHERE v.organization_id = v_org_id
        AND (p_vehicle_id IS NULL OR v.id = p_vehicle_id)
    ), '[]'::jsonb),
    'assignments', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', a.id,
        'organization_id', a.organization_id,
        'vehicle_id', a.vehicle_id,
        'employee_id', a.employee_id,
        'candidate_id', a.candidate_id,
        'assigned_date', a.assigned_date,
        'returned_date', a.returned_date,
        'start_mileage', a.start_mileage,
        'end_mileage', a.end_mileage,
        'created_at', a.created_at
      )) ORDER BY a.assigned_date DESC, a.id)
      FROM public.vehicle_assignments AS a
      WHERE a.organization_id = v_org_id
        AND (p_vehicle_id IS NULL OR a.vehicle_id = p_vehicle_id)
    ), '[]'::jsonb),
    'damage_reports', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', d.id,
        'organization_id', d.organization_id,
        'vehicle_id', d.vehicle_id,
        'employee_id', d.employee_id,
        'candidate_id', d.candidate_id,
        'reported_at', d.reported_at,
        'damage_type', d.damage_type,
        'photos', d.photos,
        'resolved', d.resolved,
        'resolved_at', d.resolved_at,
        'contact_route', d.contact_route,
        'route_status', d.route_status,
        'urgency', d.urgency,
        'contact_phone_shared', d.contact_phone_shared,
        'created_at', d.created_at,
        'updated_at', d.updated_at
      )) ORDER BY d.reported_at DESC, d.id)
      FROM public.vehicle_damage_reports AS d
      WHERE d.organization_id = v_org_id
        AND (p_vehicle_id IS NULL OR d.vehicle_id = p_vehicle_id)
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.facility_shell_context() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.facility_worker_directory() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.facility_profile_directory() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.facility_housing_snapshot(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.facility_transport_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_shell_context() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.facility_worker_directory() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.facility_profile_directory() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.facility_housing_snapshot(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.facility_transport_snapshot(uuid) TO authenticated, service_role;

-- Boolean reference checks let row policies validate tenant-local foreign keys
-- without granting Facility SELECT on the referenced full rows.
CREATE OR REPLACE FUNCTION public.facility_reference_is_in_org(p_kind text, p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid := public.facility_org_id();
  v_allowed boolean := false;
BEGIN
  IF v_org_id IS NULL OR p_id IS NULL THEN
    RETURN false;
  END IF;

  CASE p_kind
    WHEN 'profile' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = p_id AND p.organization_id = v_org_id AND p.is_active = true
      ) INTO v_allowed;
    WHEN 'candidate' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.candidates c
        WHERE c.id = p_id AND c.organization_id = v_org_id AND c.anonymized_at IS NULL
      ) INTO v_allowed;
    WHEN 'employee' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = p_id AND e.organization_id = v_org_id
      ) INTO v_allowed;
    WHEN 'property' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.properties p
        WHERE p.id = p_id AND p.organization_id = v_org_id
      ) INTO v_allowed;
    WHEN 'unit' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.units u
        WHERE u.id = p_id AND u.organization_id = v_org_id
      ) INTO v_allowed;
    WHEN 'housing_assignment' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.housing_assignments a
        WHERE a.id = p_id AND a.organization_id = v_org_id
      ) INTO v_allowed;
    WHEN 'vehicle' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.vehicles v
        WHERE v.id = p_id AND v.organization_id = v_org_id
      ) INTO v_allowed;
    WHEN 'task' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.recruiter_tasks t
        WHERE t.id = p_id
          AND t.organization_id = v_org_id
          AND t.assigned_to = auth.uid()
          AND t.related_entity_type IN ('property', 'huis', 'unit', 'vehicle', 'auto')
      ) INTO v_allowed;
    ELSE
      v_allowed := false;
  END CASE;

  RETURN v_allowed;
END;
$$;

CREATE OR REPLACE FUNCTION public.facility_employee_candidate_matches(
  p_employee_id uuid,
  p_candidate_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_candidate_id IS NULL OR EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = p_employee_id
      AND e.candidate_id = p_candidate_id
      AND e.organization_id = public.facility_org_id()
  )
$$;

REVOKE ALL ON FUNCTION public.facility_reference_is_in_org(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.facility_employee_candidate_matches(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_reference_is_in_org(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.facility_employee_candidate_matches(uuid, uuid) TO authenticated, service_role;

-- A single allowlisted write RPC is used for tables whose full rows contain
-- protected columns. Each branch names every writable column explicitly.
CREATE OR REPLACE FUNCTION public.facility_save_operational_entity(
  p_entity text,
  p_values jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid := public.facility_org_id();
  v_id uuid;
  v_is_update boolean;
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'facility access required' USING ERRCODE = '42501';
  END IF;
  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'values must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF p_values ? 'organization_id'
     AND NULLIF(p_values->>'organization_id', '')::uuid IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'cross-organization write denied' USING ERRCODE = '42501';
  END IF;

  v_id := NULLIF(p_values->>'id', '')::uuid;
  v_is_update := v_id IS NOT NULL;

  IF p_entity = 'property' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_values) AS k
      WHERE k NOT IN (
        'id', 'organization_id', 'name', 'address_street', 'address_postal',
        'address_city', 'address_lat', 'address_lng', 'total_capacity',
        'is_active', 'has_rental_permit', 'max_persons_permit',
        'rental_permit_number', 'rental_permit_expiry', 'has_snf_certificate',
        'snf_certificate_number', 'snf_certificate_expiry', 'ownership_type'
      )
    ) THEN
      RAISE EXCEPTION 'property contains a protected or unknown field' USING ERRCODE = '42501';
    END IF;

    IF v_id IS NULL THEN
      v_id := gen_random_uuid();
      INSERT INTO public.properties (
        id, organization_id, name, address_street, address_postal, address_city,
        address_lat, address_lng, total_capacity, is_active,
        has_rental_permit, max_persons_permit, rental_permit_number,
        rental_permit_expiry, has_snf_certificate, snf_certificate_number,
        snf_certificate_expiry, ownership_type
      ) VALUES (
        v_id, v_org_id, NULLIF(p_values->>'name', ''),
        p_values->>'address_street', p_values->>'address_postal', p_values->>'address_city',
        NULLIF(p_values->>'address_lat', '')::numeric,
        NULLIF(p_values->>'address_lng', '')::numeric,
        COALESCE(NULLIF(p_values->>'total_capacity', '')::integer, 0),
        COALESCE((p_values->>'is_active')::boolean, true),
        NULLIF(p_values->>'has_rental_permit', '')::boolean,
        NULLIF(p_values->>'max_persons_permit', '')::integer,
        NULLIF(p_values->>'rental_permit_number', ''),
        NULLIF(p_values->>'rental_permit_expiry', '')::date,
        NULLIF(p_values->>'has_snf_certificate', '')::boolean,
        NULLIF(p_values->>'snf_certificate_number', ''),
        NULLIF(p_values->>'snf_certificate_expiry', '')::date,
        COALESCE(NULLIF(p_values->>'ownership_type', ''), 'huur')
      );
    ELSE
      UPDATE public.properties AS p SET
        name = CASE WHEN p_values ? 'name' THEN NULLIF(p_values->>'name', '') ELSE p.name END,
        address_street = CASE WHEN p_values ? 'address_street' THEN p_values->>'address_street' ELSE p.address_street END,
        address_postal = CASE WHEN p_values ? 'address_postal' THEN p_values->>'address_postal' ELSE p.address_postal END,
        address_city = CASE WHEN p_values ? 'address_city' THEN p_values->>'address_city' ELSE p.address_city END,
        address_lat = CASE WHEN p_values ? 'address_lat' THEN NULLIF(p_values->>'address_lat', '')::numeric ELSE p.address_lat END,
        address_lng = CASE WHEN p_values ? 'address_lng' THEN NULLIF(p_values->>'address_lng', '')::numeric ELSE p.address_lng END,
        total_capacity = CASE WHEN p_values ? 'total_capacity' THEN (p_values->>'total_capacity')::integer ELSE p.total_capacity END,
        is_active = CASE WHEN p_values ? 'is_active' THEN (p_values->>'is_active')::boolean ELSE p.is_active END,
        has_rental_permit = CASE WHEN p_values ? 'has_rental_permit' THEN NULLIF(p_values->>'has_rental_permit', '')::boolean ELSE p.has_rental_permit END,
        max_persons_permit = CASE WHEN p_values ? 'max_persons_permit' THEN NULLIF(p_values->>'max_persons_permit', '')::integer ELSE p.max_persons_permit END,
        rental_permit_number = CASE WHEN p_values ? 'rental_permit_number' THEN NULLIF(p_values->>'rental_permit_number', '') ELSE p.rental_permit_number END,
        rental_permit_expiry = CASE WHEN p_values ? 'rental_permit_expiry' THEN NULLIF(p_values->>'rental_permit_expiry', '')::date ELSE p.rental_permit_expiry END,
        has_snf_certificate = CASE WHEN p_values ? 'has_snf_certificate' THEN NULLIF(p_values->>'has_snf_certificate', '')::boolean ELSE p.has_snf_certificate END,
        snf_certificate_number = CASE WHEN p_values ? 'snf_certificate_number' THEN NULLIF(p_values->>'snf_certificate_number', '') ELSE p.snf_certificate_number END,
        snf_certificate_expiry = CASE WHEN p_values ? 'snf_certificate_expiry' THEN NULLIF(p_values->>'snf_certificate_expiry', '')::date ELSE p.snf_certificate_expiry END,
        ownership_type = CASE WHEN p_values ? 'ownership_type' THEN NULLIF(p_values->>'ownership_type', '') ELSE p.ownership_type END,
        updated_at = now()
      WHERE p.id = v_id AND p.organization_id = v_org_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'property not found' USING ERRCODE = 'P0002'; END IF;
    END IF;

  ELSIF p_entity = 'unit' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_values) AS k
      WHERE k NOT IN ('id', 'organization_id', 'property_id', 'name', 'capacity', 'status', 'floor')
    ) THEN
      RAISE EXCEPTION 'unit contains a protected or unknown field' USING ERRCODE = '42501';
    END IF;

    IF v_id IS NULL THEN
      v_id := gen_random_uuid();
      INSERT INTO public.units (id, organization_id, property_id, name, capacity, status, floor)
      SELECT v_id, v_org_id, (p_values->>'property_id')::uuid, p_values->>'name',
        COALESCE(NULLIF(p_values->>'capacity', '')::integer, 1),
        COALESCE(NULLIF(p_values->>'status', '')::public.unit_status, 'beschikbaar'::public.unit_status),
        NULLIF(p_values->>'floor', '')::integer
      WHERE EXISTS (
        SELECT 1 FROM public.properties p
        WHERE p.id = (p_values->>'property_id')::uuid AND p.organization_id = v_org_id
      );
      IF NOT FOUND THEN RAISE EXCEPTION 'property not found' USING ERRCODE = 'P0002'; END IF;
    ELSE
      UPDATE public.units AS u SET
        property_id = CASE WHEN p_values ? 'property_id' THEN (p_values->>'property_id')::uuid ELSE u.property_id END,
        name = CASE WHEN p_values ? 'name' THEN p_values->>'name' ELSE u.name END,
        capacity = CASE WHEN p_values ? 'capacity' THEN (p_values->>'capacity')::integer ELSE u.capacity END,
        status = CASE WHEN p_values ? 'status' THEN (p_values->>'status')::public.unit_status ELSE u.status END,
        floor = CASE WHEN p_values ? 'floor' THEN NULLIF(p_values->>'floor', '')::integer ELSE u.floor END,
        updated_at = now()
      WHERE u.id = v_id
        AND u.organization_id = v_org_id
        AND EXISTS (
          SELECT 1 FROM public.properties p
          WHERE p.id = CASE WHEN p_values ? 'property_id' THEN (p_values->>'property_id')::uuid ELSE u.property_id END
            AND p.organization_id = v_org_id
        );
      IF NOT FOUND THEN RAISE EXCEPTION 'unit not found' USING ERRCODE = 'P0002'; END IF;
    END IF;

  ELSIF p_entity = 'housing_assignment' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_values) AS k
      WHERE k NOT IN (
        'id', 'organization_id', 'unit_id', 'employee_id', 'candidate_id',
        'check_in_date', 'check_out_date', 'status'
      )
    ) THEN
      RAISE EXCEPTION 'housing assignment contains a protected or unknown field' USING ERRCODE = '42501';
    END IF;

    IF v_id IS NULL THEN
      v_id := gen_random_uuid();
      INSERT INTO public.housing_assignments (
        id, organization_id, unit_id, employee_id, candidate_id,
        check_in_date, check_out_date, status
      )
      SELECT v_id, v_org_id, (p_values->>'unit_id')::uuid, e.id,
        e.candidate_id,
        (p_values->>'check_in_date')::date, NULLIF(p_values->>'check_out_date', '')::date,
        COALESCE(NULLIF(p_values->>'status', '')::public.housing_assignment_status, 'gereserveerd'::public.housing_assignment_status)
      FROM public.employees e
      WHERE e.id = (p_values->>'employee_id')::uuid
        AND e.organization_id = v_org_id
        AND EXISTS (
        SELECT 1 FROM public.units u WHERE u.id = (p_values->>'unit_id')::uuid AND u.organization_id = v_org_id
      );
      IF NOT FOUND THEN RAISE EXCEPTION 'unit or employee not found' USING ERRCODE = 'P0002'; END IF;
    ELSE
      UPDATE public.housing_assignments AS a SET
        unit_id = CASE WHEN p_values ? 'unit_id' THEN (p_values->>'unit_id')::uuid ELSE a.unit_id END,
        employee_id = CASE WHEN p_values ? 'employee_id' THEN (p_values->>'employee_id')::uuid ELSE a.employee_id END,
        candidate_id = (
          SELECT e.candidate_id FROM public.employees e
          WHERE e.id = CASE WHEN p_values ? 'employee_id' THEN (p_values->>'employee_id')::uuid ELSE a.employee_id END
            AND e.organization_id = v_org_id
        ),
        check_in_date = CASE WHEN p_values ? 'check_in_date' THEN (p_values->>'check_in_date')::date ELSE a.check_in_date END,
        check_out_date = CASE WHEN p_values ? 'check_out_date' THEN NULLIF(p_values->>'check_out_date', '')::date ELSE a.check_out_date END,
        status = CASE WHEN p_values ? 'status' THEN (p_values->>'status')::public.housing_assignment_status ELSE a.status END,
        updated_at = now()
      WHERE a.id = v_id
        AND a.organization_id = v_org_id
        AND EXISTS (
          SELECT 1 FROM public.units u
          WHERE u.id = CASE WHEN p_values ? 'unit_id' THEN (p_values->>'unit_id')::uuid ELSE a.unit_id END
            AND u.organization_id = v_org_id
        )
        AND EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.id = CASE WHEN p_values ? 'employee_id' THEN (p_values->>'employee_id')::uuid ELSE a.employee_id END
            AND e.organization_id = v_org_id
        );
      IF NOT FOUND THEN RAISE EXCEPTION 'housing assignment not found' USING ERRCODE = 'P0002'; END IF;
    END IF;

  ELSIF p_entity = 'vehicle' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_values) AS k
      WHERE k NOT IN (
        'id', 'organization_id', 'license_plate', 'brand', 'model', 'year',
        'status', 'fuel_type', 'current_mileage', 'tank_capacity_liters',
        'color', 'seats', 'weight', 'apk_expiry', 'first_registration',
        'first_registration_nl', 'doors'
      )
    ) THEN
      RAISE EXCEPTION 'vehicle contains a protected or unknown field' USING ERRCODE = '42501';
    END IF;

    IF v_id IS NULL THEN
      v_id := gen_random_uuid();
      INSERT INTO public.vehicles (
        id, organization_id, license_plate, brand, model, year, status, fuel_type,
        current_mileage, tank_capacity_liters, color, seats, weight,
        apk_expiry, first_registration, first_registration_nl, doors
      ) VALUES (
        v_id, v_org_id, upper(p_values->>'license_plate'), NULLIF(p_values->>'brand', ''),
        NULLIF(p_values->>'model', ''), NULLIF(p_values->>'year', '')::integer,
        COALESCE(NULLIF(p_values->>'status', '')::public.vehicle_status, 'beschikbaar'::public.vehicle_status),
        NULLIF(p_values->>'fuel_type', ''), NULLIF(p_values->>'current_mileage', '')::integer,
        NULLIF(p_values->>'tank_capacity_liters', '')::numeric,
        NULLIF(p_values->>'color', ''), NULLIF(p_values->>'seats', '')::integer,
        NULLIF(p_values->>'weight', '')::integer, NULLIF(p_values->>'apk_expiry', ''),
        NULLIF(p_values->>'first_registration', ''), NULLIF(p_values->>'first_registration_nl', ''),
        NULLIF(p_values->>'doors', '')::integer
      );
    ELSE
      UPDATE public.vehicles AS v SET
        license_plate = CASE WHEN p_values ? 'license_plate' THEN upper(p_values->>'license_plate') ELSE v.license_plate END,
        brand = CASE WHEN p_values ? 'brand' THEN NULLIF(p_values->>'brand', '') ELSE v.brand END,
        model = CASE WHEN p_values ? 'model' THEN NULLIF(p_values->>'model', '') ELSE v.model END,
        year = CASE WHEN p_values ? 'year' THEN NULLIF(p_values->>'year', '')::integer ELSE v.year END,
        status = CASE WHEN p_values ? 'status' THEN (p_values->>'status')::public.vehicle_status ELSE v.status END,
        fuel_type = CASE WHEN p_values ? 'fuel_type' THEN NULLIF(p_values->>'fuel_type', '') ELSE v.fuel_type END,
        current_mileage = CASE WHEN p_values ? 'current_mileage' THEN NULLIF(p_values->>'current_mileage', '')::integer ELSE v.current_mileage END,
        tank_capacity_liters = CASE WHEN p_values ? 'tank_capacity_liters' THEN NULLIF(p_values->>'tank_capacity_liters', '')::numeric ELSE v.tank_capacity_liters END,
        color = CASE WHEN p_values ? 'color' THEN NULLIF(p_values->>'color', '') ELSE v.color END,
        seats = CASE WHEN p_values ? 'seats' THEN NULLIF(p_values->>'seats', '')::integer ELSE v.seats END,
        weight = CASE WHEN p_values ? 'weight' THEN NULLIF(p_values->>'weight', '')::integer ELSE v.weight END,
        apk_expiry = CASE WHEN p_values ? 'apk_expiry' THEN NULLIF(p_values->>'apk_expiry', '') ELSE v.apk_expiry END,
        first_registration = CASE WHEN p_values ? 'first_registration' THEN NULLIF(p_values->>'first_registration', '') ELSE v.first_registration END,
        first_registration_nl = CASE WHEN p_values ? 'first_registration_nl' THEN NULLIF(p_values->>'first_registration_nl', '') ELSE v.first_registration_nl END,
        doors = CASE WHEN p_values ? 'doors' THEN NULLIF(p_values->>'doors', '')::integer ELSE v.doors END,
        updated_at = now()
      WHERE v.id = v_id AND v.organization_id = v_org_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'vehicle not found' USING ERRCODE = 'P0002'; END IF;
    END IF;

  ELSIF p_entity = 'vehicle_damage_report' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_values) AS k
      WHERE k NOT IN (
        'id', 'organization_id', 'vehicle_id', 'employee_id', 'candidate_id',
        'reported_at', 'damage_type', 'description', 'photos', 'resolved',
        'resolved_at', 'urgency'
      )
    ) THEN
      RAISE EXCEPTION 'damage report contains a protected or unknown field' USING ERRCODE = '42501';
    END IF;

    IF v_id IS NULL THEN
      v_id := gen_random_uuid();
      INSERT INTO public.vehicle_damage_reports (
        id, organization_id, vehicle_id, employee_id, candidate_id, reported_at,
        damage_type, description, photos, resolved, resolved_at, urgency
      )
      SELECT v_id, v_org_id, (p_values->>'vehicle_id')::uuid, e.id,
        e.candidate_id,
        COALESCE(NULLIF(p_values->>'reported_at', '')::timestamptz, now()),
        p_values->>'damage_type', NULLIF(p_values->>'description', ''),
        CASE WHEN p_values ? 'photos' AND p_values->'photos' <> 'null'::jsonb
          THEN ARRAY(SELECT jsonb_array_elements_text(p_values->'photos')) ELSE NULL END,
        COALESCE((p_values->>'resolved')::boolean, false),
        NULLIF(p_values->>'resolved_at', '')::timestamptz,
        COALESCE(NULLIF(p_values->>'urgency', ''), 'normal')
      FROM public.employees e
      WHERE e.id = (p_values->>'employee_id')::uuid
        AND e.organization_id = v_org_id
        AND EXISTS (
        SELECT 1 FROM public.vehicles v WHERE v.id = (p_values->>'vehicle_id')::uuid AND v.organization_id = v_org_id
      );
      IF NOT FOUND THEN RAISE EXCEPTION 'vehicle or employee not found' USING ERRCODE = 'P0002'; END IF;
    ELSE
      UPDATE public.vehicle_damage_reports AS d SET
        vehicle_id = CASE WHEN p_values ? 'vehicle_id' THEN (p_values->>'vehicle_id')::uuid ELSE d.vehicle_id END,
        employee_id = CASE WHEN p_values ? 'employee_id' THEN (p_values->>'employee_id')::uuid ELSE d.employee_id END,
        candidate_id = (
          SELECT e.candidate_id FROM public.employees e
          WHERE e.id = CASE WHEN p_values ? 'employee_id' THEN (p_values->>'employee_id')::uuid ELSE d.employee_id END
            AND e.organization_id = v_org_id
        ),
        reported_at = CASE WHEN p_values ? 'reported_at' THEN (p_values->>'reported_at')::timestamptz ELSE d.reported_at END,
        damage_type = CASE WHEN p_values ? 'damage_type' THEN p_values->>'damage_type' ELSE d.damage_type END,
        description = CASE WHEN p_values ? 'description' THEN NULLIF(p_values->>'description', '') ELSE d.description END,
        photos = CASE WHEN p_values ? 'photos' THEN
          CASE WHEN p_values->'photos' = 'null'::jsonb THEN NULL
            ELSE ARRAY(SELECT jsonb_array_elements_text(p_values->'photos')) END
          ELSE d.photos END,
        resolved = CASE WHEN p_values ? 'resolved' THEN (p_values->>'resolved')::boolean ELSE d.resolved END,
        resolved_at = CASE WHEN p_values ? 'resolved_at' THEN NULLIF(p_values->>'resolved_at', '')::timestamptz ELSE d.resolved_at END,
        urgency = CASE WHEN p_values ? 'urgency' THEN NULLIF(p_values->>'urgency', '') ELSE d.urgency END,
        updated_at = now()
      WHERE d.id = v_id
        AND d.organization_id = v_org_id
        AND EXISTS (
          SELECT 1 FROM public.vehicles v
          WHERE v.id = CASE WHEN p_values ? 'vehicle_id' THEN (p_values->>'vehicle_id')::uuid ELSE d.vehicle_id END
            AND v.organization_id = v_org_id
        )
        AND EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.id = CASE WHEN p_values ? 'employee_id' THEN (p_values->>'employee_id')::uuid ELSE d.employee_id END
            AND e.organization_id = v_org_id
        );
      IF NOT FOUND THEN RAISE EXCEPTION 'damage report not found' USING ERRCODE = 'P0002'; END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported facility entity' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_log (
    organization_id, user_id, action, table_name, record_id, new_values, reason
  ) VALUES (
    v_org_id,
    auth.uid(),
    CASE WHEN v_is_update THEN 'update'::public.audit_action ELSE 'create'::public.audit_action END,
    CASE p_entity
      WHEN 'property' THEN 'properties'
      WHEN 'unit' THEN 'units'
      WHEN 'housing_assignment' THEN 'housing_assignments'
      WHEN 'vehicle' THEN 'vehicles'
      WHEN 'vehicle_damage_report' THEN 'vehicle_damage_reports'
    END,
    v_id,
    jsonb_build_object(
      'facility_entity', p_entity,
      'changed_fields', (
        SELECT COALESCE(jsonb_agg(fields.key ORDER BY fields.key), '[]'::jsonb)
        FROM jsonb_object_keys(p_values) AS fields(key)
      )
    ),
    'facility_operational_rpc'
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.facility_save_operational_entity(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_save_operational_entity(text, jsonb) TO authenticated, service_role;

-- Facility may only resolve or reopen an inspection. Content, condition and
-- photo evidence remain immutable after insert; resolved_at is server-chosen.
CREATE OR REPLACE FUNCTION public.facility_update_inspection(
  p_inspection_id uuid,
  p_values jsonb
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid := public.facility_org_id();
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'facility access required' USING ERRCODE = '42501';
  END IF;
  IF p_inspection_id IS NULL THEN
    RAISE EXCEPTION 'inspection id is required' USING ERRCODE = '22023';
  END IF;
  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'values must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_values)) <> 1
     OR NOT (p_values ? 'resolved')
     OR jsonb_typeof(p_values->'resolved') <> 'boolean' THEN
    RAISE EXCEPTION 'Facility may only change inspection resolved status'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.housing_inspections AS i
  SET resolved = (p_values->>'resolved')::boolean,
      resolved_at = CASE WHEN (p_values->>'resolved')::boolean THEN now() ELSE NULL END
  WHERE i.id = p_inspection_id
    AND i.organization_id = v_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inspection not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_log (
    organization_id, user_id, action, table_name, record_id, new_values, reason
  ) VALUES (
    v_org_id,
    auth.uid(),
    'status_change'::public.audit_action,
    'housing_inspections',
    p_inspection_id,
    jsonb_build_object(
      'facility_entity', 'housing_inspection',
      'changed_fields', (
        SELECT COALESCE(jsonb_agg(fields.key ORDER BY fields.key), '[]'::jsonb)
        FROM jsonb_object_keys(p_values) AS fields(key)
      )
    ),
    'facility_inspection_rpc'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.facility_update_inspection(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_update_inspection(uuid, jsonb) TO authenticated, service_role;

-- Defense in depth: even if a future migration accidentally adds a broader row
-- policy, a Facility JWT still cannot change money, contract or contact-routing
-- columns on the operational base tables.
CREATE OR REPLACE FUNCTION public.facility_guard_protected_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_new jsonb := to_jsonb(NEW);
  v_key text;
  v_protected text[];
BEGIN
  IF NOT public.is_facility_user() THEN
    RETURN NEW;
  END IF;

  v_protected := CASE TG_TABLE_NAME
    WHEN 'properties' THEN ARRAY[
      'notes',
      'monthly_rent', 'cost_price', 'cost_gas', 'cost_water', 'cost_electra',
      'cost_municipal_tax', 'cost_other', 'rental_contract_url',
      'rental_contract_start_date', 'rental_contract_end_date',
      'rental_contract_notes', 'owner_id', 'energy_wizard_id', 'energy_wizard_linked'
    ]
    WHEN 'units' THEN ARRAY['weekly_cost', 'notes']
    WHEN 'housing_assignments' THEN ARRAY[
      'monthly_deduction', 'deduction_amount', 'deposit_paid',
      'rent_paid_until', 'payment_frequency', 'notes'
    ]
    WHEN 'vehicles' THEN ARRAY['fuel_card_reference', 'avg_consumption_per_100km', 'notes']
    WHEN 'vehicle_damage_reports' THEN ARRAY[
      'cost_estimate', 'garage_notified', 'garage_notified_at', 'garage_email',
      'internal_contact_email', 'external_contact_email'
    ]
    ELSE ARRAY[]::text[]
  END;

  FOREACH v_key IN ARRAY v_protected LOOP
    IF TG_OP = 'UPDATE' AND (v_new->v_key) IS DISTINCT FROM (v_old->v_key) THEN
      RAISE EXCEPTION 'Facility cannot change protected field %.%', TG_TABLE_NAME, v_key
        USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF TG_TABLE_NAME = 'housing_assignments' AND v_key = 'deposit_paid' THEN
        IF COALESCE((v_new->>v_key)::boolean, false) THEN
          RAISE EXCEPTION 'Facility cannot set protected field %.%', TG_TABLE_NAME, v_key
            USING ERRCODE = '42501';
        END IF;
      ELSIF TG_TABLE_NAME = 'housing_assignments' AND v_key = 'payment_frequency' THEN
        IF COALESCE(v_new->>v_key, 'wekelijks') <> 'wekelijks' THEN
          RAISE EXCEPTION 'Facility cannot set protected field %.%', TG_TABLE_NAME, v_key
            USING ERRCODE = '42501';
        END IF;
      ELSIF TG_TABLE_NAME = 'properties' AND v_key = 'energy_wizard_linked' THEN
        IF COALESCE((v_new->>v_key)::boolean, false) THEN
          RAISE EXCEPTION 'Facility cannot set protected field %.%', TG_TABLE_NAME, v_key
            USING ERRCODE = '42501';
        END IF;
      ELSIF TG_TABLE_NAME = 'properties' AND v_key = ANY (ARRAY[
        'cost_gas', 'cost_water', 'cost_electra', 'cost_municipal_tax', 'cost_other'
      ]) THEN
        IF COALESCE((v_new->>v_key)::numeric, 0) <> 0 THEN
          RAISE EXCEPTION 'Facility cannot set protected field %.%', TG_TABLE_NAME, v_key
            USING ERRCODE = '42501';
        END IF;
      ELSIF TG_TABLE_NAME = 'vehicle_damage_reports' AND v_key = 'garage_notified' THEN
        IF COALESCE((v_new->>v_key)::boolean, false) THEN
          RAISE EXCEPTION 'Facility cannot set protected field %.%', TG_TABLE_NAME, v_key
            USING ERRCODE = '42501';
        END IF;
      ELSIF v_new->v_key IS NOT NULL AND v_new->v_key <> 'null'::jsonb THEN
        RAISE EXCEPTION 'Facility cannot set protected field %.%', TG_TABLE_NAME, v_key
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.facility_guard_protected_fields() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facility_guard_protected_fields() TO service_role;

DROP TRIGGER IF EXISTS facility_guard_properties ON public.properties;
CREATE TRIGGER facility_guard_properties
BEFORE INSERT OR UPDATE ON public.properties
FOR EACH ROW EXECUTE FUNCTION public.facility_guard_protected_fields();

DROP TRIGGER IF EXISTS facility_guard_units ON public.units;
CREATE TRIGGER facility_guard_units
BEFORE INSERT OR UPDATE ON public.units
FOR EACH ROW EXECUTE FUNCTION public.facility_guard_protected_fields();

DROP TRIGGER IF EXISTS facility_guard_housing_assignments ON public.housing_assignments;
CREATE TRIGGER facility_guard_housing_assignments
BEFORE INSERT OR UPDATE ON public.housing_assignments
FOR EACH ROW EXECUTE FUNCTION public.facility_guard_protected_fields();

DROP TRIGGER IF EXISTS facility_guard_vehicles ON public.vehicles;
CREATE TRIGGER facility_guard_vehicles
BEFORE INSERT OR UPDATE ON public.vehicles
FOR EACH ROW EXECUTE FUNCTION public.facility_guard_protected_fields();

DROP TRIGGER IF EXISTS facility_guard_vehicle_damage_reports ON public.vehicle_damage_reports;
CREATE TRIGGER facility_guard_vehicle_damage_reports
BEFORE INSERT OR UPDATE ON public.vehicle_damage_reports
FOR EACH ROW EXECUTE FUNCTION public.facility_guard_protected_fields();

-- Keep authorship, timestamps, resident confirmations and inspection bindings
-- server-controlled even when future row policies are relaxed accidentally.
CREATE OR REPLACE FUNCTION public.facility_guard_operational_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_facility_user() THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'housing_cleaning_tasks' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_by := auth.uid();
      NEW.created_at := now();
    ELSIF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Facility cannot change cleaning task identity or authorship metadata'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'housing_inspections' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.inspected_by := auth.uid();
      NEW.created_at := now();
      NEW.confirmed_by_resident := false;
      NEW.confirmed_at := NULL;
    ELSIF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.property_id IS DISTINCT FROM OLD.property_id
       OR NEW.unit_id IS DISTINCT FROM OLD.unit_id
       OR NEW.housing_assignment_id IS DISTINCT FROM OLD.housing_assignment_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.inspected_by IS DISTINCT FROM OLD.inspected_by
       OR NEW.confirmed_by_resident IS DISTINCT FROM OLD.confirmed_by_resident
       OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
      RAISE EXCEPTION 'Facility cannot change inspection identity, binding or confirmation metadata'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.facility_guard_operational_metadata() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.facility_guard_operational_metadata() TO service_role;

DROP TRIGGER IF EXISTS facility_guard_cleaning_metadata ON public.housing_cleaning_tasks;
CREATE TRIGGER facility_guard_cleaning_metadata
BEFORE INSERT OR UPDATE ON public.housing_cleaning_tasks
FOR EACH ROW EXECUTE FUNCTION public.facility_guard_operational_metadata();

DROP TRIGGER IF EXISTS facility_guard_inspection_metadata ON public.housing_inspections;
CREATE TRIGGER facility_guard_inspection_metadata
BEFORE INSERT OR UPDATE ON public.housing_inspections
FOR EACH ROW EXECUTE FUNCTION public.facility_guard_operational_metadata();

-- Full-row SELECT is only granted on tables without financial/contract columns.
-- The five protected base tables above are accessed solely through safe RPCs.
DROP POLICY IF EXISTS housing_cleaning_tasks_facility_select ON public.housing_cleaning_tasks;
CREATE POLICY housing_cleaning_tasks_facility_select ON public.housing_cleaning_tasks
FOR SELECT TO authenticated
USING (organization_id = public.facility_org_id());

DROP POLICY IF EXISTS housing_cleaning_tasks_facility_insert ON public.housing_cleaning_tasks;
CREATE POLICY housing_cleaning_tasks_facility_insert ON public.housing_cleaning_tasks
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = public.facility_org_id()
  AND (created_by IS NULL OR created_by = auth.uid())
  AND public.facility_reference_is_in_org('property', property_id)
  AND (unit_id IS NULL OR public.facility_reference_is_in_org('unit', unit_id))
  AND (assigned_to IS NULL OR public.facility_reference_is_in_org('profile', assigned_to))
);

DROP POLICY IF EXISTS housing_cleaning_tasks_facility_update ON public.housing_cleaning_tasks;
CREATE POLICY housing_cleaning_tasks_facility_update ON public.housing_cleaning_tasks
FOR UPDATE TO authenticated
USING (organization_id = public.facility_org_id())
WITH CHECK (
  organization_id = public.facility_org_id()
  AND public.facility_reference_is_in_org('property', property_id)
  AND (unit_id IS NULL OR public.facility_reference_is_in_org('unit', unit_id))
  AND (assigned_to IS NULL OR public.facility_reference_is_in_org('profile', assigned_to))
);

DROP POLICY IF EXISTS housing_inspections_facility_select ON public.housing_inspections;

DROP POLICY IF EXISTS housing_inspections_facility_insert ON public.housing_inspections;
CREATE POLICY housing_inspections_facility_insert ON public.housing_inspections
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = public.facility_org_id()
  AND (inspected_by IS NULL OR inspected_by = auth.uid())
  AND (property_id IS NULL OR public.facility_reference_is_in_org('property', property_id))
  AND (unit_id IS NULL OR public.facility_reference_is_in_org('unit', unit_id))
  AND (
    housing_assignment_id IS NULL
    OR public.facility_reference_is_in_org('housing_assignment', housing_assignment_id)
  )
);

DROP POLICY IF EXISTS housing_inspections_facility_update ON public.housing_inspections;

DROP POLICY IF EXISTS key_registrations_facility_select ON public.key_registrations;

DROP POLICY IF EXISTS key_registrations_facility_insert ON public.key_registrations;
CREATE POLICY key_registrations_facility_insert ON public.key_registrations
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = public.facility_org_id()
  AND public.facility_reference_is_in_org('unit', unit_id)
  AND public.facility_reference_is_in_org('employee', employee_id)
  AND public.facility_employee_candidate_matches(employee_id, candidate_id)
);

DROP POLICY IF EXISTS key_registrations_facility_update ON public.key_registrations;
CREATE POLICY key_registrations_facility_update ON public.key_registrations
FOR UPDATE TO authenticated
USING (organization_id = public.facility_org_id())
WITH CHECK (
  organization_id = public.facility_org_id()
  AND public.facility_reference_is_in_org('unit', unit_id)
  AND public.facility_reference_is_in_org('employee', employee_id)
  AND public.facility_employee_candidate_matches(employee_id, candidate_id)
);

DROP POLICY IF EXISTS vehicle_assignments_facility_select ON public.vehicle_assignments;

DROP POLICY IF EXISTS vehicle_assignments_facility_insert ON public.vehicle_assignments;
CREATE POLICY vehicle_assignments_facility_insert ON public.vehicle_assignments
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = public.facility_org_id()
  AND public.facility_reference_is_in_org('vehicle', vehicle_id)
  AND public.facility_reference_is_in_org('employee', employee_id)
  AND public.facility_employee_candidate_matches(employee_id, candidate_id)
);

DROP POLICY IF EXISTS vehicle_assignments_facility_update ON public.vehicle_assignments;
CREATE POLICY vehicle_assignments_facility_update ON public.vehicle_assignments
FOR UPDATE TO authenticated
USING (organization_id = public.facility_org_id())
WITH CHECK (
  organization_id = public.facility_org_id()
  AND public.facility_reference_is_in_org('vehicle', vehicle_id)
  AND public.facility_reference_is_in_org('employee', employee_id)
  AND public.facility_employee_candidate_matches(employee_id, candidate_id)
);

-- Facility only sees its own assigned operational tasks and can change status
-- through a completion-only RPC. Recruitment/commercial tasks remain closed.
DROP POLICY IF EXISTS recruiter_tasks_facility_select ON public.recruiter_tasks;
CREATE POLICY recruiter_tasks_facility_select ON public.recruiter_tasks
FOR SELECT TO authenticated
USING (
  organization_id = public.facility_org_id()
  AND assigned_to = auth.uid()
  AND related_entity_type IN ('property', 'huis', 'unit', 'vehicle', 'auto')
);

CREATE OR REPLACE FUNCTION public.facility_set_task_status(p_task_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid := public.facility_org_id();
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'facility access required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('open', 'done') THEN
    RAISE EXCEPTION 'Facility may only open or complete a task' USING ERRCODE = '22023';
  END IF;

  UPDATE public.recruiter_tasks AS t
  SET status = p_status,
      completed_at = CASE WHEN p_status = 'done' THEN now() ELSE NULL END,
      updated_at = now()
  WHERE t.id = p_task_id
    AND t.organization_id = v_org_id
    AND t.assigned_to = auth.uid()
    AND t.related_entity_type IN ('property', 'huis', 'unit', 'vehicle', 'auto');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_log (
    organization_id, user_id, action, table_name, record_id, new_values, reason
  ) VALUES (
    v_org_id,
    auth.uid(),
    'status_change'::public.audit_action,
    'recruiter_tasks',
    p_task_id,
    jsonb_build_object('status', p_status),
    'facility_task_status_rpc'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.facility_set_task_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facility_set_task_status(uuid, text) TO authenticated, service_role;

DROP POLICY IF EXISTS task_attachments_facility_select ON public.task_attachments;
CREATE POLICY task_attachments_facility_select ON public.task_attachments
FOR SELECT TO authenticated
USING (
  organization_id = public.facility_org_id()
  AND public.facility_reference_is_in_org('task', task_id)
);

DROP POLICY IF EXISTS task_attachments_facility_insert ON public.task_attachments;
CREATE POLICY task_attachments_facility_insert ON public.task_attachments
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = public.facility_org_id()
  AND uploaded_by = auth.uid()
  AND public.facility_reference_is_in_org('task', task_id)
);

-- Facility clients never receive direct audit-log write access. Trusted
-- SECURITY DEFINER RPCs above write server-chosen audit entries themselves.
DROP POLICY IF EXISTS audit_log_facility_insert ON public.audit_log;

COMMENT ON FUNCTION public.facility_worker_directory() IS
  'Facility-only minimal worker identity projection; intentionally excludes contact, payroll and candidate dossier data.';
COMMENT ON FUNCTION public.facility_housing_snapshot(uuid) IS
  'Facility-only housing projection; intentionally excludes rent, deductions, costs, owners and contract fields.';
COMMENT ON FUNCTION public.facility_transport_snapshot(uuid) IS
  'Facility-only fleet projection; intentionally excludes fuel cards, consumption, fines, damage costs and contact emails.';
