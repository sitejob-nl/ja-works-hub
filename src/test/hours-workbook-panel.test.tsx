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
  ok: true, candidates: Array.from({ length: count }, (_, index) => candidate(index)),
  skipped: [], rowTotals: [], sheetsRead: ['Week 37'], sheetsIgnored: [],
});

afterEach(cleanup);

describe('choosing what to record out of a reading', () => {
  it('refuses more rows at once than the server accepts, instead of failing the whole reading', () => {
    const onSave = vi.fn();
    render(<HoursWorkbookReading reading={reading(HOURS_READING_MAX_ENTRIES + 1)}
      alreadyProposed={new Set()} onCancel={() => {}} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: /voorstellen bewaren/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      `Er kunnen maximaal ${HOURS_READING_MAX_ENTRIES} regels in één keer worden bewaard.`);
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
