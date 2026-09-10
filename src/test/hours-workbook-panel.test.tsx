import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HoursWorkbookReading } from '@/components/hours-workflow/HoursWorkbookReading';
import { HOURS_READING_MAX_ENTRIES, type WorkbookCandidate, type WorkbookReading } from '@/lib/hours-workbook';

const candidate = (index: number): WorkbookCandidate => ({
  dayId: `day-${index}`, memberId: `member-${index}`, employeeName: `Medewerker ${index}`,
  workDate: '2026-09-07', minutes: 480, noHoursReason: null, sourceInput: null,
  pageNumber: 1, pageLabel: `blad Week 37 · rij ${index + 2}`, sheetName: 'Week 37', row: index + 2,
  assignmentUncertain: false, employeeText: `Medewerker ${index}`, notices: [],
});

const reading = (count: number): WorkbookReading => ({
  ok: true, sourceKind: 'workbook',
  candidates: Array.from({ length: count }, (_, index) => candidate(index)),
  skipped: [], rowTotals: [], sheetsRead: ['Week 37'], sheetsIgnored: [],
});

afterEach(cleanup);

describe('choosing what to record out of a reading', () => {
  it('refuses more rows at once than the server accepts, instead of failing the whole reading', () => {
    // The bound is injected so the case stays small; production uses the shared
    // constant that the RPC enforces too.
    const onSave = vi.fn();
    render(<HoursWorkbookReading reading={reading(3)} maxEntries={2}
      alreadyProposed={new Set()} onCancel={() => {}} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: '3 voorstellen bewaren' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Er kunnen maximaal 2 regels in één keer worden bewaard.');
  });

  it('records a selection that fits', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<HoursWorkbookReading reading={reading(2)}
      alreadyProposed={new Set()} onCancel={() => {}} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: '2 voorstellen bewaren' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  });
});

describe('narrowing down a large reading', () => {
  it('lets the reviewer clear the whole selection in one act', () => {
    const onSave = vi.fn();
    render(<HoursWorkbookReading reading={reading(3)}
      alreadyProposed={new Set()} onCancel={() => {}} onSave={onSave} />);

    expect(screen.getByText('3 van 3 gekozen.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Alles uitvinken' }));
    expect(screen.getByText('0 van 3 gekozen.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Alles aanvinken' }));
    expect(screen.getByText('3 van 3 gekozen.')).toBeInTheDocument();
  });
});

describe('a reading that does not fit in one handling', () => {
  it('offers a way to narrow it down to what the server accepts', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<HoursWorkbookReading reading={reading(5)} maxEntries={2}
      alreadyProposed={new Set()} onCancel={() => {}} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Beperk tot de eerste 2' }));
    expect(screen.getByText('2 van 5 gekozen.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2 voorstellen bewaren' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toHaveLength(2);
  });

  it('uses the same bound the server enforces when none is given', () => {
    render(<HoursWorkbookReading reading={reading(2)}
      alreadyProposed={new Set()} onCancel={() => {}} onSave={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Beperk tot de eerste/ })).not.toBeInTheDocument();
    expect(HOURS_READING_MAX_ENTRIES).toBe(500);
  });
});
