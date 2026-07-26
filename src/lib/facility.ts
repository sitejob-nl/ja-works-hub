import { supabase } from '@/integrations/supabase/client';
export { isFacilityPathAllowed, isFacilityRole } from '@/lib/facility-access';

export type FacilityWorker = {
  candidate_id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  employee_number: string | null;
  employee_status: string | null;
  status: string | null;
};

export type FacilityProfile = {
  id: string;
  full_name: string | null;
  role: string;
};

export type FacilityHousingSnapshot = {
  properties: any[];
  units: any[];
  housing_assignments: any[];
  cleaning_tasks: any[];
  inspections: any[];
  key_registrations: any[];
};

export type FacilityTransportSnapshot = {
  vehicles: any[];
  assignments: any[];
  damage_reports: any[];
};

export type FacilityShellContext = {
  id: string;
  name: string;
  logo_url: string | null;
  branding: Record<string, string>;
};

export type FacilityOperationalEntity =
  | 'property'
  | 'unit'
  | 'housing_assignment'
  | 'vehicle'
  | 'vehicle_damage_report';

async function callFacilityRpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  // Generated database types intentionally lag migrations. Keep the escape hatch
  // in this one module until types are regenerated after the migration deploy.
  const { data, error } = await (supabase as any).rpc(name, args);
  if (error) throw error;
  return data as T;
}

export function fetchFacilityShellContext(): Promise<FacilityShellContext> {
  return callFacilityRpc<FacilityShellContext>('facility_shell_context');
}

export function fetchFacilityWorkerDirectory(): Promise<FacilityWorker[]> {
  return callFacilityRpc<FacilityWorker[]>('facility_worker_directory');
}

export function fetchFacilityProfileDirectory(): Promise<FacilityProfile[]> {
  return callFacilityRpc<FacilityProfile[]>('facility_profile_directory');
}

export async function fetchFacilityHousingSnapshot(propertyId?: string | null): Promise<FacilityHousingSnapshot> {
  const raw = await callFacilityRpc<Partial<FacilityHousingSnapshot>>(
    'facility_housing_snapshot',
    { p_property_id: propertyId ?? null },
  );
  const snapshot: FacilityHousingSnapshot = {
    properties: Array.isArray(raw?.properties) ? raw.properties : [],
    units: Array.isArray(raw?.units) ? raw.units : [],
    housing_assignments: Array.isArray(raw?.housing_assignments) ? raw.housing_assignments : [],
    cleaning_tasks: Array.isArray(raw?.cleaning_tasks) ? raw.cleaning_tasks : [],
    inspections: Array.isArray(raw?.inspections) ? raw.inspections : [],
    key_registrations: Array.isArray(raw?.key_registrations) ? raw.key_registrations : [],
  };

  const units = snapshot.units.map((unit) => ({
    ...unit,
    housing_assignments: snapshot.housing_assignments.filter((assignment) => assignment.unit_id === unit.id),
    key_registrations: snapshot.key_registrations.filter((registration) => registration.unit_id === unit.id),
    inspections: snapshot.inspections.filter((inspection) => inspection.unit_id === unit.id),
  }));
  snapshot.units = units;
  snapshot.properties = snapshot.properties.map((property) => ({
    ...property,
    units: units.filter((unit) => unit.property_id === property.id),
    cleaning_tasks: snapshot.cleaning_tasks.filter((task) => task.property_id === property.id),
    inspections: snapshot.inspections.filter((inspection) => inspection.property_id === property.id),
    key_registrations: snapshot.key_registrations.filter((registration) =>
      units.some((unit) => unit.property_id === property.id && unit.id === registration.unit_id)),
  }));
  return snapshot;
}

export async function fetchFacilityTransportSnapshot(vehicleId?: string | null): Promise<FacilityTransportSnapshot> {
  const [raw, workers] = await Promise.all([
    callFacilityRpc<Partial<FacilityTransportSnapshot>>(
      'facility_transport_snapshot',
      { p_vehicle_id: vehicleId ?? null },
    ),
    fetchFacilityWorkerDirectory(),
  ]);
  const workerByEmployeeId = new Map(workers.map((worker) => [worker.employee_id, worker]));
  const snapshot: FacilityTransportSnapshot = {
    vehicles: Array.isArray(raw?.vehicles) ? raw.vehicles : [],
    assignments: (Array.isArray(raw?.assignments) ? raw.assignments : []).map((assignment) => ({
      ...assignment,
      worker: workerByEmployeeId.get(assignment.employee_id) ?? null,
    })),
    damage_reports: (Array.isArray(raw?.damage_reports) ? raw.damage_reports : []).map((report) => ({
      ...report,
      worker: workerByEmployeeId.get(report.employee_id) ?? null,
    })),
  };
  snapshot.vehicles = snapshot.vehicles.map((vehicle) => ({
    ...vehicle,
    assignments: snapshot.assignments.filter((assignment) => assignment.vehicle_id === vehicle.id),
    damage_reports: snapshot.damage_reports.filter((report) => report.vehicle_id === vehicle.id),
  }));
  return snapshot;
}

export async function saveFacilityOperationalEntity(
  entity: FacilityOperationalEntity,
  values: Record<string, unknown>,
): Promise<string> {
  return callFacilityRpc<string>('facility_save_operational_entity', {
    p_entity: entity,
    p_values: values,
  });
}

export function updateFacilityInspection(
  inspectionId: string,
  values: Record<string, unknown>,
): Promise<void> {
  return callFacilityRpc<void>('facility_update_inspection', {
    p_inspection_id: inspectionId,
    p_values: values,
  });
}

export function setFacilityTaskStatus(taskId: string, status: 'open' | 'done'): Promise<void> {
  return callFacilityRpc<void>('facility_set_task_status', {
    p_task_id: taskId,
    p_status: status,
  });
}
