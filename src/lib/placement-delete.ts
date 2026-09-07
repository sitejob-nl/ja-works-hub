import { formatDate } from '@/lib/format';

/**
 * Pure logica achter "plaatsing verwijderen" (onjuiste of testplaatsing).
 *
 * De database is de laatste grendel: `timesheets` staat op RESTRICT en
 * `hour_letters` + `sick_reports` op NO ACTION, dus een plaatsing met uren kán
 * niet weg. `invoice_lines` staat op SET NULL — dat lukt technisch wél, maar
 * laat een factuurregel als wees achter; daarom telt die hier óók als blokkade.
 * Deze vooraf-check bestaat zodat de gebruiker een begrijpelijke uitleg krijgt
 * in plaats van een 23503 uit Postgres.
 */
export interface PlacementDeleteImpact {
  timesheets: number;
  hourLetters: number;
  sickReports: number;
  invoiceLines: number;
}

export interface PlacementDeleteBlocker {
  key: keyof PlacementDeleteImpact;
  count: number;
  /** Bijvoorbeeld "3 urenregistraties" of "1 factuurregel". */
  label: string;
}

const BLOCKER_LABELS: Record<keyof PlacementDeleteImpact, [singular: string, plural: string]> = {
  timesheets: ['urenregistratie', 'urenregistraties'],
  hourLetters: ['urenbrief', 'urenbrieven'],
  sickReports: ['ziekmelding', 'ziekmeldingen'],
  invoiceLines: ['factuurregel', 'factuurregels'],
};

const BLOCKER_ORDER: (keyof PlacementDeleteImpact)[] = ['timesheets', 'hourLetters', 'sickReports', 'invoiceLines'];

/** Wat er nog aan de plaatsing hangt, in vaste volgorde en als Nederlandse tekst. */
export function placementDeleteBlockers(impact: PlacementDeleteImpact | null | undefined): PlacementDeleteBlocker[] {
  if (!impact) return [];
  return BLOCKER_ORDER
    .filter((key) => (impact[key] ?? 0) > 0)
    .map((key) => {
      const count = impact[key];
      const [singular, plural] = BLOCKER_LABELS[key];
      return { key, count, label: `${count} ${count === 1 ? singular : plural}` };
    });
}

/** Alleen `true` als de impact bekend is én leeg. Onbekend = niet verwijderen. */
export function canDeletePlacement(impact: PlacementDeleteImpact | null | undefined): boolean {
  return !!impact && placementDeleteBlockers(impact).length === 0;
}

/** "01-09-2026 t/m 30-09-2026", of "vanaf 01-09-2026" zonder (verwachte) einddatum. */
export function describePlacementPeriod(
  startDate: string | null | undefined,
  endDate?: string | null,
  expectedEndDate?: string | null,
): string {
  const end = endDate || expectedEndDate;
  return end ? `${formatDate(startDate)} t/m ${formatDate(end)}` : `vanaf ${formatDate(startDate)}`;
}

/**
 * Snapshot van de rij voor de auditregel: scalars, nulls en arrays (zoals
 * `work_days`) blijven staan; gejoinde relaties (objecten als `companies`,
 * `candidates`, `payrollers`) horen niet in `old_values` thuis.
 */
export function placementAuditSnapshot(row: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!row) return {};
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value === null || typeof value !== 'object' || Array.isArray(value)),
  );
}
