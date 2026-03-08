-- 1. Attach the existing check_drivers_license function as a trigger on vehicle_assignments
CREATE TRIGGER trg_check_drivers_license
  BEFORE INSERT ON public.vehicle_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.check_drivers_license();

-- 2. Attach check_unit_capacity trigger on housing_assignments
CREATE TRIGGER trg_check_unit_capacity
  BEFORE INSERT OR UPDATE ON public.housing_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.check_unit_capacity();