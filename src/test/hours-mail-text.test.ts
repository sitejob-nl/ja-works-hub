import { describe, expect, it } from 'vitest';
import { readHoursFromMailText } from '@/lib/hours-mail-text';
import type { WorkbookContext } from '@/lib/hours-workbook';

/**
 * What a message may and may not turn into. A line that reads completely
 * becomes a proposal; every other line is named rather than guessed at, and a
 * day that is spoken about twice only survives when the message itself says
 * which statement it is taking back.
 */

const MONDAY = '2026-09-07';
const days = (memberId: string, prefix: string) =>
  ['07', '08', '09', '10', '11', '12', '13'].map((day, index) => ({
    id: `${prefix}-${index}`, memberId, workDate: `2026-09-${day}`,
  }));

const context: WorkbookContext = {
  members: [{ id: 'm1', name: 'Jan Kowalski' }, { id: 'm2', name: 'Piet Kowalski' }],
  days: [...days('m1', 'jan'), ...days('m2', 'piet')],
};

const ok = (reading: ReturnType<typeof readHoursFromMailText>) => {
  if (reading.ok === false) throw new Error(`blocked: ${reading.issues[0].message}`);
  return reading;
};

describe('reading hours out of an e-mail', () => {
  it('reads a day per line under the employee named above them', () => {
    const reading = ok(readHoursFromMailText([
      'Hoi Kas,', '', 'Hierbij de uren van week 37.', '',
      'Jan Kowalski', 'maandag 8', 'dinsdag 8,5', 'woensdag 7:45', '',
      'Groet, Peter',
    ].join('\n'), context));

    expect(reading.candidates.map(candidate => [candidate.workDate, candidate.minutes])).toEqual([
      [MONDAY, 480], ['2026-09-08', 510], ['2026-09-09', 465],
    ]);
    expect(reading.candidates.every(candidate => candidate.memberId === 'm1')).toBe(true);
    expect(reading.candidates[0].pageNumber).toBe(1);
    expect(reading.candidates[0].pageLabel).toBe('bericht · regel 6');
  });

  it('takes a correction as a correction on that same day, not as a second reading', () => {
    const reading = ok(readHoursFromMailText([
      'Jan Kowalski', 'zaterdag 9,5', '', 'Correctie: zaterdag was geen 9,5 maar 4,75.',
    ].join('\n'), context));

    expect(reading.candidates).toHaveLength(1);
    const [saturday] = reading.candidates;
    expect(saturday.workDate).toBe('2026-09-12');
    expect(saturday.minutes).toBe(285);
    expect(saturday.correctionOf).toContain('9,5');
  });

  it('reads an arrow and a "moet" as the same taking back', () => {
    for (const line of ['zaterdag 9,5 -> 4,75', 'zaterdag: 9,5 moet 4,75 zijn']) {
      const reading = ok(readHoursFromMailText(['Jan Kowalski', line].join('\n'), context));
      expect(reading.candidates).toHaveLength(1);
      expect(reading.candidates[0].minutes, line).toBe(285);
    }
  });

  it('blocks when the same day is stated twice without saying which one holds', () => {
    const reading = readHoursFromMailText([
      'Jan Kowalski', 'zaterdag 9,5', 'zaterdag 4,75',
    ].join('\n'), context);

    expect(reading.ok).toBe(false);
    if (reading.ok === false) {
      expect(reading.issues[0].code).toBe('DUPLICATE_DAY');
      expect(reading.issues[0].message).toContain('regel 2');
      expect(reading.issues[0].message).toContain('regel 3');
    }
  });

  it('does not choose between two durations on one line that explains neither', () => {
    const reading = ok(readHoursFromMailText([
      'Jan Kowalski', 'maandag 8 en 9 uur',
    ].join('\n'), context));

    expect(reading.candidates).toHaveLength(0);
    expect(reading.skipped[0].reason).toContain('meer dan één duur');
  });

  it('refuses a bare number it cannot tell apart from a week number', () => {
    const reading = ok(readHoursFromMailText([
      'Jan Kowalski', 'week 37 maandag 8',
    ].join('\n'), context));

    expect(reading.candidates, 'the week number is not a second number to weigh').toHaveLength(1);
    expect(reading.candidates[0].minutes).toBe(480);
  });

  it('names a line it looked at instead of inventing hours for it', () => {
    const reading = ok(readHoursFromMailText([
      'Jan Kowalski', 'maandag', 'dinsdag 8',
    ].join('\n'), context));

    expect(reading.candidates).toHaveLength(1);
    expect(reading.skipped).toHaveLength(1);
    expect(reading.skipped[0].row).toBe(2);
    expect(reading.skipped[0].reason).toContain('geen uren in deze regel');
  });

  it('takes an explicit reason as no hours, and nothing else', () => {
    const reading = ok(readHoursFromMailText([
      'Jan Kowalski', 'vrijdag: ziek gemeld', 'donderdag hebben we het later nog over',
    ].join('\n'), context));

    const [friday] = reading.candidates;
    expect(friday.workDate).toBe('2026-09-11');
    expect(friday.minutes).toBe(0);
    expect(friday.noHoursReason).toBe('ziek gemeld');
    expect(reading.candidates).toHaveLength(1);
    expect(reading.skipped.some(row => row.row === 3)).toBe(true);
  });

  it('will not say who a line is about when the message never does', () => {
    const reading = ok(readHoursFromMailText('maandag 8', context));

    expect(reading.candidates).toHaveLength(0);
    expect(reading.skipped[0].reason).toContain('niet duidelijk over welke medewerker');
  });

  it('lets the subject name the employee, because a message often only does so there', () => {
    const reading = ok(readHoursFromMailText('maandag 8', { ...context, subject: 'Uren Jan Kowalski week 37' }));

    expect(reading.candidates).toHaveLength(1);
    expect(reading.candidates[0].memberId).toBe('m1');
  });

  it('refuses a shared surname that the given name does not fit', () => {
    const reading = ok(readHoursFromMailText(['P. Kowalski', 'maandag 8'].join('\n'), context));

    expect(reading.candidates).toHaveLength(1);
    expect(reading.candidates[0].memberId).toBe('m2');
    expect(reading.candidates[0].assignmentUncertain,
      'an initial with a shared surname has to be confirmed by a named person').toBe(true);
  });

  it('reads a date that is written out, and only within this week', () => {
    const reading = ok(readHoursFromMailText([
      'Jan Kowalski', '08-09-2026: 8 uur', '01-09-2026: 8 uur',
    ].join('\n'), context));

    expect(reading.candidates.map(candidate => candidate.workDate)).toEqual(['2026-09-08']);
    expect(reading.skipped[0].reason).toContain('valt niet in deze week');
  });

  it('does not choose when the stated day and date contradict each other', () => {
    const reading = ok(readHoursFromMailText([
      'Jan Kowalski', 'maandag 08-09-2026: 8 uur',
    ].join('\n'), context));

    expect(reading.candidates).toHaveLength(0);
    expect(reading.skipped[0].reason).toContain('horen niet bij elkaar');
  });

  it('blocks a message that carries nothing but a greeting', () => {
    const reading = readHoursFromMailText('Hoi Kas,\n\nZie bijlage.\n\nGroet, Peter', context);

    expect(reading.ok).toBe(false);
    if (reading.ok === false) expect(reading.issues[0].code).toBe('NO_LAYOUT');
  });
});
