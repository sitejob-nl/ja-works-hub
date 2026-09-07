import { describe, expect, it } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Table, TableBody, TableHeader, TableRow } from '@/components/ui/table';
import SortableTableHead from '@/components/ui/sortable-table-head';
import { useTableControls } from '@/hooks/useTableControls';
import type { SortableColumn, SortState } from '@/lib/table-sort';

const COLUMNS: readonly SortableColumn[] = [
  { key: 'license_plate' },
  { key: 'year', defaultDirection: 'desc' },
];
const DEFAULT_SORT: SortState = { column: 'license_plate', direction: 'asc' };

type Harness = ReturnType<typeof useTableControls>;
let controls: Harness;

const Probe = ({ columns = COLUMNS }: { columns?: readonly SortableColumn[] }) => {
  controls = useTableControls({ columns, defaultSort: DEFAULT_SORT, tiebreak: ['id'] });
  const location = useLocation();
  return (
    <>
      <span data-testid="url">{location.search}</span>
      <Table>
        <TableHeader>
          <TableRow>
            <SortableTableHead column="license_plate" sort={controls.sort} onSort={controls.toggleSort}>
              Kenteken
            </SortableTableHead>
            <SortableTableHead column="year" sort={controls.sort} onSort={controls.toggleSort}>
              Bouwjaar
            </SortableTableHead>
          </TableRow>
        </TableHeader>
        <TableBody />
      </Table>
    </>
  );
};

const setup = (search = '', columns?: readonly SortableColumn[]) =>
  render(
    <MemoryRouter initialEntries={[`/transport${search}`]}>
      <Probe columns={columns} />
    </MemoryRouter>,
  );

const url = () => screen.getByTestId('url').textContent ?? '';

describe('useTableControls', () => {
  it('start op de default sortering en paginagrootte, zonder URL-ruis', () => {
    setup();
    expect(controls.sort).toEqual(DEFAULT_SORT);
    expect(controls.pageSize).toBe(10);
    expect(controls.page).toBe(0);
    expect(url()).toBe('');
  });

  it('leest sortering, paginagrootte en pagina terug uit de URL (overleeft een refresh)', () => {
    setup('?sort=year:desc&per=50&page=3');
    expect(controls.sort).toEqual({ column: 'year', direction: 'desc' });
    expect(controls.pageSize).toBe(50);
    expect(controls.page).toBe(2);
    expect(controls.from).toBe(100);
    expect(controls.to).toBe(149);
  });

  it('zet een klik op een kolomkop in de URL en draait bij de tweede klik om', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Bouwjaar' }));
    expect(url()).toContain('sort=year%3Adesc');
    expect(controls.sort).toEqual({ column: 'year', direction: 'desc' });

    fireEvent.click(screen.getByRole('button', { name: 'Bouwjaar' }));
    expect(controls.sort).toEqual({ column: 'year', direction: 'asc' });
  });

  it('haalt de sortering weer uit de URL zodra die gelijk is aan de default', () => {
    setup('?sort=year:desc');
    fireEvent.click(screen.getByRole('button', { name: 'Kenteken' }));
    expect(url()).toBe('');
    expect(controls.sort).toEqual(DEFAULT_SORT);
  });

  it('springt terug naar pagina 1 bij een andere paginagrootte', () => {
    setup('?page=4');
    expect(controls.page).toBe(3);
    act(() => controls.setPageSize(100));
    expect(controls.pageSize).toBe(100);
    expect(controls.page).toBe(0);
    expect(url()).not.toContain('page=');
  });

  it('springt terug naar pagina 1 bij een andere sortering en bij resetPage', () => {
    setup('?page=4');
    act(() => controls.toggleSort('year'));
    expect(controls.page).toBe(0);

    act(() => controls.setPage(2));
    expect(url()).toContain('page=3');
    act(() => controls.resetPage());
    expect(controls.page).toBe(0);
  });

  it('laat resetPage de URL met rust wanneer je al op pagina 1 staat', () => {
    // resetPage hangt aan elke toetsaanslag in het zoekveld; op pagina 1 valt er
    // niets te resetten en hoeft er dus ook geen nieuwe URL geschreven te worden.
    setup('?sort=year:desc');
    act(() => controls.resetPage());
    // Onaangeroerd: de URL is niet eens opnieuw geserialiseerd.
    expect(url()).toBe('?sort=year:desc');
    expect(controls.page).toBe(0);
  });

  it('toont de actieve kolom en richting in de kop', () => {
    setup('?sort=year:desc');
    const heads = screen.getAllByRole('columnheader');
    expect(heads[0]).toHaveAttribute('aria-sort', 'none');
    expect(heads[1]).toHaveAttribute('aria-sort', 'descending');

    fireEvent.click(screen.getByRole('button', { name: 'Bouwjaar' }));
    expect(screen.getAllByRole('columnheader')[1]).toHaveAttribute('aria-sort', 'ascending');
  });

  it('maakt een verborgen kolom niet sorteerbaar, ook niet via de URL', () => {
    // Zoals de facility-rol: die krijgt de bouwjaarkolom hier niet mee.
    setup('?sort=year:desc', [COLUMNS[0]]);
    expect(controls.sort).toEqual(DEFAULT_SORT);

    act(() => controls.toggleSort('year'));
    expect(controls.sort).toEqual(DEFAULT_SORT);
  });

  it('valt terug op de eerste zichtbare kolom als de default-kolom verborgen is', () => {
    setup('', [COLUMNS[1]]);
    expect(controls.sort).toEqual({ column: 'year', direction: 'desc' });
  });
});
