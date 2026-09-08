import { describe, expect, it } from 'vitest';
import {
  compileHoursSourceInput, emptySourceShift, hoursSourceInputSchema, removedSourceSections,
  sourceControlIssues, sourceDraftFromInput, type HoursSourceDraft, type HoursSourceInput,
} from '@/components/hours-workflow/hours-day-source';

const source = (): HoursSourceInput => ({
  schemaVersion: 1,
  shifts: [{ start: '22:00', end: '06:00', endDayOffset: 1, breaks: [{ start: '02:00', end: '02:30', startDayOffset: 1 }] }],
  categories: [{ sourceCode: 'OV1', minutes: 450 }],
});

describe('hours source input shape', () => {
  it.each([
    { ...source(), schemaVersion: 2 },
    { ...source(), inferredBreak: 30 },
    { schemaVersion: 1, categories: [{ sourceCode: '   ', minutes: 60 }] },
    { schemaVersion: 1, categories: [{ sourceCode: 'X'.repeat(201), minutes: 60 }] },
    { schemaVersion: 1, categories: [{ sourceCode: 'OV1', minutes: 12.5 }] },
    { schemaVersion: 1, categories: [{ sourceCode: 'OV1', minutes: 60, factor: '1.25' }] },
    { schemaVersion: 1, shifts: [{ start: '08:00', end: '16:00', breaks: [] }] },
    { schemaVersion: 1, shifts: [{ start: '08:00', end: '16:00', endDayOffset: 0 }] },
    { schemaVersion: 1, shifts: [{ start: '08:00', end: '25:00', endDayOffset: 0, breaks: [] }] },
    { schemaVersion: 1, shifts: [{ ...source().shifts[0], elapsedMinutes: 450 }] },
    { schemaVersion: 1, shifts: [{ ...source().shifts[0], breaks: [{ start: '02:00', end: '02:30', estimated: true }] }] },
  ])('rejects incomplete or unsupported source facts: %j', input => {
    expect(hoursSourceInputSchema.safeParse(input).success).toBe(false);
  });

  it('keeps contradictory facts as valid source evidence and reports them separately', () => {
    const input: HoursSourceInput = {
      schemaVersion: 1,
      shifts: [
        { start: '08:00', end: '12:00', endDayOffset: 0, breaks: [] },
        { start: '11:00', end: '15:00', endDayOffset: 0, breaks: [] },
      ],
      categories: [{ sourceCode: 'OV1', minutes: 300 }, { sourceCode: 'OV1', minutes: 240 }],
    };
    expect(hoursSourceInputSchema.safeParse(input).success).toBe(true);
    expect(compileHoursSourceInput(sourceDraftFromInput(input))).toEqual({ ok: true, value: input });
    expect(sourceControlIssues(480, input).map(issue => issue.code)).toEqual(expect.arrayContaining([
      'TOTAL_MISMATCH', 'DUPLICATE_SOURCE_CATEGORY', 'OVERLAPPING_SHIFTS',
    ]));
  });

  it('allows an out-of-shift break to be saved as evidence while flagging the contradiction', () => {
    const input: HoursSourceInput = { schemaVersion: 1, shifts: [{ start: '08:00', end: '16:00', endDayOffset: 0,
      breaks: [{ start: '07:00', end: '07:30', startDayOffset: 0, endDayOffset: 0 }],
    }] };
    expect(compileHoursSourceInput(sourceDraftFromInput(input))).toEqual({ ok: true, value: input });
    expect(sourceControlIssues(480, input).map(issue => issue.code)).toContain('BREAK_OUTSIDE_SHIFT');
  });
});

