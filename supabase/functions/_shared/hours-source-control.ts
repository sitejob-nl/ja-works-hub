import {
  calculateShiftMinutes, checkMinutesTotal, type HoursIssue, type HoursShift,
} from './hours-calculation.ts';

/** Exactly what a delivery said about one day, kept in the shape it is stored in. */
export interface HoursSourceInput {
  schemaVersion: 1;
  shifts?: HoursShift[];
  categories?: { sourceCode: string; minutes: number }[];
}

/**
 * Informational only: the server will classify the immutable saved revision.
 *
 * This lives beside the calculation kernel rather than in the browser bundle
 * because every reader has to reach it. A person entering a day by hand, the
 * spreadsheet reader and the scan reader all judge the same delivery, and they
 * have to report the same contradictions about it.
 */
export function sourceControlIssues(minutes: number, source: HoursSourceInput | null): HoursIssue[] {
  if (!source) return [];
  const issues: HoursIssue[] = [];
  if (minutes === 0) issues.push({ code: 'INVALID_ZERO_SOURCE', message: 'Geen uren is gecombineerd met brongegevens. Controleer de uren of verwijder de brongegevens expliciet; de server blokkeert deze combinatie.' });
  if (source.categories) {
    const total = checkMinutesTotal(source.categories.map(category => category.minutes), minutes);
    if (total.ok === false) issues.push(...total.issues);
    if (new Set(source.categories.map(category => category.sourceCode)).size !== source.categories.length) issues.push({ code: 'DUPLICATE_SOURCE_CATEGORY', message: 'Een broncode komt meerdere keren voor. De servercontrole moet deze indeling beoordelen.' });
  }
  if (source.shifts) {
    const calculated = source.shifts.map(calculateShiftMinutes);
    calculated.forEach(result => { if (result.ok === false) issues.push(...result.issues); });
    if (calculated.every(result => result.ok)) {
      const total = checkMinutesTotal(calculated.map(result => result.ok ? result.value.netMinutes : 0), minutes);
      if (total.ok === false) issues.push(...total.issues);
      const ranges = source.shifts.map(shift => ({ start: Number(shift.start.slice(0, 2)) * 60 + Number(shift.start.slice(3)), end: Number(shift.end.slice(0, 2)) * 60 + Number(shift.end.slice(3)) + shift.endDayOffset * 1440 })).sort((a, b) => a.start - b.start);
      if (ranges.some((range, index) => index > 0 && range.start < ranges[index - 1].end)) issues.push({ code: 'OVERLAPPING_SHIFTS', message: 'De aangeleverde diensten overlappen. Dit wordt als broninformatie bewaard en blokkeert de urenindeling.' });
    }
  }
  return issues;
}
