// Pure huisvestings-beschikbaarheidslogica — bewust ZONDER imports (geen supabase),
// zodat dit los te unit-testen is zonder env/client.

export interface HousingAssignmentLite {
  status?: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
}

const ACTIVE_HOUSING = ['ingecheckt', 'gereserveerd'];

/**
 * Aantal bezette bedden in een kamer op datum `dateStr` (YYYY-MM-DD).
 *
 * Een bewoner bezet het bed op die datum als zijn verblijf de datum omvat:
 * op/voor die datum ingecheckt (`check_in_date <= dateStr`, of onbekend) én nog
 * niet vertrokken (`check_out_date` leeg of ná die datum). Zo telt een toekomstige
 * reservering NIET mee voor eerdere datums, en komt een kamer vrij zodra de bewoner
 * op/voor de gekozen datum uitcheckt.
 *
 * Een toewijzing met status `uitgecheckt` telt alléén mee zolang de uitcheckdatum
 * nog niet bereikt is: wie op een toekomstige datum is uitgecheckt, zit er tot die
 * dag nog. Historische uitchecks (datum voorbij) tellen nooit mee.
 */
export function bedsOccupiedOn(assignments: HousingAssignmentLite[] | null | undefined, dateStr: string): number {
  return (assignments ?? []).filter((a) => {
    const checkedInBy = !a.check_in_date || a.check_in_date <= dateStr;
    if (ACTIVE_HOUSING.includes(a.status ?? '')) {
      return checkedInBy && (a.check_out_date == null || a.check_out_date > dateStr);
    }
    if (a.status === 'uitgecheckt') {
      return checkedInBy && a.check_out_date != null && a.check_out_date > dateStr;
    }
    return false;
  }).length;
}

/**
 * Heeft de kamer een vrij bed op `dateStr`? Onbekende capaciteit telt als 1
 * (zodat een lege kamer met niet-ingevulde capaciteit nooit onterecht wegvalt).
 */
export function roomHasFreeBedOn(
  unit: { capacity?: number | null; housing_assignments?: HousingAssignmentLite[] | null },
  dateStr: string,
): boolean {
  return bedsOccupiedOn(unit.housing_assignments, dateStr) < (unit.capacity ?? 1);
}

export interface HousingUnitLite {
  capacity?: number | null;
  housing_assignments?: HousingAssignmentLite[] | null;
}

export interface PropertyOccupancy {
  totalCapacity: number;
  currentOccupancy: number;
  percentage: number;
  freeRooms: number;
}

/**
 * Bezettingscijfers van een pand op `dateStr`, met dezelfde regel als de kamerkiezer en
 * de beschikbaarheidsgrafiek (`bedsOccupiedOn`): een reservering telt mee vanaf de
 * incheckdatum, en wie op een toekomstige datum is uitgecheckt bezet het bed tot die dag.
 * Zonder die regel valt een bewoner met een uitcheck in de toekomst meteen uit de teller.
 *
 * `freeRooms` = kamers met capaciteit waar op die datum niemand zit.
 */
export function summarizePropertyOccupancy(
  units: HousingUnitLite[] | null | undefined,
  dateStr: string,
): PropertyOccupancy {
  const list = units ?? [];
  const totalCapacity = list.reduce((sum, u) => sum + (u.capacity ?? 0), 0);
  const currentOccupancy = list.reduce((sum, u) => sum + bedsOccupiedOn(u.housing_assignments, dateStr), 0);
  const percentage = totalCapacity > 0 ? Math.round((currentOccupancy / totalCapacity) * 100) : 0;
  const freeRooms = list.filter((u) => (u.capacity ?? 0) > 0 && bedsOccupiedOn(u.housing_assignments, dateStr) === 0).length;
  return { totalCapacity, currentOccupancy, percentage, freeRooms };
}

/**
 * Waarom een uitcheckdatum niet kan, of `null` als hij goed is. Uitchecken mag in
 * het verleden of de toekomst liggen, maar nooit vóór de incheckdatum (dezelfde
 * dag mag wel). Een lege datum is ook een fout: het veld is verplicht.
 */
export function checkOutDateProblem(
  checkOutDate: string | null | undefined,
  checkInDate: string | null | undefined,
): string | null {
  if (!checkOutDate) return 'Kies een uitcheckdatum.';
  if (checkInDate && checkOutDate < checkInDate) return 'De uitcheckdatum kan niet vóór de incheckdatum liggen.';
  return null;
}

/**
 * Voorgestelde uitcheckdatum: `today` (YYYY-MM-DD, lokale dag). Wie pas in de
 * toekomst incheckt, krijgt de incheckdatum voorgesteld — anders opent de
 * uitcheckdialoog meteen geblokkeerd.
 */
export function defaultCheckOutDate(checkInDate: string | null | undefined, today: string): string {
  return checkInDate && checkInDate > today ? checkInDate : today;
}
