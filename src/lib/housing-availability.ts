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
 */
export function bedsOccupiedOn(assignments: HousingAssignmentLite[] | null | undefined, dateStr: string): number {
  return (assignments ?? []).filter(
    (a) =>
      ACTIVE_HOUSING.includes(a.status ?? '') &&
      (!a.check_in_date || a.check_in_date <= dateStr) &&
      (a.check_out_date == null || a.check_out_date > dateStr),
  ).length;
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
