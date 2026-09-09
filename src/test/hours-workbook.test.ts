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

describe('columns the reader must not mistake for something else', () => {
  it('does not treat a loosely titled column as the hours total', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Aantal dagen', 'Uren'],
      ['Jan Kowalski', '07-09-2026', '1', '8:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates[0].minutes).toBe(480);
  });

  it('ignores a remarks column instead of discarding the whole row', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren', 'Opmerking'],
      ['Jan Kowalski', '07-09-2026', '8:00', 'kwam later binnen'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates).toHaveLength(1);
    expect(reading.candidates[0].sourceInput).toBeNull();
  });

  it('reads a time-typed cell as a duration and never as a date', () => {
    // Excel stores "8:30" as a time on its own epoch; read-excel-file returns that Date.
    const excelTime = new Date(Date.UTC(1899, 11, 30, 8, 30));
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren'],
      ['Jan Kowalski', '07-09-2026', excelTime],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates.map(candidate => [candidate.dayId, candidate.minutes])).toEqual([['day-jan-mo', 510]]);
  });

  it('asks for a reason instead of proposing a time-typed zero', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren'],
      ['Jan Kowalski', '07-09-2026', new Date(Date.UTC(1899, 11, 30, 0, 0))],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates).toHaveLength(0);
    expect(reading.skipped[0].reason).toMatch(/reden/i);
  });

  it('refuses to read a negative number as a reason for no hours', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren'],
      ['Jan Kowalski', '07-09-2026', -8],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates).toHaveLength(0);
    expect(reading.skipped[0].reason).not.toMatch(/-8/);
  });

  it('blocks a file that says two different things about the same workday', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren'],
      ['Jan Kowalski', '07-09-2026', '4:00'],
      ['Jan Kowalski', '07-09-2026', '3:30'],
    ])], week);

    expect(reading.ok).toBe(false);
    if (reading.ok !== false) return;
    expect(reading.issues[0].code).toBe('DUPLICATE_DAY');
    expect(reading.issues[0].message).toMatch(/rij 2 en rij 3/);
  });
});

describe('the same workday on two worksheets', () => {
  it('names both worksheets when the repeat is not on the same one', () => {
    const rows = (hours: string) => [['Naam', 'Datum', 'Uren'], ['Jan Kowalski', '07-09-2026', hours]];
    const reading = readHoursWorkbook([sheet('Week 37', rows('4:00')), sheet('Correcties', rows('3:30'))], week);

    expect(reading.ok).toBe(false);
    if (reading.ok !== false) return;
    expect(reading.issues[0].message).toMatch(/blad Week 37, rij 2 en blad Correcties, rij 2/);
  });
});

/** A time cell is a serial on the 1899-12-30 epoch; the day part carries hours beyond 24. */
const excelDuration = (minutes: number) => new Date(Date.UTC(1899, 11, 30) + minutes * 60_000);

describe('rows that only look like a header', () => {
  it('does not let a period banner above the grid act as the day header', () => {
    const reading = readHoursWorkbook([sheet('Uren', [
      ['Periode:', '07-09-2026', 't/m', '13-09-2026'],
      ['Medewerker', '07-09-2026', '08-09-2026', 'Totaal'],
      ['Jan Kowalski', '8:00', '7:00', '15:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates.map(candidate => [candidate.dayId, candidate.minutes])).toEqual([
      ['day-jan-mo', 480], ['day-jan-tu', 420],
    ]);
  });

  it('reads a list worksheet as a list even when a row carries a second date', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'In dienst sinds', 'Uren'],
      ['Jan Kowalski', '07-09-2026', '01-03-2026', '8:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates.map(candidate => [candidate.dayId, candidate.minutes])).toEqual([['day-jan-mo', 480]]);
  });
});

describe('durations a spreadsheet stores as a time', () => {
  it('keeps the hours beyond a full day in a delivered week total', () => {
    const reading = readHoursWorkbook([sheet('Uren', [
      ['Medewerker', '07-09-2026', '08-09-2026', 'Totaal'],
      ['Jan Kowalski', excelDuration(480), excelDuration(480), excelDuration(2400)],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.rowTotals).toEqual([expect.objectContaining({ deliveredMinutes: 2400, readMinutes: 960 })]);
  });
});

describe('columns that carry something other than a breakdown', () => {
  it('leaves an hourly rate alone instead of booking it as delivered hours', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren', 'Uurloon'],
      ['Jan Kowalski', '07-09-2026', '8:00', '15,5'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates[0].sourceInput).toBeNull();
    expect(reading.candidates[0].notices).toEqual([]);
  });

  it('records no breakdown on a day that has no hours at all', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren', 'OV1'],
      ['Jan Kowalski', '07-09-2026', 'ziek', '8:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates[0]).toMatchObject({ minutes: 0, noHoursReason: 'ziek', sourceInput: null });
  });
});

describe('a bare number that could mean two things', () => {
  it('refuses to choose between half an hour and half a day', () => {
    // A spreadsheet stores an elapsed-time cell as a fraction of a day, so 0,5
    // is either 0:30 written as a decimal or 12:00 written as [h]:mm.
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren'],
      ['Jan Kowalski', '07-09-2026', 0.5],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates).toHaveLength(0);
    expect(reading.skipped[0].reason).toMatch(/0:30.*12:00|12:00.*0:30/);
  });

  it('reads a bare number that can only be decimal hours', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren'],
      ['Jan Kowalski', '07-09-2026', 8.5],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates[0].minutes).toBe(510);
  });

  it('still reads a decimal written as text, where nothing is ambiguous', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren'],
      ['Jan Kowalski', '07-09-2026', '0,5'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates[0].minutes).toBe(30);
  });
});

