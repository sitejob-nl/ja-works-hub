import { describe, expect, it } from 'vitest';
import {
  HOURS_SCAN_MAX_ENTRIES, interpretScanReading, type ScanContext, type ScanReading,
} from '../../supabase/functions/_shared/hours-scan';

const MEMBER_A = '11111111-1111-4111-8111-111111111111';
const MEMBER_B = '22222222-2222-4222-8222-222222222222';
const DAY_A_MON = 'aaaaaaa1-1111-4111-8111-111111111111';
const DAY_A_TUE = 'aaaaaaa2-1111-4111-8111-111111111111';
const DAY_B_MON = 'bbbbbbb1-1111-4111-8111-111111111111';

const context = (overrides: Partial<ScanContext> = {}): ScanContext => ({
  members: [{ id: MEMBER_A, name: 'Jan Kowalski' }, { id: MEMBER_B, name: 'Piet de Vries' }],
  days: [
    { id: DAY_A_MON, memberId: MEMBER_A, workDate: '2026-09-07' },
    { id: DAY_A_TUE, memberId: MEMBER_A, workDate: '2026-09-08' },
    { id: DAY_B_MON, memberId: MEMBER_B, workDate: '2026-09-07' },
  ],
  pageCount: 2,
  ...overrides,
});

const entry = (overrides: Record<string, unknown> = {}) => ({
  employee_text: 'Jan Kowalski', work_date: '2026-09-07', page_number: 1,
  location_text: 'regel 3', total_text: '8:00', ...overrides,
});

const read = (entries: unknown[], overrides: Partial<ScanContext> = {}): ScanReading =>
  interpretScanReading({ entries }, context(overrides));

const ok = (reading: ScanReading) => {
  if (reading.ok === false) throw new Error(`unexpected blockade: ${reading.issues.map(i => i.code).join(', ')}`);
  return reading;
};

describe('scan reading — the delivered shape', () => {
  it('refuses anything that is not the agreed result shape', () => {
    for (const value of [null, 'text', 42, [], { entries: null }, { entries: {} }, {}]) {
      const reading = interpretScanReading(value, context());
      expect(reading.ok, JSON.stringify(value)).toBe(false);
    }
  });

  it('refuses an entry carrying a field the contract does not have', () => {
    const reading = read([entry({ confidence: 0.99 })]);
    expect(reading.ok).toBe(false);
  });

  it('refuses an uncertainty label it does not know, rather than dropping the doubt', () => {
    const reading = read([entry({ uncertain: ['handwriting'] })]);
    expect(reading.ok).toBe(false);
  });

  it('refuses a reading larger than one handling can record', () => {
    const many = Array.from({ length: HOURS_SCAN_MAX_ENTRIES * 2 + 1 }, () => entry());
    expect(interpretScanReading({ entries: many }, context()).ok).toBe(false);
  });

  it('blocks the whole reading when one work day is read twice', () => {
    const reading = read([entry({ location_text: 'regel 3' }), entry({ location_text: 'regel 9' })]);
    expect(reading.ok).toBe(false);
    if (reading.ok === false) {
      expect(reading.issues[0].code).toBe('DUPLICATE_SCAN_DAY');
      expect(reading.issues[0].message).toContain('regel 3');
      expect(reading.issues[0].message).toContain('regel 9');
    }
  });
});

describe('scan reading — who the reader may not decide', () => {
  it('accepts an exactly written name as certain', () => {
    const reading = ok(read([entry()]));
    expect(reading.candidates).toHaveLength(1);
    expect(reading.candidates[0].memberId).toBe(MEMBER_A);
    expect(reading.candidates[0].assignmentUncertain).toBe(false);
  });

  it('records a partial but unique name as an uncertain assignment', () => {
    const reading = ok(read([entry({ employee_text: 'J. Kowalski' })]));
    expect(reading.candidates[0].assignmentUncertain).toBe(true);
    expect(reading.candidates[0].employeeText).toBe('J. Kowalski');
  });

  it('makes no proposal for a name that fits nobody', () => {
    const reading = ok(read([entry({ employee_text: 'Karel Appel' })]));
    expect(reading.candidates).toHaveLength(0);
    expect(reading.skipped[0].text).toBe('Karel Appel');
  });

  it('makes no proposal for a name that fits several people', () => {
    const reading = ok(read([entry({ employee_text: 'de Vries' })], {
      members: [{ id: MEMBER_A, name: 'Jan de Vries' }, { id: MEMBER_B, name: 'Piet de Vries' }],
      days: [{ id: DAY_A_MON, memberId: MEMBER_A, workDate: '2026-09-07' },
             { id: DAY_B_MON, memberId: MEMBER_B, workDate: '2026-09-07' }],
    }));
    expect(reading.candidates).toHaveLength(0);
  });

  it('carries the model’s own doubt about the employee into an uncertain assignment', () => {
    const reading = ok(read([entry({ uncertain: ['employee'] })]));
    expect(reading.candidates[0].assignmentUncertain).toBe(true);
    expect(reading.candidates[0].uncertainFields).toEqual([]);
  });

  it('makes no proposal at all when the model is unsure which day it read', () => {
    const reading = ok(read([entry({ uncertain: ['date'] })]));
    expect(reading.candidates).toHaveLength(0);
    expect(reading.skipped[0].reason).toContain('datum');
  });

  it('makes no proposal for a date outside this employee’s week', () => {
    expect(ok(read([entry({ work_date: '2026-09-14' })])).candidates).toHaveLength(0);
    expect(ok(read([entry({ employee_text: 'Piet de Vries', work_date: '2026-09-08' })])).candidates).toHaveLength(0);
  });
});