describe('explicit source editing', () => {
  it('does not invent a source, a next-day choice or a confirmation of absent breaks', () => {
    const empty = sourceDraftFromInput(null);
    expect(empty).toEqual({ includeShifts: false, includeCategories: false, shifts: [], categories: [] });
    expect(compileHoursSourceInput(empty)).toEqual({ ok: true, value: null });
    expect(emptySourceShift()).toMatchObject({ endDayOffset: '', breaks: [], breaksConfirmed: false });
  });

  it('preserves original night-shift facts, implicit pause offsets and exact category minutes', () => {
    const input = source();
    const before = JSON.stringify(input);
    const draft = sourceDraftFromInput(input);
    expect(draft.categories).toEqual([{ sourceCode: 'OV1', duration: '7:30' }]);
    expect(compileHoursSourceInput(draft)).toEqual({ ok: true, value: {
      ...input,
      shifts: [{ ...input.shifts[0], breaks: [{ start: '02:00', end: '02:30', startDayOffset: 1, endDayOffset: 1 }] }],
    } });
    draft.shifts[0].breaks[0].start = '02:15';
    draft.categories[0].sourceCode = 'OV2';
    expect(JSON.stringify(input)).toBe(before);
  });

  it('requires confirmation even when the source says there were no breaks', () => {
    const draft: HoursSourceDraft = { ...sourceDraftFromInput(null), includeShifts: true,
      shifts: [{ ...emptySourceShift(), start: '08:00', end: '16:00', endDayOffset: '0' }],
    };
    expect(compileHoursSourceInput(draft)).toMatchObject({ ok: false, issues: [{ code: 'UNCONFIRMED_BREAKS' }] });
    draft.shifts[0].breaksConfirmed = true;
    expect(compileHoursSourceInput(draft)).toEqual({ ok: true, value: {
      schemaVersion: 1, shifts: [{ start: '08:00', end: '16:00', endDayOffset: 0, breaks: [] }],
    } });
  });

  it('requires day offsets for both the shift and each supplied break', () => {
    const draft = sourceDraftFromInput(source());
    draft.shifts[0].endDayOffset = '';
    expect(compileHoursSourceInput(draft)).toMatchObject({ ok: false, issues: [{ code: 'MISSING_DAY_OFFSET' }] });
    draft.shifts[0].endDayOffset = '1';
    draft.shifts[0].breaks[0].endDayOffset = '';
    expect(compileHoursSourceInput(draft)).toMatchObject({ ok: false, issues: [{ code: 'MISSING_DAY_OFFSET' }] });
  });

  it.each(['8,5', '8:30'])('preserves a category duration %s as integer minutes', duration => {
    expect(compileHoursSourceInput({ ...sourceDraftFromInput(null), includeCategories: true,
      categories: [{ sourceCode: 'OV1', duration }],
    })).toEqual({ ok: true, value: { schemaVersion: 1, categories: [{ sourceCode: 'OV1', minutes: 510 }] } });
  });

  it('rejects fractional minutes and out-of-day durations instead of rounding', () => {
    const draft = { ...sourceDraftFromInput(null), includeCategories: true, categories: [{ sourceCode: 'OV1', duration: '8.001' }] };
    expect(compileHoursSourceInput(draft)).toMatchObject({ ok: false, issues: [{ code: 'SUB_MINUTE_PRECISION' }] });
    draft.categories[0].duration = '24:01';
    expect(compileHoursSourceInput(draft)).toMatchObject({ ok: false, issues: [{ code: 'HOURS_OUT_OF_RANGE' }] });
  });

  it('flags removal of either previously supplied source section without flagging ordinary edits', () => {
    const input = source();
    const draft = sourceDraftFromInput(input);
    expect(removedSourceSections(input, draft)).toBe(false);
    expect(removedSourceSections(input, { ...draft, includeShifts: false })).toBe(true);
    expect(removedSourceSections(input, { ...draft, includeCategories: false })).toBe(true);
    expect(removedSourceSections(undefined, sourceDraftFromInput(null))).toBe(false);
  });

  it('preserves explicitly supplied empty sections as missing facts rather than dropping them', () => {
    const draft = sourceDraftFromInput(null);
    expect(compileHoursSourceInput({ ...draft, includeShifts: true })).toEqual({ ok: true, value: { schemaVersion: 1, shifts: [] } });
    expect(compileHoursSourceInput({ ...draft, includeCategories: true })).toEqual({ ok: true, value: { schemaVersion: 1, categories: [] } });
    expect(sourceControlIssues(480, { schemaVersion: 1, shifts: [] }).map(issue => issue.code)).toContain('INVALID_TOTAL');
    expect(sourceControlIssues(480, { schemaVersion: 1, categories: [] }).map(issue => issue.code)).toContain('INVALID_TOTAL');
  });

  it('requires deliberate removal even for a previously recorded empty source object', () => {
    const empty: HoursSourceInput = { schemaVersion: 1 };
    expect(hoursSourceInputSchema.safeParse(empty).success).toBe(true);
    expect(removedSourceSections(empty, sourceDraftFromInput(empty))).toBe(true);
    expect(removedSourceSections({ schemaVersion: 1, shifts: [] }, sourceDraftFromInput(null))).toBe(true);
  });

  it('caps source size by UTF-8 bytes as well as row counts', () => {
    const draft = { ...sourceDraftFromInput(null), includeCategories: true,
      categories: Array.from({ length: 256 }, () => ({ sourceCode: '字'.repeat(100), duration: '1' })),
    };
    expect(compileHoursSourceInput(draft)).toMatchObject({ ok: false, issues: [{ code: 'SOURCE_TOO_LARGE' }] });
    draft.categories = Array.from({ length: 257 }, () => ({ sourceCode: 'OV1', duration: '1' }));
    expect(compileHoursSourceInput(draft)).toMatchObject({ ok: false, issues: [{ code: 'INVALID_SOURCE_INPUT' }] });
  });

  it('compares the reported total after explicit break deduction and never changes the source', () => {
    const input = source();
    const before = JSON.stringify(input);
    expect(sourceControlIssues(450, input)).toEqual([]);
    expect(sourceControlIssues(480, input)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'TOTAL_MISMATCH', expectedMinutes: 450, actualMinutes: 480 }),
    ]));
    expect(JSON.stringify(input)).toBe(before);
  });
});