describe('a breakdown column that is zero on some days', () => {
  it('keeps the delivered codes instead of dropping the whole breakdown', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren', 'OV1', 'Overuren'],
      ['Jan Kowalski', '07-09-2026', '8:00', '8:00', '0:00'],
      ['Ewa Nowak', '08-09-2026', '9:00', '8:00', '1:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates[0].sourceInput?.categories).toEqual([
      { sourceCode: 'OV1', minutes: 480 }, { sourceCode: 'Overuren', minutes: 0 },
    ]);
    expect(reading.candidates[0].notices).toEqual([]);
  });
});

describe('a placeholder in a day cell', () => {
  it('does not turn a dash into a reason for no hours', () => {
    const reading = readHoursWorkbook([sheet('Uren', [
      ['Medewerker', '07-09-2026', '08-09-2026'],
      ['Jan Kowalski', '8:00', '-'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates).toHaveLength(1);
    expect(reading.candidates[0].dayId).toBe('day-jan-mo');
    expect(reading.candidates[0].noHoursReason).toBeNull();
  });
});

describe('rows and sheets that are not about a member of this week', () => {
  it('judges a breakdown column on the rows it will actually read', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren', 'OV1'],
      ['Jan Kowalski', '07-09-2026', '8:00', '8:00'],
      ['Eindtotaal', '', '40:00', '32:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates[0].sourceInput?.categories).toEqual([{ sourceCode: 'OV1', minutes: 480 }]);
  });

  it('says which worksheets it did not read instead of dropping them without a word', () => {
    const reading = readHoursWorkbook([
      sheet('Week 37', [['Naam', 'Datum', 'Uren'], ['Jan Kowalski', '07-09-2026', '8:00']]),
      sheet('Losse aantekeningen', [['Jan Kowalski werkte maandag door'], ['bellen met kantoor']]),
    ], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.sheetsRead).toEqual(['Week 37']);
    expect(reading.sheetsIgnored).toEqual(['Losse aantekeningen']);
  });
});

describe('a delivered breakdown that contradicts itself', () => {
  it('warns when the same source code is delivered twice', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren', 'OV1', 'OV1'],
      ['Jan Kowalski', '07-09-2026', '8:00', '4:00', '4:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates[0].notices.map(notice => notice.code)).toContain('DUPLICATE_SOURCE_CATEGORY');
  });
});

describe('a grid that reaches past this week', () => {
  it('does not call a week total wrong because a day of it falls outside the week', () => {
    const reading = readHoursWorkbook([sheet('Uren', [
      ['Medewerker', '06-09-2026', '07-09-2026', '08-09-2026', 'Totaal'],
      ['Jan Kowalski', '4:00', '8:00', '8:00', '20:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.rowTotals).toEqual([]);
    expect(reading.skipped.map(row => row.text)).toContain('Jan Kowalski · 2026-09-06');
  });
});

describe('a banner whose dates happen to sit next to each other', () => {
  it('takes the row directly above the employees as the day header', () => {
    const reading = readHoursWorkbook([sheet('Uren', [
      ['Periode', '08-09-2026', '09-09-2026'],
      ['Medewerker', '07-09-2026', '08-09-2026'],
      ['Jan Kowalski', '8:00', '7:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates.map(candidate => [candidate.dayId, candidate.minutes])).toEqual([
      ['day-jan-mo', 480], ['day-jan-tu', 420],
    ]);
  });
});

describe('a gap in a breakdown column', () => {
  it('keeps the column when one employee has a dash under it', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren', 'OV1'],
      ['Jan Kowalski', '07-09-2026', '8:00', '8:00'],
      ['Ewa Nowak', '08-09-2026', '8:00', '-'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates[0].sourceInput?.categories).toEqual([{ sourceCode: 'OV1', minutes: 480 }]);
    expect(reading.candidates[1].sourceInput).toBeNull();
  });

  it('says which column it set aside when the column is not a duration at all', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren', 'Werkplek'],
      ['Jan Kowalski', '07-09-2026', '8:00', 'hal 3'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates[0].sourceInput).toBeNull();
    expect(reading.skipped).toEqual([expect.objectContaining({ sheet: 'Week 37', text: 'Werkplek' })]);
  });
});

describe('columns that hold money rather than time', () => {
  it('leaves an hourly rate that happens to fit under the total alone', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren', 'Uurtarief'],
      ['Jan Kowalski', '07-09-2026', '8:00', '7,5'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates[0].sourceInput).toBeNull();
    expect(reading.candidates[0].notices).toEqual([]);
  });
});

describe('a worksheet that carries both kinds of heading', () => {
  it('falls back to the grid when the list reading yields nothing', () => {
    const reading = readHoursWorkbook([sheet('Uren', [
      ['Naam', 'Datum', 'Uren'],
      ['Medewerker', '07-09-2026', '08-09-2026'],
      ['Jan Kowalski', '8:00', '7:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates.map(candidate => [candidate.dayId, candidate.minutes])).toEqual([
      ['day-jan-mo', 480], ['day-jan-tu', 420],
    ]);
  });
});

describe('a plain number in a week total', () => {
  it('reads a small week total as decimal hours rather than calling it ambiguous', () => {
    const reading = readHoursWorkbook([sheet('Uren', [
      ['Medewerker', '07-09-2026', '08-09-2026', 'Totaal'],
      ['Jan Kowalski', '4:00', '3:00', 6],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.rowTotals).toEqual([expect.objectContaining({ deliveredMinutes: 360, readMinutes: 420 })]);
  });
});

describe('a full stop as a placeholder', () => {
  it('does not turn a dot into a reason for no hours either', () => {
    const reading = readHoursWorkbook([sheet('Uren', [
      ['Medewerker', '07-09-2026', '08-09-2026'],
      ['Jan Kowalski', '8:00', '.'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates.map(candidate => [candidate.dayId, candidate.minutes])).toEqual([['day-jan-mo', 480]]);
  });
});

describe('cells a spreadsheet fills with its own error', () => {
  it('never turns #N/A into a claim that someone did not work', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren'],
      ['Jan Kowalski', '07-09-2026', '#N/A'],
      ['Ewa Nowak', '08-09-2026', '#REF!'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates).toHaveLength(0);
    expect(reading.skipped).toHaveLength(2);
    expect(reading.skipped[0].reason).toMatch(/foutwaarde/i);
  });
});

describe('a heading that names the hours twice', () => {
  it('blocks instead of picking one of two total columns', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Totaal', 'Uren'],
      ['Jan Kowalski', '07-09-2026', '40:00', '8:00'],
    ])], week);

    expect(reading.ok).toBe(false);
    if (reading.ok !== false) return;
    expect(reading.issues[0].code).toBe('NO_LAYOUT');
  });
});

describe('an empty day inside a grid', () => {
  it('names the empty days next to a total that does not match', () => {
    const reading = readHoursWorkbook([sheet('Uren', [
      ['Medewerker', '07-09-2026', '08-09-2026', 'Totaal'],
      ['Jan Kowalski', '8:00', '', '16:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.rowTotals).toEqual([expect.objectContaining({
      deliveredMinutes: 960, readMinutes: 480, unreadDays: ['2026-09-08'],
    })]);
  });
});

describe('columns that describe the shift rather than a breakdown', () => {
  it('leaves begin, end and break times out of the delivered breakdown', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren', 'Begin', 'Eind', 'Pauze'],
      ['Jan Kowalski', '07-09-2026', '8:00', '07:00', '15:30', '0:30'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates[0].sourceInput).toBeNull();
    expect(reading.candidates[0].notices).toEqual([]);
  });
});

describe('a week total the spreadsheet stored as elapsed time', () => {
  it('lets the days of that row settle how a bare number should be read', () => {
    // 1,75 is either 1:45 as a decimal or 42:00 as [h]:mm. The days say which.
    const reading = readHoursWorkbook([sheet('Uren', [
      ['Medewerker', '07-09-2026', '08-09-2026', 'Totaal'],
      ['Jan Kowalski', '21:00', '21:00', 1.75],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.rowTotals).toEqual([]);
  });
});

describe('a grid whose total stands before the days', () => {
  it('still compares a week total to the left of the first day', () => {
    const reading = readHoursWorkbook([sheet('Uren', [
      ['Medewerker', 'Totaal', '07-09-2026', '08-09-2026'],
      ['Jan Kowalski', '20:00', '8:00', '8:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.rowTotals).toEqual([expect.objectContaining({ deliveredMinutes: 1200, readMinutes: 960 })]);
  });

  it('survives a worksheet with gaps in its row array', () => {
    const rows = [['Naam', 'Datum', 'Uren']] as unknown[][];
    rows[3] = ['Jan Kowalski', '07-09-2026', '8:00'];
    const reading = readHoursWorkbook([sheet('Week 37', rows as never)], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates.map(candidate => candidate.minutes)).toEqual([480]);
  });
});

describe('a delivered week total next to days that were left blank', () => {
  it('keeps comparing when a day merely holds a dash', () => {
    const reading = readHoursWorkbook([sheet('Uren', [
      ['Medewerker', '07-09-2026', '08-09-2026', 'Totaal'],
      ['Jan Kowalski', '8:00', '-', '20:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.rowTotals).toEqual([expect.objectContaining({
      deliveredMinutes: 1200, readMinutes: 480, unreadDays: ['2026-09-08'],
    })]);
  });

  it('stops comparing when a day holds something it cannot read at all', () => {
    const reading = readHoursWorkbook([sheet('Uren', [
      ['Medewerker', '07-09-2026', '08-09-2026', 'Totaal'],
      ['Jan Kowalski', '8:00', '#N/A', '20:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.rowTotals).toEqual([]);
  });
});

describe('a column that counts something other than time', () => {
  it('leaves a day count out of the delivered breakdown', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren', 'Aantal dagen'],
      ['Jan Kowalski', '07-09-2026', '8:00', '1'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates[0].sourceInput).toBeNull();
  });
});

describe('a name that shares only its surname', () => {
  it('does not hand another Kowalski’s hours to Jan', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren'],
      ['Piet Kowalski', '07-09-2026', '8:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates).toHaveLength(0);
    expect(reading.skipped[0].text).toBe('Piet Kowalski');
  });

  it('still accepts an initial that fits the given name', () => {
    const reading = readHoursWorkbook([sheet('Week 37', [
      ['Naam', 'Datum', 'Uren'],
      ['J. Kowalski', '07-09-2026', '8:00'],
      ['Nowak', '08-09-2026', '7:00'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates.map(candidate => [candidate.memberId, candidate.assignmentUncertain])).toEqual([
      ['member-jan', true], ['member-ewa', true],
    ]);
  });
});

describe('a grid whose first column is already a day', () => {
  it('blocks instead of reading the names as if they were hours', () => {
    const reading = readHoursWorkbook([sheet('Uren', [
      ['07-09-2026', '08-09-2026'],
      ['Jan Kowalski', '8:00'],
    ])], week);

    expect(reading.ok).toBe(false);
    if (reading.ok !== false) return;
    expect(reading.issues[0].code).toBe('NO_LAYOUT');
  });
});

describe('naming a placeholder in a grid', () => {
  it('names a dash even when there is no total to explain', () => {
    const reading = readHoursWorkbook([sheet('Uren', [
      ['Medewerker', '07-09-2026', '08-09-2026'],
      ['Jan Kowalski', '8:00', '-'],
    ])], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates).toHaveLength(1);
    expect(reading.skipped).toEqual([expect.objectContaining({
      sheet: 'Uren', row: 2, text: 'Jan Kowalski · 2026-09-08',
    })]);
  });

  it('survives a hole in the rows above the header', () => {
    const rows = [] as unknown[][];
    rows[2] = ['Naam', 'Datum', 'Uren'];
    rows[3] = ['Jan Kowalski', '07-09-2026', '8:00'];
    const reading = readHoursWorkbook([sheet('Week 37', rows as never)], week);

    expect(reading.ok).toBe(true);
    if (reading.ok === false) return;
    expect(reading.candidates.map(candidate => candidate.minutes)).toEqual([480]);
  });
});