describe('scan reading — pages', () => {
  it('keeps the page and the location as the place it was found', () => {
    const reading = ok(read([entry({ page_number: 2, location_text: 'blok rechtsboven' })]));
    expect(reading.candidates[0].pageNumber).toBe(2);
    expect(reading.candidates[0].pageLabel).toBe('blok rechtsboven');
    expect(reading.pagesRead).toEqual([2]);
  });

  it('makes no proposal for a page the delivered file does not have', () => {
    expect(ok(read([entry({ page_number: 3 })])).candidates).toHaveLength(0);
    expect(ok(read([entry({ page_number: 0 })])).candidates).toHaveLength(0);
  });

  it('accepts any page number when the page count could not be established', () => {
    expect(ok(read([entry({ page_number: 3 })], { pageCount: null })).candidates).toHaveLength(1);
  });

  it('names the pages the model could not read', () => {
    const reading = ok(interpretScanReading(
      { entries: [entry()], unreadable: [{ page_number: 2, reason: 'te donker' }] }, context()));
    expect(reading.pagesUnread).toEqual([{ pageNumber: 2, reason: 'te donker' }]);
  });
});

describe('scan reading — hours are never invented', () => {
  it('makes no proposal when there is no readable duration and no reason', () => {
    const reading = ok(read([entry({ total_text: null })]));
    expect(reading.candidates).toHaveLength(0);
    expect(reading.skipped[0].reason).toContain('geen');
  });

  it('lets no certainty score rescue a missing duration', () => {
    const reading = ok(read([entry({ total_text: null, uncertain: [] })]));
    expect(reading.candidates).toHaveLength(0);
  });

  it('makes no proposal for a duration it cannot read', () => {
    const reading = ok(read([entry({ total_text: 'acht uur' })]));
    expect(reading.candidates).toHaveLength(0);
    expect(reading.skipped[0].reason).toContain('acht uur');
  });

  it('reads 8,5 and 8:30 as the same duration', () => {
    expect(ok(read([entry({ total_text: '8,5' })])).candidates[0].minutes).toBe(510);
    expect(ok(read([entry({ total_text: '8:30' })])).candidates[0].minutes).toBe(510);
  });

  it('refuses a bare zero, because no hours needs a reason', () => {
    expect(ok(read([entry({ total_text: '0' })])).candidates).toHaveLength(0);
    expect(ok(read([entry({ total_text: '0:00' })])).candidates).toHaveLength(0);
  });

  it('takes an explicit reason as no hours', () => {
    const reading = ok(read([entry({ total_text: null, no_hours_text: 'ziek gemeld' })]));
    expect(reading.candidates[0].minutes).toBe(0);
    expect(reading.candidates[0].noHoursReason).toBe('ziek gemeld');
  });

  it('does not take a dash or a cross as a reason', () => {
    for (const text of ['-', 'x', '.', 'n.v.t.', 'nvt']) {
      const reading = ok(read([entry({ total_text: null, no_hours_text: text })]));
      expect(reading.candidates, text).toHaveLength(0);
    }
  });

  it('makes no proposal when hours and a no-hours reason contradict each other', () => {
    const reading = ok(read([entry({ total_text: '8:00', no_hours_text: 'ziek' })]));
    expect(reading.candidates).toHaveLength(0);
    expect(reading.skipped[0].reason).toContain('tegen');
  });
});

