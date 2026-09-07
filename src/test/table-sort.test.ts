import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  type SortableColumn,
  type SortState,
  applyOrder,
  compareSortValues,
  orderTargets,
  parsePage,
  parsePageSize,
  parseSort,
  serializeSort,
  sortRows,
  toggleSortState,
} from '@/lib/table-sort';

const columns: SortableColumn[] = [
  { key: 'license_plate' },
  { key: 'brand', orderBy: ['brand', 'model'], value: (v: any) => [v.brand, v.model].filter(Boolean).join(' ') },
  { key: 'year', defaultDirection: 'desc' },
];
const defaultSort: SortState = { column: 'license_plate', direction: 'asc' };

describe('compareSortValues', () => {
  it('sorteert getallen numeriek, niet als tekst', () => {
    expect(compareSortValues(9, 10, 'asc')).toBeLessThan(0);
    expect(compareSortValues(9, 10, 'desc')).toBeGreaterThan(0);
  });

  it('vergelijkt tekst accent-ongevoelig met Nederlandse collatie', () => {
    expect(compareSortValues('José', 'Jose', 'asc')).toBe(0);
    expect(compareSortValues('appel', 'Beuk', 'asc')).toBeLessThan(0);
  });

  it('houdt lege waarden achteraan, ook bij aflopend sorteren', () => {
    expect(compareSortValues(null, 5, 'asc')).toBeGreaterThan(0);
    expect(compareSortValues(null, 5, 'desc')).toBeGreaterThan(0);
    expect(compareSortValues(undefined, 'a', 'desc')).toBeGreaterThan(0);
    expect(compareSortValues('', 'a', 'desc')).toBeGreaterThan(0);
    expect(compareSortValues(null, undefined, 'asc')).toBe(0);
  });

  it('vergelijkt ISO-datums chronologisch', () => {
    expect(compareSortValues('2026-01-09', '2026-01-10', 'asc')).toBeLessThan(0);
  });
});

describe('sortRows', () => {
  const rows = [
    { id: 'c', license_plate: '11-AB-3', brand: 'Ford', model: 'Transit', year: 2019 },
    { id: 'a', license_plate: '99-ZZ-1', brand: 'Ford', model: 'Custom', year: 2021 },
    { id: 'b', license_plate: '22-CD-4', brand: 'Opel', model: 'Vivaro', year: null },
  ];

  it('sorteert over de hele set op de gekozen kolom', () => {
    expect(sortRows(rows, columns[2], 'desc').map((r) => r.id)).toEqual(['a', 'c', 'b']);
    expect(sortRows(rows, columns[2], 'asc').map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('gebruikt de samengestelde accessor van een kolom', () => {
    expect(sortRows(rows, columns[1], 'asc').map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('laat de bron ongemoeid en is stabiel bij gelijke waarden', () => {
    const input = [
      { id: '1', fuel_type: 'diesel' },
      { id: '2', fuel_type: 'diesel' },
      { id: '3', fuel_type: 'benzine' },
    ];
    const sorted = sortRows(input, { key: 'fuel_type' }, 'asc');
    expect(sorted.map((r) => r.id)).toEqual(['3', '1', '2']);
    expect(input.map((r) => r.id)).toEqual(['1', '2', '3']);
  });
});

describe('toggleSortState', () => {
  it('draait de richting om op de actieve kolom', () => {
    expect(toggleSortState({ column: 'year', direction: 'asc' }, columns[2]))
      .toEqual({ column: 'year', direction: 'desc' });
    expect(toggleSortState({ column: 'year', direction: 'desc' }, columns[2]))
      .toEqual({ column: 'year', direction: 'asc' });
  });

  it('start een nieuwe kolom in zijn eigen voorkeursrichting', () => {
    expect(toggleSortState(defaultSort, columns[2])).toEqual({ column: 'year', direction: 'desc' });
    expect(toggleSortState({ column: 'year', direction: 'desc' }, columns[0]))
      .toEqual({ column: 'license_plate', direction: 'asc' });
  });
});

describe('URL-parameters', () => {
  it('rondreist zonder informatieverlies', () => {
    const state: SortState = { column: 'year', direction: 'desc' };
    expect(parseSort(serializeSort(state), columns, defaultSort)).toEqual(state);
  });

  it('valt terug op de default bij ontbrekende of onzinnige waarden', () => {
    expect(parseSort(null, columns, defaultSort)).toEqual(defaultSort);
    expect(parseSort('', columns, defaultSort)).toEqual(defaultSort);
    expect(parseSort('year:zijwaarts', columns, defaultSort)).toEqual({ column: 'year', direction: 'desc' });
  });

  it('weigert een kolom die deze gebruiker niet ziet', () => {
    // De facility-rol krijgt de tankpaskolom niet mee; een handgetypte URL mag hem
    // dan ook niet alsnog als sortering activeren.
    expect(parseSort('fuel_card_reference:asc', columns, defaultSort)).toEqual(defaultSort);
  });

  it('accepteert alleen de aangeboden paginagroottes', () => {
    expect(parsePageSize('50')).toBe(50);
    expect(parsePageSize('37')).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize(null)).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize(null, 20)).toBe(20);
  });

  it('vertaalt de 1-gebaseerde URL-pagina naar een 0-gebaseerde index', () => {
    expect(parsePage('1')).toBe(0);
    expect(parsePage('3')).toBe(2);
    expect(parsePage('0')).toBe(0);
    expect(parsePage('-2')).toBe(0);
    expect(parsePage('twee')).toBe(0);
    expect(parsePage(null)).toBe(0);
  });
});

describe('applyOrder', () => {
  const builder = () => {
    const calls: Array<[string, unknown]> = [];
    const query: any = {
      calls,
      order(column: string, options?: unknown) {
        calls.push([column, options]);
        return query;
      },
    };
    return query;
  };

  it('ordent op alle targets van de kolom en zet lege waarden achteraan', () => {
    const query = applyOrder(builder(), columns[1], 'desc', []);
    expect(query.calls).toEqual([
      ['brand', { ascending: false, nullsFirst: false }],
      ['model', { ascending: false, nullsFirst: false }],
    ]);
  });

  it('voegt tiebreak-kolommen toe zodat paginering deterministisch blijft', () => {
    const query = applyOrder(builder(), columns[2], 'desc', ['license_plate', 'id']);
    expect(query.calls.map((c: [string, unknown]) => c[0])).toEqual(['year', 'license_plate', 'id']);
    expect(query.calls[1][1]).toEqual({ ascending: true, nullsFirst: false });
  });

  it('herhaalt een tiebreak niet die al de sorteerkolom is', () => {
    const query = applyOrder(builder(), columns[0], 'asc', ['license_plate', 'id']);
    expect(query.calls.map((c: [string, unknown]) => c[0])).toEqual(['license_plate', 'id']);
  });

  it('valt terug op de kolomsleutel wanneer orderBy ontbreekt', () => {
    expect(orderTargets(columns[0])).toEqual(['license_plate']);
    expect(orderTargets(columns[1])).toEqual(['brand', 'model']);
  });
});
