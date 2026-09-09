import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HoursScanReading } from '@/components/hours-workflow/HoursScanReading';
import type { ScanCandidate, ScanReading } from '../../supabase/functions/_shared/hours-scan';

const candidate = (overrides: Partial<ScanCandidate> = {}): ScanCandidate => ({
  dayId: 'day-1', memberId: 'member-1', employeeName: 'Jan Kowalski', workDate: '2026-09-07',
  minutes: 480, noHoursReason: null, sourceInput: null, pageNumber: 1, pageLabel: 'rij 3',
  assignmentUncertain: false, uncertainFields: [], employeeText: 'Jan Kowalski',
  readText: { total: '8:00', start: null, end: null, break: null }, notices: [], ...overrides,
});

const reading = (overrides: Partial<Extract<ScanReading, { ok: true }>> = {}): ScanReading => ({
  ok: true, candidates: [candidate()], skipped: [], pagesRead: [1], pagesUnread: [], ...overrides,
});

const cost = { costCents: 2, balanceCents: 4876, model: 'gemini-3.5-flash', durationMs: 900 };

afterEach(cleanup);

describe('what a reading shows before anything is recorded', () => {
  it('says plainly that this is not hours yet', () => {
    render(<HoursScanReading reading={reading()} {...cost}
      alreadyProposed={new Set()} onCancel={() => {}} onSave={vi.fn()} />);
    expect(screen.getByText(/nog geen uren/i)).toBeInTheDocument();
  });

  it('shows what it read literally, next to what it made of it', () => {
    render(<HoursScanReading {...cost}
      reading={reading({ candidates: [candidate({
        minutes: 450, readText: { total: '7,5', start: '07:00', end: '15:00', break: '30' },
      })] })}
      alreadyProposed={new Set()} onCancel={() => {}} onSave={vi.fn()} />);
    expect(screen.getByText(/7:30 uur/)).toBeInTheDocument();
    expect(screen.getByText(/Gelezen: totaal “7,5” · begin “07:00” · eind “15:00” · pauze “30”/))
      .toBeInTheDocument();
  });

  it('names what the reading was unsure of, in words about the paper', () => {
    render(<HoursScanReading {...cost}
      reading={reading({ candidates: [candidate({ uncertainFields: ['total', 'break'] })] })}
      alreadyProposed={new Set()} onCancel={() => {}} onSave={vi.fn()} />);
    expect(screen.getByText(/het aantal uren en de pauze/)).toBeInTheDocument();
  });

  it('says a sum that does not close, with both numbers', () => {
    render(<HoursScanReading {...cost}
      reading={reading({ candidates: [candidate({
        uncertainFields: ['total'],
        notices: [{ code: 'TOTAL_MISMATCH', message: 'De gelezen diensttijd wijkt af van het opgeschreven totaal.',
          expectedMinutes: 450, actualMinutes: 480 }],
      })] })}
      alreadyProposed={new Set()} onCancel={() => {}} onSave={vi.fn()} />);
    expect(screen.getByText(
      /De delen zijn samen 7:30 uur, het opgeschreven totaal is 8:00 uur\./)).toBeInTheDocument();
  });

  it('reports what this reading cost', () => {
    render(<HoursScanReading reading={reading()} {...cost}
      alreadyProposed={new Set()} onCancel={() => {}} onSave={vi.fn()} />);
    expect(screen.getByText(/€ 0,02/)).toBeInTheDocument();
  });

  it('names the lines it deliberately left alone', () => {
    render(<HoursScanReading {...cost}
      reading={reading({ skipped: [{ pageNumber: 2, text: 'Karel Appel · rij 9',
        reason: 'Deze naam past bij niemand of bij meerdere medewerkers van deze week.' }] })}
      alreadyProposed={new Set()} onCancel={() => {}} onSave={vi.fn()} />);
    expect(screen.getByText(/Karel Appel/)).toBeInTheDocument();
    expect(screen.getByText(/past bij niemand/)).toBeInTheDocument();
  });

  it('names the pages it could not read, so half a delivery does not pass unnoticed', () => {
    render(<HoursScanReading {...cost}
      reading={reading({ pagesUnread: [{ pageNumber: 2, reason: 'te donker' }] })}
      alreadyProposed={new Set()} onCancel={() => {}} onSave={vi.fn()} />);
    expect(screen.getByText(/pagina 2/i)).toBeInTheDocument();
    expect(screen.getByText(/te donker/)).toBeInTheDocument();
  });

  it('shows a blocked reading as a blockade, with the cost that was still incurred', () => {
    render(<HoursScanReading {...cost}
      reading={{ ok: false, issues: [{ code: 'DUPLICATE_SCAN_DAY', message: 'Deze bron beschrijft dezelfde werkdag tweemaal.' }] }}
      alreadyProposed={new Set()} onCancel={() => {}} onSave={vi.fn()} />);
    expect(screen.getByText(/dezelfde werkdag tweemaal/)).toBeInTheDocument();
    expect(screen.getByText(/geen voorstellen/i)).toBeInTheDocument();
    expect(screen.getByText(/€ 0,02/)).toBeInTheDocument();
  });
});

describe('recording a reading as proposals', () => {
  it('carries the recorded doubt into what is saved', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<HoursScanReading {...cost}
      reading={reading({ candidates: [candidate({ uncertainFields: ['total'], assignmentUncertain: true })] })}
      alreadyProposed={new Set()} onCancel={() => {}} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: '1 voorstel bewaren' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toEqual([{
      day_id: 'day-1', minutes: 480, no_hours_reason: null, source_input: null,
      page_number: 1, page_label: 'rij 3', assignment_uncertain: true, uncertain_fields: ['total'],
    }]);
  });

  it('sends no doubt at all when the reading had none', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<HoursScanReading reading={reading()} {...cost}
      alreadyProposed={new Set()} onCancel={() => {}} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '1 voorstel bewaren' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0][0].uncertain_fields).toBeNull();
  });

  it('leaves a day that already has a proposal from this source unticked', () => {
    render(<HoursScanReading {...cost}
      reading={reading({ candidates: [candidate(), candidate({ dayId: 'day-2', workDate: '2026-09-08' })] })}
      alreadyProposed={new Set(['day-2'])} onCancel={() => {}} onSave={vi.fn()} />);
    expect(screen.getByText('1 van 2 gekozen.')).toBeInTheDocument();
  });

  it('refuses more rows at once than the server accepts', () => {
    const onSave = vi.fn();
    render(<HoursScanReading {...cost}
      reading={reading({ candidates: [candidate(), candidate({ dayId: 'day-2' }), candidate({ dayId: 'day-3' })] })}
      maxEntries={2} alreadyProposed={new Set()} onCancel={() => {}} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '3 voorstellen bewaren' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('maximaal 2 regels');
  });
});