describe('scan reading — shifts and handwritten breaks', () => {
  it('keeps start, end and a written break window as the delivered breakdown', () => {
    const reading = ok(read([entry({
      total_text: '8:00', start_text: '07:00', end_text: '15:30', break_text: '12:00-12:30',
    })]));
    const candidate = reading.candidates[0];
    expect(candidate.sourceInput?.shifts).toEqual([
      { start: '07:00', end: '15:30', endDayOffset: 0, breaks: [{ start: '12:00', end: '12:30', startDayOffset: 0, endDayOffset: 0 }] },
    ]);
    expect(candidate.uncertainFields).toEqual([]);
  });

  it('reads several written break windows', () => {
    const reading = ok(read([entry({
      total_text: '7:45', start_text: '07:00', end_text: '15:30', break_text: '12:00-12:30, 15:00-15:15',
    })]));
    expect(reading.candidates[0].sourceInput?.shifts?.[0].breaks).toHaveLength(2);
  });

  it('records a break written only as a duration without inventing when it fell', () => {
    const reading = ok(read([entry({
      total_text: '8:00', start_text: '07:00', end_text: '15:30', break_text: '30',
    })]));
    const candidate = reading.candidates[0];
    expect(candidate.sourceInput?.shifts).toBeUndefined();
    expect(candidate.readText.break).toBe('30');
    expect(candidate.uncertainFields).toEqual([]);
  });

  it('shows the difference when a duration-only break does not add up to the written total', () => {
    const reading = ok(read([entry({
      total_text: '8:00', start_text: '07:00', end_text: '15:00', break_text: '30',
    })]));
    const candidate = reading.candidates[0];
    expect(candidate.minutes).toBe(480);
    expect(candidate.uncertainFields).toContain('total');
    expect(candidate.notices.some(notice => notice.code === 'TOTAL_MISMATCH')).toBe(true);
  });

  it('lets no certainty score overrule a sum that does not close', () => {
    const reading = ok(read([entry({
      total_text: '8:00', start_text: '07:00', end_text: '15:00', break_text: '12:00-12:30', uncertain: [],
    })]));
    expect(reading.candidates[0].uncertainFields).toContain('total');
    expect(reading.candidates[0].notices.some(notice => notice.code === 'TOTAL_MISMATCH')).toBe(true);
  });

  it('leaves a half-read shift out of the breakdown and says so', () => {
    const reading = ok(read([entry({ total_text: '8:00', start_text: '07:00' })]));
    const candidate = reading.candidates[0];
    expect(candidate.sourceInput).toBeNull();
    expect(candidate.notices.some(notice => notice.code === 'INCOMPLETE_SCAN_SHIFT')).toBe(true);
    expect(candidate.minutes).toBe(480);
  });

  it('marks an end time before the start as an uncertain shift instead of silently crossing midnight', () => {
    const reading = ok(read([entry({
      total_text: '8:00', start_text: '22:00', end_text: '06:30', break_text: '02:00-02:30',
    })]));
    const candidate = reading.candidates[0];
    expect(candidate.sourceInput?.shifts?.[0].endDayOffset).toBe(1);
    expect(candidate.uncertainFields).toContain('shift');
  });

  it('marks an unreadable break as uncertain and keeps the shift out', () => {
    const reading = ok(read([entry({
      total_text: '8:00', start_text: '07:00', end_text: '15:30', break_text: 'half uurtje',
    })]));
    const candidate = reading.candidates[0];
    expect(candidate.uncertainFields).toContain('break');
    expect(candidate.sourceInput).toBeNull();
  });
});

describe('scan reading — delivered categories', () => {
  it('keeps source codes literally', () => {
    const reading = ok(read([entry({
      total_text: '9:00', categories: [{ code_text: 'OV1', duration_text: '8:00' }, { code_text: 'OV3', duration_text: '1:00' }],
    })]));
    expect(reading.candidates[0].sourceInput?.categories).toEqual([
      { sourceCode: 'OV1', minutes: 480 }, { sourceCode: 'OV3', minutes: 60 },
    ]);
    expect(reading.candidates[0].uncertainFields).toEqual([]);
  });

  it('shows the difference when the categories do not add up to the day', () => {
    const reading = ok(read([entry({
      total_text: '8:00', categories: [{ code_text: 'OV1', duration_text: '4:00' }, { code_text: 'OV3', duration_text: '5:00' }],
    })]));
    expect(reading.candidates[0].uncertainFields).toContain('total');
    expect(reading.candidates[0].notices.some(notice => notice.code === 'TOTAL_MISMATCH')).toBe(true);
  });

  it('drops a partly unreadable breakdown rather than proposing half of it', () => {
    const reading = ok(read([entry({
      total_text: '8:00', categories: [{ code_text: 'OV1', duration_text: '8:00' }, { code_text: 'OV3', duration_text: 'onleesbaar' }],
    })]));
    const candidate = reading.candidates[0];
    expect(candidate.sourceInput).toBeNull();
    expect(candidate.uncertainFields).toContain('categories');
    expect(candidate.notices.some(notice => notice.message.includes('onleesbaar'))).toBe(true);
  });

  it('never combines no hours with a delivered breakdown', () => {
    const reading = ok(read([entry({
      total_text: null, no_hours_text: 'vrij', categories: [{ code_text: 'OV1', duration_text: '1:00' }],
    })]));
    expect(reading.candidates[0].sourceInput).toBeNull();
  });
});

describe('scan reading — what the model itself reported as unsure', () => {
  it('carries each reported uncertain field into the proposal', () => {
    const reading = ok(read([entry({ uncertain: ['total'] })]));
    expect(reading.candidates[0].uncertainFields).toEqual(['total']);
  });

  it('reports every uncertain field only once and in a fixed order', () => {
    const reading = ok(read([entry({
      total_text: '8:00', start_text: '07:00', end_text: '15:00', break_text: '30',
      uncertain: ['break', 'total', 'break'],
    })]));
    expect(reading.candidates[0].uncertainFields).toEqual(['total', 'break']);
  });
});
