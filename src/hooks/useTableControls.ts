import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DEFAULT_PAGE_SIZE,
  type PageSize,
  type SortableColumn,
  type SortDirection,
  type SortState,
  applyOrder,
  parsePage,
  parsePageSize,
  parseSort,
  serializeSort,
  sortRows,
  toggleSortState,
} from '@/lib/table-sort';

export type TableControls<Row = any> = {
  /** Actieve sortering; altijd een kolom die deze gebruiker ook echt ziet. */
  sort: SortState;
  /** De opgeloste kolomdefinitie die bij `sort` hoort. */
  column: SortableColumn<Row>;
  /** Klik op een kolomkop. Onbekende/verborgen sleutels doen niets. */
  toggleSort: (key: string) => void;
  /** 0-gebaseerd, net als de bestaande `page`-state op de lijstpagina's. */
  page: number;
  setPage: (page: number) => void;
  pageSize: PageSize;
  setPageSize: (size: PageSize) => void;
  /** Grenzen voor `.range(from, to)` — inclusief, zoals PostgREST verwacht. */
  from: number;
  to: number;
  /** Zet de sortering op een PostgREST-builder, inclusief tiebreak. */
  applySort: <Q extends { order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => any }>(query: Q) => Q;
  /** Sorteert een volledige client-side set volgens dezelfde regels. */
  sortRows: (rows: readonly Row[]) => Row[];
  /** Snijdt de huidige pagina uit een al gesorteerde set. */
  pageSlice: <T>(rows: readonly T[]) => T[];
  /** Terug naar pagina 1 — aanroepen wanneer een zoekterm of filter wijzigt. */
  resetPage: () => void;
};

/**
 * URL-gedragen sortering + paginering voor lijstschermen.
 *
 * De keuzes staan in de query-string (`?sort=kolom:richting&per=50&page=2`), zodat een
 * gedeelde link hetzelfde beeld geeft, een refresh niets weggooit en terugkomen uit een
 * detailscherm de lijst laat staan zoals hij stond. Waarden gelijk aan de default worden
 * uit de URL gehaald zodat die schoon blijft — hetzelfde patroon als `useSearchParamState`.
 *
 * Geef in `columns` alléén de kolommen mee die de huidige gebruiker ook echt ziet;
 * een verborgen kolom is daarmee automatisch niet sorteerbaar, ook niet via de URL.
 */
export function useTableControls<Row = any>({
  columns,
  defaultSort,
  defaultPageSize = DEFAULT_PAGE_SIZE,
  tiebreak = ['id'],
  paramPrefix = '',
}: {
  columns: readonly SortableColumn<Row>[];
  defaultSort: SortState;
  defaultPageSize?: PageSize;
  /** Kolommen die gelijke rijen een vaste volgorde geven (server-side). */
  tiebreak?: readonly string[];
  /** Prefix voor de URL-params, nodig zodra één pagina twee lijsten heeft. */
  paramPrefix?: string;
}): TableControls<Row> {
  const [params, setParams] = useSearchParams();

  const sortParam = `${paramPrefix}sort`;
  const pageParam = `${paramPrefix}page`;
  const sizeParam = `${paramPrefix}per`;

  // Staat de default-kolom niet in de zichtbare set (rolafhankelijke kolommen), val dan
  // terug op de eerste zichtbare kolom in plaats van op een kop die er niet is.
  const resolvedDefault = useMemo<SortState>(() => {
    if (columns.some((c) => c.key === defaultSort.column)) return defaultSort;
    const first = columns[0];
    return first ? { column: first.key, direction: first.defaultDirection ?? 'asc' } : defaultSort;
  }, [columns, defaultSort]);

  const sort = parseSort(params.get(sortParam), columns, resolvedDefault);
  const pageSize = parsePageSize(params.get(sizeParam), defaultPageSize);
  const page = parsePage(params.get(pageParam));

  const column = useMemo<SortableColumn<Row>>(
    () => columns.find((c) => c.key === sort.column) ?? { key: sort.column },
    [columns, sort.column],
  );

  const update = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          mutate(next);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const writePage = useCallback((next: URLSearchParams, value: number) => {
    if (value <= 0) next.delete(pageParam);
    else next.set(pageParam, String(value + 1));
  }, [pageParam]);

  const toggleSort = useCallback(
    (key: string) => {
      const target = columns.find((c) => c.key === key);
      if (!target) return;
      const next = toggleSortState(sort, target);
      update((params_) => {
        if (next.column === resolvedDefault.column && next.direction === resolvedDefault.direction) {
          params_.delete(sortParam);
        } else {
          params_.set(sortParam, serializeSort(next));
        }
        // Andere volgorde maakt "pagina 3" betekenisloos.
        params_.delete(pageParam);
      });
    },
    [columns, sort, resolvedDefault, update, sortParam, pageParam],
  );

  const setPage = useCallback(
    (value: number) => update((params_) => writePage(params_, Math.max(0, value))),
    [update, writePage],
  );

  const setPageSize = useCallback(
    (size: PageSize) => {
      update((params_) => {
        if (size === defaultPageSize) params_.delete(sizeParam);
        else params_.set(sizeParam, String(size));
        // Meer of minder rijen per pagina → terug naar pagina 1.
        params_.delete(pageParam);
      });
    },
    [update, defaultPageSize, sizeParam, pageParam],
  );

  // Wordt bij elke toetsaanslag in een zoekveld aangeroepen; sta je al op pagina 1, dan
  // is er niets te resetten en schrijven we ook geen nieuwe URL-entry.
  const resetPage = useCallback(() => {
    if (page === 0) return;
    update((params_) => params_.delete(pageParam));
  }, [page, update, pageParam]);

  const from = page * pageSize;
  const to = from + pageSize - 1;

  const applySort = useCallback(
    <Q extends { order: (col: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => any }>(query: Q): Q =>
      applyOrder(query, column, sort.direction, tiebreak),
    [column, sort.direction, tiebreak],
  );

  const sortRowsBound = useCallback(
    (rows: readonly Row[]) => sortRows(rows, column, sort.direction),
    [column, sort.direction],
  );

  const pageSlice = useCallback(
    <T,>(rows: readonly T[]): T[] => rows.slice(from, from + pageSize),
    [from, pageSize],
  );

  return {
    sort,
    column,
    toggleSort,
    page,
    setPage,
    pageSize,
    setPageSize,
    from,
    to,
    applySort,
    sortRows: sortRowsBound,
    pageSlice,
    resetPage,
  };
}

export type { SortDirection, SortState, SortableColumn, PageSize };
