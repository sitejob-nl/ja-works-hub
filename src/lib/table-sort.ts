/**
 * Gedeelde bouwsteen voor sorteerbare lijsten (ticket "Sorteerbare kolomkoppen en
 * instelbare paginagrootte"). Bewust pure logica ZONDER React- of supabase-imports,
 * zodat dit los te unit-testen is en zowel de server- als de client-gesorteerde
 * takken van een lijst hem kunnen gebruiken.
 *
 * Drie takken komen in deze codebase voor en moeten allemaal dezelfde volgorde geven:
 *  1. server-gequeryd met `.range()`  → `applyOrder()` op de PostgREST-builder
 *  2. client-side gefilterd + geslicet → `sortRows()`
 *  3. afgeleide filters die eerst ruim ophalen en daarna slicen → beide
 *
 * Sorteren gaat daarmee altijd over de héle set, nooit over alleen de zichtbare pagina.
 */

export type SortDirection = 'asc' | 'desc';

export type SortState = {
  /** `key` van de kolom, zoals die ook in de URL staat. */
  column: string;
  direction: SortDirection;
};

/**
 * Wat de bouwsteen van een kolom moet weten. Presentatie (kop, cel, uitlijning)
 * blijft bij het scherm; hier staat alleen hoe er gesorteerd wordt.
 */
export type SortableColumn<Row = any> = {
  /** Stabiele sleutel; verschijnt in de URL, dus niet zomaar hernoemen. */
  key: string;
  /**
   * Databasekolom(men) waarop server-side geordend wordt, in volgorde.
   * Default: `[key]`. Meerdere targets voor samengestelde koppen ("Merk / Model").
   */
  orderBy?: readonly string[];
  /** Client-side waarde voor dezelfde ordening. Default: `row[key]`. */
  value?: (row: Row) => unknown;
  /** Richting bij de eerste klik. Default `'asc'`; getalkolommen willen vaak `'desc'`. */
  defaultDirection?: SortDirection;
};

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 10;

/**
 * Nederlandse collatie: accent-ongevoelig ("Jose" naast "José") en getalbewust
 * ("A9" vóór "A10"), passend bij de zoekfunctie die al op unaccent draait.
 */
const collator = new Intl.Collator('nl', { numeric: true, sensitivity: 'base' });

const isEmpty = (value: unknown): boolean =>
  value === null || value === undefined || value === '';

/**
 * Vergelijkt twee celwaarden. Lege waarden staan altijd achteraan, ook bij aflopend
 * sorteren — anders levert "sorteer op APK aflopend" een pagina vol streepjes op.
 */
export function compareSortValues(a: unknown, b: unknown, direction: SortDirection = 'asc'): number {
  const aEmpty = isEmpty(a);
  const bEmpty = isEmpty(b);
  if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1;

  let result: number;
  if (typeof a === 'number' && typeof b === 'number') result = a - b;
  else if (typeof a === 'boolean' && typeof b === 'boolean') result = Number(a) - Number(b);
  else if (a instanceof Date && b instanceof Date) result = a.getTime() - b.getTime();
  else result = collator.compare(String(a), String(b));

  return direction === 'asc' ? result : -result;
}

/** Waarde waarop een kolom sorteert; default is de gelijknamige rij-eigenschap. */
export function sortValueOf<Row>(column: SortableColumn<Row>, row: Row): unknown {
  return column.value ? column.value(row) : (row as any)?.[column.key];
}

/**
 * Sorteert een kopie van `rows`. `Array.prototype.sort` is stabiel, dus rijen met een
 * gelijke waarde houden hun oorspronkelijke (server-)volgorde — daarmee is de uitkomst
 * deterministisch en kan een rij niet op twee pagina's tegelijk opduiken.
 */
export function sortRows<Row>(
  rows: readonly Row[],
  column: SortableColumn<Row>,
  direction: SortDirection,
): Row[] {
  return [...rows].sort((a, b) =>
    compareSortValues(sortValueOf(column, a), sortValueOf(column, b), direction));
}

/** Databasekolommen waarop deze kolom server-side ordent. */
export function orderTargets(column: SortableColumn): readonly string[] {
  return column.orderBy ?? [column.key];
}

type OrderableQuery = {
  order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => any;
};

/**
 * Zet de sortering op een PostgREST-builder. `tiebreak` is geen luxe: ordenen op een
 * niet-unieke kolom (bouwjaar, brandstof) laat Postgres de volgorde van gelijke rijen
 * vrij kiezen, waardoor met `.range()` een rij op twee pagina's kan staan of op geen.
 *
 * `nullsFirst: false` spiegelt `compareSortValues`, zodat beide takken lege waarden
 * achteraan zetten (Postgres zet ze bij DESC standaard vooraan).
 */
export function applyOrder<Q extends OrderableQuery>(
  query: Q,
  column: SortableColumn,
  direction: SortDirection,
  tiebreak: readonly string[] = [],
): Q {
  const targets = orderTargets(column);
  let next: any = query;
  for (const target of targets) {
    next = next.order(target, { ascending: direction === 'asc', nullsFirst: false });
  }
  for (const target of tiebreak) {
    if (targets.includes(target)) continue;
    next = next.order(target, { ascending: true, nullsFirst: false });
  }
  return next as Q;
}

/** Klik op een kop: zelfde kolom draait de richting om, nieuwe kolom start op zijn default. */
export function toggleSortState(current: SortState, column: SortableColumn): SortState {
  if (current.column === column.key) {
    return { column: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { column: column.key, direction: column.defaultDirection ?? 'asc' };
}

export function serializeSort(sort: SortState): string {
  return `${sort.column}:${sort.direction}`;
}

/**
 * Leest `?sort=kolom:richting`. Onbekende of voor deze gebruiker verborgen kolommen
 * (denk aan de facility-rol, die tankpas en notitie niet ziet) vallen terug op de
 * default — een handgetypte URL kan dus geen verborgen kolom sorteerbaar maken.
 */
export function parseSort(
  raw: string | null | undefined,
  columns: readonly SortableColumn[],
  fallback: SortState,
): SortState {
  if (!raw) return fallback;
  const [key, rawDirection] = raw.split(':');
  const column = columns.find((c) => c.key === key);
  if (!column) return fallback;
  const direction: SortDirection =
    rawDirection === 'desc' ? 'desc'
    : rawDirection === 'asc' ? 'asc'
    : (column.defaultDirection ?? 'asc');
  return { column: column.key, direction };
}

export function parsePageSize(
  raw: string | null | undefined,
  fallback: PageSize = DEFAULT_PAGE_SIZE,
): PageSize {
  const parsed = Number(raw);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(parsed) ? (parsed as PageSize) : fallback;
}

/** URL is 1-gebaseerd (leesbaar in een gedeelde link), intern 0-gebaseerd. */
export function parsePage(raw: string | null | undefined): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return 0;
  return parsed - 1;
}
