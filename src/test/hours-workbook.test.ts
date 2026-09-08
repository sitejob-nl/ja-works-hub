import { describe, expect, it } from 'vitest';
import { readHoursWorkbook, type WorkbookContext, type WorkbookSheet } from '@/lib/hours-workbook';

/** One QA week: two employees, Monday through Wednesday. */
const week: WorkbookContext = {
  members: [
    { id: 'member-jan', name: 'Jan Kowalski' },
    { id: 'member-ewa', name: 'Ewa Nowak' },
  ],
  days: [
    { id: 'day-jan-mo', memberId: 'member-jan', workDate: '2026-09-07' },
    { id: 'day-jan-tu', memberId: 'member-jan', workDate: '2026-09-08' },
    { id: 'day-ewa-mo', memberId: 'member-ewa', workDate: '2026-09-07' },
    { id: 'day-ewa-tu', memberId: 'member-ewa', workDate: '2026-09-08' },
  ],
};

const sheet = (name: string, rows: WorkbookSheet['rows']): WorkbookSheet => ({ name, rows });

describe('reading a list-shaped worksheet', () => {
  it('turns one row per employee and day into one proposal each', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren'],
      ['Jan Kowalski', '07-09-2026', '8,5'],
      ['Ewa Nowak', '08-09-2026', '7:45'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates).toHaveLength(2);
    expect(reading.candidates[0]).toMatchObject({
      dayId: 'day-jan-mo', memberId: 'member-jan', workDate: '2026-09-07',
      minutes: 510, noHoursReason: null, assignmentUncertain: false, pageNumber: 1,
    });
    expect(reading.candidates[1]).toMatchObject({ dayId: 'day-ewa-tu', minutes: 465 });
  });
});

describe('source categories and the delivered total', () => {
  it('keeps the delivered category codes literally instead of translating them', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren', 'OV1', 'OV3'],
      ['Jan Kowalski', '07-09-2026', '8:00', '6:00', '2:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates[0].sourceInput).toEqual({
      schemaVersion: 1,
      categories: [{ sourceCode: 'OV1', minutes: 360 }, { sourceCode: 'OV3', minutes: 120 }],
    });
    expect(reading.candidates[0].notices).toEqual([]);
  });

  it('shows the difference when the parts do not add up to the delivered total', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Totaal', 'OV1', 'OV2'],
      ['Jan Kowalski', '07-09-2026', '8:00', '4:00', '5:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    const candidate = reading.candidates[0];
    // The delivered total stays the proposed duration; the parts stay as delivered.
    expect(candidate.minutes).toBe(480);
    expect(candidate.sourceInput?.categories).toEqual([
      { sourceCode: 'OV1', minutes: 240 }, { sourceCode: 'OV2', minutes: 300 },
    ]);
    expect(candidate.notices.map(notice => notice.code)).toContain('TOTAL_MISMATCH');
    expect(candidate.notices[0]).toMatchObject({ expectedMinutes: 540, actualMinutes: 480 });
  });
});

describe('who a row is about', () => {
  it('marks a partially written name as an uncertain assignment rather than guessing silently', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren'],
      ['J. Kowalski', '07-09-2026', '8:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates[0]).toMatchObject({
      memberId: 'member-jan', assignmentUncertain: true, employeeText: 'J. Kowalski',
    });
  });

  it('reads an exactly written name, including a reversed "surname, first name"', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren'],
      ['Kowalski, Jan', '07-09-2026', '8:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates[0]).toMatchObject({ memberId: 'member-jan', assignmentUncertain: false });
  });

  it('makes no proposal for a name that fits nobody, and says which row it left alone', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren'],
      ['Piet de Vries', '07-09-2026', '8:00'],
      ['Jan Kowalski', '07-09-2026', '8:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates).toHaveLength(1);
    expect(reading.skipped).toEqual([expect.objectContaining({ sheet: 'Week 37', row: 2, text: 'Piet de Vries' })]);
  });
});

describe('what the reader refuses to do', () => {
  it('blocks an unexpected layout instead of producing half a set of proposals', () => {
    const reading = readHoursWorkbook([sheet('Blad1', [
      ['Overzicht', '', ''],
      ['Jan Kowalski', 'maandag', 'lang gewerkt'],
    ])], week);

    expect(reading.ok).toBe(false);
    if (reading.ok !== false) return;
    expect(reading.issues[0].code).toBe('NO_LAYOUT');
  });

  it('blocks a workbook without worksheets', () => {
    expect(readHoursWorkbook([], week)).toMatchObject({ ok: false, issues: [{ code: 'EMPTY_WORKBOOK' }] });
  });

  it('invents nothing for an empty hours cell and says so', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren'],
      ['Jan Kowalski', '07-09-2026', ''],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates).toHaveLength(0);
    expect(reading.skipped[0].reason).toMatch(/geen uren/i);
  });

  it('leaves a day outside this week alone instead of moving it into the week', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren'],
      ['Jan Kowalski', '14-09-2026', '8:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates).toHaveLength(0);
    expect(reading.skipped[0].reason).toMatch(/2026-09-14/);
  });
});

describe('reading a cross-table worksheet with the days across the top', () => {
  it('turns one row per employee into one proposal per day that has hours', () => {
    const reading = readHoursWorkbook([sheet('Uren', [
      ['Urenbriefje week 37', '', '', ''],
      ['Medewerker', '07-09-2026', '08-09-2026', 'Totaal'],
      ['Jan Kowalski', '8,5', '7:30', '16:00'],
      ['Ewa Nowak', '', '6,25', '6:15'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates.map(candidate => [candidate.dayId, candidate.minutes])).toEqual([
      ['day-jan-mo', 510], ['day-jan-tu', 450], ['day-ewa-tu', 375],
    ]);
    expect(reading.candidates[0].pageLabel).toBe('blad Uren · rij 3');
  });

  it('treats a delivered week total as a control figure and shows the difference', () => {
    const reading = readHoursWorkbook([sheet('Uren', [
      ['Medewerker', '07-09-2026', '08-09-2026', 'Totaal'],
      ['Jan Kowalski', '4:00', '5:00', '8:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.rowTotals).toEqual([expect.objectContaining({
      sheet: 'Uren', row: 2, employeeName: 'Jan Kowalski', deliveredMinutes: 480, readMinutes: 540,
    })]);
    // The days keep exactly what the sheet said; the mismatch is shown, not corrected.
    expect(reading.candidates.map(candidate => candidate.minutes)).toEqual([240, 300]);
  });
});

describe('a week total longer than a day', () => {
  it('still compares a delivered week total of more than 24 hours', () => {
    const reading = readHoursWorkbook([sheet('Uren', [
      ['Medewerker', '07-09-2026', '08-09-2026', 'Totaal'],
      ['Jan Kowalski', '8:00', '8:00', '40:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.rowTotals).toEqual([expect.objectContaining({ deliveredMinutes: 2400, readMinutes: 960 })]);
  });
});
