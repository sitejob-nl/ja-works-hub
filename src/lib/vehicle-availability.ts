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

/**
 * Eerstvolgende toewijzing die ná `dateStr` begint en dan nog niet is ingeleverd —
 * oftewel: de reservering. Geeft de toewijzing zélf terug, zodat de aanroeper niet
 * alleen kán tonen vanaf wanneer de auto vergeven is maar ook aan wie.
 */
export function vehicleNextReservation<T extends VehicleAssignmentLite>(
  assignments: T[] | null | undefined,
  dateStr: string,
): T | null {
  const upcoming = (assignments ?? [])
    .filter((a) => !!a.assigned_date && a.assigned_date! > dateStr)
    .filter((a) => a.returned_date == null || a.returned_date! > a.assigned_date!)
    .sort((x, y) => (x.assigned_date! < y.assigned_date! ? -1 : 1));
  return upcoming[0] ?? null;
}

/** Als `vehicleNextReservation`, maar alleen de begindatum. */
export function vehicleReservedFrom(
  assignments: VehicleAssignmentLite[] | null | undefined,
  dateStr: string,
): string | null {
  return vehicleNextReservation(assignments, dateStr)?.assigned_date ?? null;
}

/**
 * Botst een nieuwe toewijzing van `from` tot `until` met een bestaande? Een lege
 * `until` betekent open einde. Zelfde grensregel als `vehicleAssignedOn`: de
 * inleverdatum telt niet meer mee, dus de dag van inleveren mag de dag van de
 * volgende toewijzing zijn. Geeft de botsende toewijzing terug, of null.
 */
export function vehiclePeriodConflict<T extends VehicleAssignmentLite>(
  assignments: T[] | null | undefined,
  from: string,
  until?: string | null,
): T | null {
  const newUntil = until || null;
  return (
    (assignments ?? []).find((a) => {
      const otherFrom = a.assigned_date ?? '';
      const otherUntil = a.returned_date ?? null;
      return (newUntil == null || otherFrom < newUntil) && (otherUntil == null || from < otherUntil);
    }) ?? null
  );
}

export type VehicleDisplayStatus = {
  /** Sleutel voor label/badge. 'gereserveerd' is afgeleid, geen databasewaarde. */
  key: 'beschikbaar' | 'toegewezen' | 'gereserveerd' | 'onderhoud' | 'uit_dienst' | string;
  /** Gevuld bij 'gereserveerd': vanaf wanneer de auto vergeven is. */
  reservedFrom: string | null;
};

/**
 * Punt 17 — "We willen een auto niet alleen kunnen toewijzen maar ook reserveren."
 *
 * De status die de gebruiker ziet wordt afgeleid uit de toewijzingsdatums in plaats
 * van uit een extra enum-waarde: een reservering ís een toewijzing die later begint.
 * Zo kan de status niet verouderen — er is geen nachtelijke sweep nodig om
 * 'gereserveerd' op de ingangsdatum om te zetten naar 'toegewezen'.
 *
 * onderhoud/uit_dienst zijn handmatige standen en winnen altijd.
 */
export function vehicleDisplayStatus(
  vehicle: { status?: string | null; vehicle_assignments?: VehicleAssignmentLite[] | null },
  dateStr: string,
): VehicleDisplayStatus {
  if (vehicle.status === 'onderhoud' || vehicle.status === 'uit_dienst') {
    return { key: vehicle.status, reservedFrom: null };
  }
  if (vehicleAssignedOn(vehicle.vehicle_assignments, dateStr)) {
    return { key: 'toegewezen', reservedFrom: null };
  }
  const reservedFrom = vehicleReservedFrom(vehicle.vehicle_assignments, dateStr);
  if (reservedFrom) return { key: 'gereserveerd', reservedFrom };
  return { key: vehicle.status ?? 'beschikbaar', reservedFrom: null };
}
