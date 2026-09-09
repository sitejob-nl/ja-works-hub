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

  it('sets both halves of a work day read twice aside, naming both places', () => {
    const reading = ok(read([entry({ location_text: 'regel 3' }), entry({ location_text: 'regel 9' })]));
    expect(reading.candidates).toHaveLength(0);
    const message = reading.skipped.map(line => line.reason).join(' ');
    expect(message).toContain('regel 3');
    expect(message).toContain('regel 9');
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
    // The shift was read and deliberately left out, which is something to check.
    expect(candidate.uncertainFields).toEqual(['shift']);
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
    expect(reading.candidates[0].uncertainFields).toEqual(['total', 'shift', 'break']);
  });
});

describe('scan reading — what the review round found', () => {
  it('places a break window on the day the shift is actually on', () => {
    // The stored breakdown has to survive the calculation kernel: a break at
    // 02:00 on a shift that started at 22:00 belongs to the next day, and
    // stamping it as day 0 puts it twenty hours before the shift began.
    const reading = ok(read([entry({
      total_text: '8:00', start_text: '22:00', end_text: '06:30', break_text: '02:00-02:30',
    })]));
    const candidate = reading.candidates[0];
    expect(candidate.sourceInput?.shifts?.[0].breaks).toEqual([
      { start: '02:00', end: '02:30', startDayOffset: 1, endDayOffset: 1 },
    ]);
    expect(candidate.notices.some(notice => notice.code === 'BREAK_OUTSIDE_SHIFT')).toBe(false);
  });

  it('keeps a break window that is still on the first day of a night shift', () => {
    const reading = ok(read([entry({
      total_text: '8:00', start_text: '22:00', end_text: '06:30', break_text: '23:00-23:30',
    })]));
    expect(reading.candidates[0].sourceInput?.shifts?.[0].breaks).toEqual([
      { start: '23:00', end: '23:30', startDayOffset: 0, endDayOffset: 0 },
    ]);
  });

  it('marks a breakdown the calculation kernel rejects as uncertain, not merely as a note', () => {
    // A contradiction that only lives in notices never reaches the proposal, so
    // it would be applied blind and leave a day that can never be classified.
    const reading = ok(read([entry({
      total_text: '8:30', start_text: '08:00', end_text: '17:00', break_text: '18:00-18:30',
    })]));
    const candidate = reading.candidates[0];
    expect(candidate.notices.some(notice => notice.code === 'BREAK_OUTSIDE_SHIFT')).toBe(true);
    expect(candidate.uncertainFields.length).toBeGreaterThan(0);
  });

  it('names the shift it left out when only the break duration was written', () => {
    const reading = ok(read([entry({
      total_text: '8:00', start_text: '07:00', end_text: '15:30', break_text: '30',
    })]));
    const candidate = reading.candidates[0];
    expect(candidate.sourceInput).toBeNull();
    expect(candidate.notices.some(notice => notice.code === 'INCOMPLETE_SCAN_SHIFT')).toBe(true);
  });

  it('reports a total that does not add up exactly once', () => {
    const reading = ok(read([entry({ total_text: '8:00', start_text: '07:00', end_text: '16:00' })]));
    const mismatches = reading.candidates[0].notices.filter(notice => notice.code === 'TOTAL_MISMATCH');
    expect(mismatches).toHaveLength(1);
  });

  it('lets a line it skipped free the work day for the line that follows it', () => {
    const reading = ok(read([
      entry({ total_text: 'ca 8', location_text: 'regel 3' }),
      entry({ total_text: '8:00', location_text: 'regel 9' }),
    ]));
    expect(reading.candidates).toHaveLength(1);
    expect(reading.candidates[0].pageLabel).toBe('regel 9');
    expect(reading.skipped).toHaveLength(1);
  });

  it('skips a line the model filled in badly instead of discarding the whole reading', () => {
    for (const broken of [{ employee_text: '' }, { work_date: 'maandag' }, { work_date: '2026-13-45' },
      { location_text: 'x'.repeat(400) }, { page_number: 3000 }]) {
      const reading = ok(read([entry(broken), entry({ work_date: '2026-09-08', location_text: 'regel 9' })],
        { pageCount: null }));
      expect(reading.candidates, JSON.stringify(broken)).toHaveLength(1);
      expect(reading.skipped, JSON.stringify(broken)).toHaveLength(1);
    }
  });

  it('still refuses a result whose shape breaks the contract outright', () => {
    expect(read([entry({ verzonnen: 1 })]).ok).toBe(false);
    expect(read([entry({ uncertain: ['handschrift'] })]).ok).toBe(false);
  });

  it('treats every dash and cross as nothing written, whichever glyph was used', () => {
    for (const marker of ['-', '–', '—', '−', 'x', 'X', '.', 'n.v.t.']) {
      const reading = ok(read([entry({ total_text: null, no_hours_text: marker })]));
      expect(reading.candidates, marker).toHaveLength(0);
    }
  });

  it('does not choose between two readings of a dotted total', () => {
    // 7.30 is either seven hours eighteen or half past seven; nothing in the
    // paper says which, so the reader says both and asks.
    const reading = ok(read([entry({ total_text: '7.30' })]));
    const candidate = reading.candidates[0];
    expect(candidate.uncertainFields).toContain('total');
    expect(candidate.notices.some(notice => notice.code === 'AMBIGUOUS_SCAN_TOTAL')).toBe(true);
  });

  it('leaves an unambiguous dotted total alone', () => {
    // 8.00 reads the same either way, and 7,5 is Dutch decimal notation.
    expect(ok(read([entry({ total_text: '8.00' })])).candidates[0].uncertainFields).toEqual([]);
    expect(ok(read([entry({ total_text: '7,5' })])).candidates[0].uncertainFields).toEqual([]);
  });

  it('keeps doubt about a field that came back empty, because empty means unreadable', () => {
    // The model returns an empty string for a cell it could not read and says so
    // in `uncertain`. Dropping that doubt would turn "I could not read the break"
    // into the assertion that there was none.
    const reading = ok(read([entry({ total_text: '8:00', start_text: '07:00', end_text: '15:00',
      uncertain: ['break'] })]));
    expect(reading.candidates[0].uncertainFields).toContain('break');
    expect(reading.candidates[0].sourceInput?.shifts?.[0].breaks,
      'a shift may not claim there were no breaks while the break was unreadable').toBeUndefined();
    expect(reading.candidates[0].sourceInput).toBeNull();
  });

  it('keeps reported doubt about a field the proposal does carry', () => {
    const reading = ok(read([entry({
      total_text: '8:00', start_text: '07:00', end_text: '15:00', break_text: '12:00-12:30',
      uncertain: ['break'],
    })]));
    expect(reading.candidates[0].uncertainFields).toContain('break');
  });

  it('does not read a start equal to the end as a full day', () => {
    const reading = ok(read([entry({ total_text: '8:00', start_text: '08:00', end_text: '08:00' })]));
    const candidate = reading.candidates[0];
    expect(candidate.sourceInput).toBeNull();
    expect(candidate.notices.some(notice => notice.code === 'INCOMPLETE_SCAN_SHIFT')).toBe(true);
  });

  it('refuses a reading larger than one handling can record, for the right reason', () => {
    const many = Array.from({ length: HOURS_SCAN_MAX_ENTRIES + 1 }, (_, index) =>
      entry({ employee_text: `Medewerker ${index}` }));
    const reading = interpretScanReading({ entries: many }, context());
    expect(reading.ok).toBe(false);
    if (reading.ok === false) expect(reading.issues[0].code).toBe('SCAN_TOO_LARGE');
  });

  it('says which pages it could not read, in the shape the panel expects', () => {
    for (const bad of [{ unreadable: 'nee' }, { unreadable: [{ page_number: 'twee', reason: 'x' }] },
      { unreadable: [{ page_number: 2 }] }]) {
      expect(interpretScanReading({ entries: [], ...bad }, context()).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('names a delivered breakdown it refused to attach to a day without hours', () => {
    const reading = ok(read([entry({
      total_text: null, no_hours_text: 'vrij', categories: [{ code_text: 'OV1', duration_text: '1:00' }],
    })]));
    expect(reading.candidates[0].notices.some(notice => notice.code === 'INVALID_ZERO_SOURCE')).toBe(true);
  });
});

describe('scan reading — what the second review round found', () => {
  it('places a break that spans midnight on both sides of it', () => {
    const reading = ok(read([entry({
      total_text: '7:30', start_text: '22:00', end_text: '06:00', break_text: '23:45-00:15',
    })]));
    expect(reading.candidates[0].sourceInput?.shifts?.[0].breaks).toEqual([
      { start: '23:45', end: '00:15', startDayOffset: 0, endDayOffset: 1 },
    ]);
    expect(reading.candidates[0].notices.some(notice => notice.code === 'BREAK_OUTSIDE_SHIFT')).toBe(false);
  });

  it('works out the day total from the times when the paper wrote no total', () => {
    // A timesheet that only records "van 07:00 tot 15:30, pauze 30" is the most
    // ordinary shape there is. Adding it up is reading what is written, not
    // guessing at what is missing.
    const reading = ok(read([entry({
      total_text: null, start_text: '07:00', end_text: '15:30', break_text: '30',
    })]));
    const candidate = reading.candidates[0];
    expect(candidate.minutes).toBe(480);
    expect(candidate.notices.some(notice => notice.code === 'SCAN_TOTAL_DERIVED')).toBe(true);
    // The times were read and add up; the shift itself could not be stored,
    // because a bare break duration says how long but not when.
    expect(candidate.uncertainFields).toEqual(['shift']);
    expect(candidate.notices.some(notice => notice.code === 'TOTAL_MISMATCH')).toBe(false);
  });

  it('stores the shift and leaves nothing to check when the break was a window', () => {
    const reading = ok(read([entry({
      total_text: null, start_text: '07:00', end_text: '15:30', break_text: '12:00-12:30',
    })]));
    const candidate = reading.candidates[0];
    expect(candidate.minutes).toBe(480);
    expect(candidate.sourceInput?.shifts?.[0].breaks).toHaveLength(1);
    expect(candidate.uncertainFields).toEqual([]);
  });

  it('still makes no proposal when neither a total nor usable times were written', () => {
    expect(ok(read([entry({ total_text: null, start_text: '07:00' })])).candidates).toHaveLength(0);
  });

  it('reads a break written as nothing, as a decimal, or as a list of windows', () => {
    const minutesOf = (breakText: string) => {
      const reading = ok(read([entry({
        total_text: null, start_text: '08:00', end_text: '17:00', break_text: breakText,
      })]));
      return reading.candidates[0]?.minutes ?? null;
    };
    expect(minutesOf('-'), 'a dash means there was no break').toBe(540);
    expect(minutesOf('n.v.t.')).toBe(540);
    expect(minutesOf('0,5'), 'half an hour written the Dutch way').toBe(510);
    expect(minutesOf('30')).toBe(510);
    expect(minutesOf('12:00-12:30')).toBe(510);
    expect(minutesOf('12:00-12:15, 15:00-15:15')).toBe(510);
  });

  it('names a shift it dropped as something to check, not only as a note', () => {
    for (const line of [{ total_text: '8:00', start_text: '07:00' },
      { total_text: '8:00', start_text: '08:00', end_text: '08:00' }]) {
      const reading = ok(read([entry(line)]));
      expect(reading.candidates[0].uncertainFields, JSON.stringify(line)).toContain('shift');
    }
  });

  it('names a breakdown it refused to attach to a day without hours', () => {
    const reading = ok(read([entry({
      total_text: null, no_hours_text: 'vrij', categories: [{ code_text: 'OV1', duration_text: '1:00' }],
    })]));
    expect(reading.candidates[0].uncertainFields).toContain('categories');
  });

  it('skips both halves of a day that was read twice, and keeps the rest of the reading', () => {
    const reading = ok(read([
      entry({ location_text: 'rij 1' }),
      entry({ location_text: 'rij 9' }),
      entry({ work_date: '2026-09-08', location_text: 'rij 12' }),
    ]));
    expect(reading.candidates).toHaveLength(1);
    expect(reading.candidates[0].workDate).toBe('2026-09-08');
    expect(reading.skipped.some(line => line.reason.includes('tweemaal'))).toBe(true);
  });

  it('skips a line without a usable page instead of refusing the whole reading', () => {
    const reading = ok(read([
      { employee_text: 'Jan Kowalski', work_date: '2026-09-07', location_text: 'rij 1', total_text: '8:00' },
      entry({ work_date: '2026-09-08', location_text: 'rij 9' }),
    ]));
    expect(reading.candidates).toHaveLength(1);
    expect(reading.skipped).toHaveLength(1);
  });
});

describe('scan reading — what the third review round found', () => {
  it('reads a bare number in the break column as minutes, whatever the number is', () => {
    const minutesOf = (breakText: string) => {
      const reading = ok(read([entry({
        total_text: null, start_text: '07:00', end_text: '15:30', break_text: breakText,
      })]));
      return reading.candidates[0]?.minutes ?? null;
    };
    expect(minutesOf('15')).toBe(495);
    expect(minutesOf('20')).toBe(490);
    expect(minutesOf('30')).toBe(480);
    expect(minutesOf('45')).toBe(465);
    // A written duration keeps meaning hours; only a bare integer is minutes.
    expect(minutesOf('1:00')).toBe(450);
    expect(minutesOf('0,5')).toBe(480);
  });

  it('names the hours it read when a derived total contradicts a written reason', () => {
    const reading = ok(read([entry({
      total_text: null, start_text: '07:00', end_text: '15:00', no_hours_text: 'ziek',
    })]));
    expect(reading.candidates).toHaveLength(0);
    expect(reading.skipped[0].reason).not.toContain('null');
    expect(reading.skipped[0].reason).toContain('8:00');
  });
});
