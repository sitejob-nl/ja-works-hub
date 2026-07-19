import { workDurationMonths } from '@/lib/candidateScreening';

export interface WorkEntry {
  bedrijf?: string;
  functie?: string;
  periode?: string;
  duur_maanden?: number;
}

export interface WorkGap {
  periode?: string;
  duur_maanden?: number;
  mogelijke_verklaring?: string;
}

export interface TimelineRow {
  key: string;
  kind: 'werk' | 'gat';
  start: number;
  end: number;
  /** false wanneer er geen jaartal in de periode stond; start/end zijn dan een aanname. */
  knownPeriod: boolean;
  /** Functietitel, of "Gat in werkhistorie". */
  title: string;
  /** Werkgever + periode (werk) of alleen de periode (gat). */
  meta: string;
  /** Mogelijke verklaring bij een gat. */
  note?: string;
  months: number | null;
}

const currentYear = () => new Date().getFullYear();

/**
 * Parse "2019 - 2021" of "jan 2020 - mrt 2022" naar globale start-/eindjaren.
 * Harde grens op het huidige jaar: een CV-typo ("2027") of een mis-geparste
 * "tot heden" mag de tijdlijn nooit naar de toekomst laten doorlopen. "Heden"/
 * "present" (zonder eindjaar) mapt naar het huidige jaar i.p.v. start + 1.
 *
 * `known` is false wanneer er geen jaartal in de tekst stond. De teruggegeven
 * jaren zijn dan puur een plek op de as, geen feit — de aanroeper mag zo'n regel
 * niet als "recent" behandelen.
 */
export function parseYearRange(periode: string | undefined): { start: number; end: number; known: boolean } {
  const now = currentYear();
  const text = periode ?? '';
  const nums = text.match(/\d{4}/g);
  const ongoing = /heden|present|current|\bnu\b|now/i.test(text);
  if (!nums || nums.length === 0) return { start: now - 1, end: now, known: false };
  const start = Math.min(parseInt(nums[0]), now);
  let end = nums.length > 1
    ? Math.min(parseInt(nums[nums.length - 1]), now)
    : (ongoing ? now : Math.min(start + 1, now));
  if (end < start) end = start;
  return { start, end, known: true };
}

/** Gelijkmatig verdeelde jaarlabels voor de as, altijd inclusief begin- en eindjaar. */
export function buildTickYears(minYear: number, maxYear: number, maxTicks: number): number[] {
  const span = maxYear - minYear;
  if (span <= 0) return [minYear];
  const step = Math.max(1, Math.ceil(span / Math.max(1, maxTicks - 1)));
  const ticks: number[] = [];
  for (let y = minYear; y < maxYear; y += step) ticks.push(y);
  // Laat het laatste tussenlabel vallen als het tegen het eindjaar aan botst.
  if (ticks.length > 1 && maxYear - ticks[ticks.length - 1] < step / 2) ticks.pop();
  ticks.push(maxYear);
  return ticks;
}

/**
 * Zet werkgevers en gaten om in één chronologische reeks regels — nieuwste
 * bovenaan, zoals een CV gelezen wordt. Elke regel draagt zelf alle feiten,
 * zodat kleur nooit de enige drager van betekenis is.
 */
export function buildTimelineRows(werkgevers: WorkEntry[], gaten: WorkGap[]): TimelineRow[] {
  const rows: TimelineRow[] = [
    ...werkgevers.map((w, i) => {
      const { start, end, known } = parseYearRange(w?.periode);
      const periode = w?.periode?.trim() || 'Periode onbekend';
      return {
        key: `werk-${i}`,
        kind: 'werk' as const,
        start,
        end,
        knownPeriod: known,
        title: w?.functie?.trim() || 'Functie onbekend',
        meta: [w?.bedrijf?.trim() || 'Werkgever onbekend', periode].join(' · '),
        months: workDurationMonths(w),
      };
    }),
    ...gaten.map((g, i) => {
      const { start, end, known } = parseYearRange(g?.periode);
      return {
        key: `gat-${i}`,
        kind: 'gat' as const,
        start,
        end,
        knownPeriod: known,
        title: 'Gat in werkhistorie',
        meta: g?.periode?.trim() || 'Periode onbekend',
        note: g?.mogelijke_verklaring?.trim() || undefined,
        months: workDurationMonths(g),
      };
    }),
  ];
  // Regels zonder leesbaar jaartal staan onderaan: hun start/end is een aanname
  // (rond nu), dus zonder deze regel zouden ze als bijna-nieuwste bovenaan
  // belanden terwijl de regel zelf "Periode onbekend" zegt.
  return rows.sort((a, b) => {
    if (a.knownPeriod !== b.knownPeriod) return a.knownPeriod ? -1 : 1;
    return (b.start - a.start) || (b.end - a.end);
  });
}
