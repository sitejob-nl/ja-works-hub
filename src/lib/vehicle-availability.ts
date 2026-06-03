// Pure voertuig-beschikbaarheidslogica — bewust ZONDER imports (geen supabase),
// zodat dit los te unit-testen is zonder env/client. Spiegelt housing-availability.ts.

export interface VehicleAssignmentLite {
  assigned_date?: string | null;
  returned_date?: string | null;
}

/**
 * Is het voertuig op `dateStr` (YYYY-MM-DD) toegewezen? Een toewijzing bezet het
 * voertuig als die de datum omvat: op/voor die datum toegewezen (`assigned_date <=
 * dateStr`, of onbekend) en nog niet ingeleverd (`returned_date` leeg of ná die datum).
 * Een toekomstige toewijzing blokkeert eerdere datums niet; een voertuig komt vrij
 * zodra het op/voor de gekozen datum is ingeleverd.
 */
export function vehicleAssignedOn(assignments: VehicleAssignmentLite[] | null | undefined, dateStr: string): boolean {
  return (assignments ?? []).some(
    (a) =>
      (!a.assigned_date || a.assigned_date <= dateStr) &&
      (a.returned_date == null || a.returned_date > dateStr),
  );
}

/** Is het voertuig vrij op `dateStr`? (capaciteit 1 — één bestuurder tegelijk) */
export function vehicleFreeOn(
  vehicle: { vehicle_assignments?: VehicleAssignmentLite[] | null },
  dateStr: string,
): boolean {
  return !vehicleAssignedOn(vehicle.vehicle_assignments, dateStr);
}
