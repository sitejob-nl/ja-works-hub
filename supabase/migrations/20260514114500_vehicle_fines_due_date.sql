-- Add a separate payment deadline for vehicle fines and keep the
-- candidate/person link filled for records that still only have employee_id.

ALTER TABLE public.vehicle_fines
  ADD COLUMN IF NOT EXISTS due_date date;

UPDATE public.vehicle_fines vf
SET candidate_id = e.candidate_id
FROM public.employees e
WHERE vf.employee_id = e.id
  AND vf.candidate_id IS NULL
  AND e.candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_fines_org_due_date_unpaid
  ON public.vehicle_fines (organization_id, due_date)
  WHERE paid = false AND due_date IS NOT NULL;

COMMENT ON COLUMN public.vehicle_fines.due_date IS 'Uiterste betaaldatum van de boete.';
