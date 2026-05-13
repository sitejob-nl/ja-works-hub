BEGIN;

DROP POLICY IF EXISTS property_self_select ON public.properties;
CREATE POLICY property_self_select
ON public.properties
FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT u.property_id
    FROM public.units u
    JOIN public.housing_assignments ha ON ha.unit_id = u.id
    JOIN public.employees e ON e.id = ha.employee_id
    WHERE e.auth_user_id = auth.uid()
      AND ha.status = 'ingecheckt'
  )
);

DROP POLICY IF EXISTS unit_self_select ON public.units;
CREATE POLICY unit_self_select
ON public.units
FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT ha.unit_id
    FROM public.housing_assignments ha
    JOIN public.employees e ON e.id = ha.employee_id
    WHERE e.auth_user_id = auth.uid()
      AND ha.status = 'ingecheckt'
  )
);

DROP POLICY IF EXISTS vehicle_self_select ON public.vehicles;
CREATE POLICY vehicle_self_select
ON public.vehicles
FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT va.vehicle_id
    FROM public.vehicle_assignments va
    JOIN public.employees e ON e.id = va.employee_id
    WHERE e.auth_user_id = auth.uid()
      AND va.returned_date IS NULL
  )
);

COMMIT;
