import { describe, expect, it } from 'vitest';
import {
  calculateShiftMinutes,
  checkMinutesTotal,
  classifyHoursDay,
  parseHoursToMinutes,
  selectEffectiveHoursMatrix,
  type HoursMatrixVersion,
  type HoursResult,
  type HoursShift,
} from '../../supabase/functions/_shared/hours-calculation.ts';

function value<T>(result: HoursResult<T>): T {
  if (result.ok === false) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
function codes(result: HoursResult<unknown>) {
  expect(result.ok).toBe(false);
  return result.ok === false ? result.issues.map(issue => issue.code) : [];
}
const allDays = [1, 2, 3, 4, 5, 6, 7];
const flat = (overrides: Partial<HoursMatrixVersion> = {}): HoursMatrixVersion => ({
  schemaVersion: 1, id: 'client-v1', scope: 'client', validFrom: '2026-01-01',
  confirmed: true, timeBasis: 'wall_clock', categories: [{ code: 'NOR', factor: '1.00' }],
  categoryMappings: [{ id: 'normal-mapping', sourceCode: 'NOR', categoryCode: 'NOR' }],
  automaticRules: { kind: 'flat', rule: { id: 'normal-rule', categoryCode: 'NOR' } },
  ...overrides,
});
const windows = (overrides: Partial<HoursMatrixVersion> = {}): HoursMatrixVersion => flat({
  categories: [{ code: 'DAY', factor: '1.00' }, { code: 'NIGHT', factor: '1.12' }],
  categoryMappings: [],
  automaticRules: { kind: 'time_windows', rules: [
    { id: 'day', categoryCode: 'DAY', daysOfWeek: allDays, start: '06:00', end: '18:00' },
    { id: 'night', categoryCode: 'NIGHT', daysOfWeek: allDays, start: '18:00', end: '06:00' },
  ] }, ...overrides,
});
const shift = (overrides: Partial<HoursShift> = {}): HoursShift => ({
  start: '08:00', end: '16:00', endDayOffset: 0, breaks: [], ...overrides,
});
const totalByCode = (result: HoursResult<{ allocations: { categoryCode: string; minutes: number }[] }>) =>
  value(result).allocations.reduce<Record<string, number>>((sums, item) => {
    sums[item.categoryCode] = (sums[item.categoryCode] ?? 0) + item.minutes;
    return sums;
  }, {});

describe('exacte duurinvoer', () => {
  it.each([
    ['8,5', 510], ['8.5', 510], ['8:30', 510], [8.5, 510], ['0', 0], [0, 0],
    ['0:00', 0], [' 4,75 ', 285], ['41,75', 2505], ['51:45', 3105],
    ['0.1', 6], ['0.05', 3], ['08.5000', 510], ['168:00', 10080],
  ])('verwerkt %s zonder afronding als %s minuten', (input, expected) => {
    expect(value(parseHoursToMinutes(input))).toBe(expected);
  });
  it.each([null, undefined, ''])('onderscheidt ontbrekend %s van nul', input => {
    expect(codes(parseHoursToMinutes(input))).toContain('MISSING_HOURS');
  });
  it.each(['8.89', 8.89, '0.3333333333333333', '8,501'])('blokkeert fracties van een minuut: %s', input => {
    expect(codes(parseHoursToMinutes(input))).toContain('SUB_MINUTE_PRECISION');
  });
  it.each(['8:89', '8:60'])('accepteert %s niet als geldige duur', input => {
    expect(codes(parseHoursToMinutes(input))).toContain('INVALID_DURATION');
  });
  it.each(['', ' ', '-1', '1e3', '8.5.0', '8,5:00', '8:3', '1 000', '¾', NaN, Infinity, false, {}, []])('weigert ongeldige of ambigue invoer %s', input => {
    expect(parseHoursToMinutes(input).ok).toBe(false);
  });
  it('past een expliciete daggrens toe zonder een weektotaal als dienst te behandelen', () => {
    expect(value(parseHoursToMinutes('24:00', { maxMinutes: 1440 }))).toBe(1440);
    expect(codes(parseHoursToMinutes('24:01', { maxMinutes: 1440 }))).toContain('HOURS_OUT_OF_RANGE');
    expect(codes(parseHoursToMinutes('99999999999999999999999999'))).toContain('HOURS_OUT_OF_RANGE');
    expect(codes(parseHoursToMinutes('1', { maxMinutes: 1.2 }))).toContain('INVALID_BOUND');
  });
  it('maakt de bekende pauzecorrecties herleidbaar zonder pauzes te verzinnen', () => {
    const firstGross = value(parseHoursToMinutes('44:00'));
    const firstNet = value(parseHoursToMinutes('41,75'));
    const secondGross = value(parseHoursToMinutes('51:45'));
    const secondNet = value(parseHoursToMinutes('49,25'));
    expect(firstGross - firstNet).toBe(135);
    expect(secondGross - secondNet).toBe(150);
    expect(value(checkMinutesTotal([firstNet, 135], firstGross))).toBe(firstGross);
    expect(value(checkMinutesTotal([secondNet, 150], secondGross))).toBe(secondGross);
    expect(codes(checkMinutesTotal([secondNet], secondGross))).toContain('TOTAL_MISMATCH');
  });
});

describe('diensten en gecontroleerde totalen', () => {
  it('berekent een dienst over middernacht met een expliciete pauze op de volgende dag', () => {
    expect(value(calculateShiftMinutes(shift({ start: '22:00', end: '06:00', endDayOffset: 1,
      breaks: [{ start: '02:00', end: '02:30', startDayOffset: 1 }],
    })))).toEqual({ grossMinutes: 480, breakMinutes: 30, netMinutes: 450,
      workedIntervals: [{ startMinute: 1320, endMinute: 1560 }, { startMinute: 1590, endMinute: 1800 }],
    });
  });
  it('trekt een pauze over middernacht exact eenmaal af', () => {
    const result = value(calculateShiftMinutes(shift({ start: '22:00', end: '06:00', endDayOffset: 1,
      breaks: [{ start: '23:45', end: '00:15', endDayOffset: 1 }],
    })));
    expect(result.netMinutes).toBe(450);
    expect(result.workedIntervals).toEqual([{ startMinute: 1320, endMinute: 1425 }, { startMinute: 1455, endMinute: 1800 }]);
  });
  it('vereist een expliciete volgende dag en een bevestiging van de pauzes', () => {
    expect(codes(calculateShiftMinutes({ start: '22:00', end: '06:00', breaks: [] } as HoursShift))).toContain('MISSING_DAY_OFFSET');
    expect(codes(calculateShiftMinutes({ start: '08:00', end: '16:00', endDayOffset: 0 } as HoursShift))).toContain('MISSING_BREAKS');
    expect(codes(calculateShiftMinutes(shift({ start: '22:00', end: '06:00' })))).toContain('INVALID_SHIFT_RANGE');
  });
  it.each([
    { start: '08:00', end: '08:00', endDayOffset: 0 },
    { start: '08:00', end: '09:00', endDayOffset: 1 },
  ] as Partial<HoursShift>[])('blokkeert lege of te lange dienst %j', input => {
    expect(codes(calculateShiftMinutes(shift(input)))).toContain('INVALID_SHIFT_RANGE');
  });
  it('controleert pauzes zonder dubbele aftrek of pauzes buiten de dienst', () => {
    expect(codes(calculateShiftMinutes(shift({ breaks: [{ start: '07:30', end: '08:30' }] })))).toContain('BREAK_OUTSIDE_SHIFT');
    expect(codes(calculateShiftMinutes(shift({ breaks: [{ start: '12:00', end: '12:30' }, { start: '12:15', end: '12:45' }] })))).toContain('OVERLAPPING_BREAKS');
    expect(value(calculateShiftMinutes(shift({ breaks: [{ start: '12:30', end: '13:00' }, { start: '12:00', end: '12:30' }] }))).netMinutes).toBe(420);
  });
  it('signaleert 4 + 5 = 8 met beide waarden en verandert de bron niet', () => {
    const components = [240, 300];
    const result = checkMinutesTotal(components, 480);
    expect(result).toEqual({ ok: false, issues: [{ code: 'TOTAL_MISMATCH', message: 'De som wijkt af van het aangeleverde totaal.', expectedMinutes: 540, actualMinutes: 480 }] });
    expect(components).toEqual([240, 300]);
    expect(value(checkMinutesTotal(components, 540))).toBe(540);
  });
  it('maakt geen akkoordtotaal van ontbrekende componenten, NaN of te veel weekminuten', () => {
    for (const input of [[], [NaN], [-1], [1.5], [null] as number[]]) expect(codes(checkMinutesTotal(input, 0))).toContain('INVALID_TOTAL');
    expect(codes(checkMinutesTotal([10080, 1], 10080))).toContain('HOURS_OUT_OF_RANGE');
  });
});

describe('vaste, bevestigde matrixversies', () => {
  it('kiest klantregels voor CAO en gebruikt alleen een expliciet toepasselijke CAO als terugval', () => {
    const client = flat();
    const cao = flat({ id: 'cao-v1', scope: 'cao' });
    expect(value(selectEffectiveHoursMatrix({ workDate: '2026-09-07', clientVersions: [client], caoVersions: [cao] })).id).toBe('client-v1');
    expect(value(selectEffectiveHoursMatrix({ workDate: '2026-09-07', clientVersions: [], caoVersions: [cao] })).id).toBe('cao-v1');
    expect(codes(selectEffectiveHoursMatrix({ workDate: '2026-09-07', clientVersions: [], caoVersions: [] }))).toContain('MISSING_MATRIX');
  });
  it('behoudt de oude versie en neemt op de exacte ingangsdatum de nieuwe versie', () => {
    const old = flat({ validUntil: '2026-10-01' });
    const next = flat({ id: 'client-v2', validFrom: '2026-10-01', categories: [{ code: 'NOR', factor: '1.20' }] });
    const selection = (date: string) => value(selectEffectiveHoursMatrix({ workDate: date, clientVersions: [next, old], caoVersions: [] }));
    expect(selection('2026-09-30').id).toBe('client-v1');
    expect(selection('2026-10-01').id).toBe('client-v2');
    expect(value(classifyHoursDay({ workDate: '2026-09-30', totalMinutes: 480 }, old)).allocations[0].factor).toBe('1.00');
    expect(codes(classifyHoursDay({ workDate: '2026-10-01', totalMinutes: 480 }, old))).toContain('MATRIX_NOT_EFFECTIVE');
  });
  it('blokkeert een onbevestigde klantmatrix en valt niet stil terug op CAO', () => {
    expect(codes(selectEffectiveHoursMatrix({ workDate: '2026-09-07', clientVersions: [flat({ confirmed: false })], caoVersions: [flat({ scope: 'cao' })] }))).toContain('UNCONFIRMED_MATRIX');
  });
  it('blokkeert overlappende versies in plaats van de nieuwste willekeurig te kiezen', () => {
    expect(codes(selectEffectiveHoursMatrix({ workDate: '2026-09-07', clientVersions: [flat(), flat({ id: 'v2', validFrom: '2026-09-01' })], caoVersions: [] }))).toContain('OVERLAPPING_MATRIX_VERSIONS');
  });
  it('controleert kalenderdata, scopes en halfopen periodes', () => {
    expect(codes(selectEffectiveHoursMatrix({ workDate: '2026-02-30', clientVersions: [], caoVersions: [] }))).toContain('INVALID_WORK_DATE');
    expect(codes(selectEffectiveHoursMatrix({ workDate: '2026-09-07', clientVersions: [flat({ scope: 'cao' })], caoVersions: [] }))).toContain('MATRIX_SCOPE_MISMATCH');
    expect(codes(selectEffectiveHoursMatrix({ workDate: '2026-09-07', clientVersions: [flat({ validUntil: '2026-01-01' })], caoVersions: [] }))).toContain('INVALID_MATRIX_PERIOD');
    expect(codes(classifyHoursDay({ workDate: '2026-02-30', totalMinutes: 480 }, flat()))).toContain('INVALID_WORK_DATE');
  });
});

describe('expliciete uurcategorieën', () => {
  const explicit = (): HoursMatrixVersion => flat({
    categories: Array.from({ length: 5 }, (_, i) => ({ code: `PAY${i + 1}`, factor: `1.${i + 1}0` })),
    categoryMappings: Array.from({ length: 5 }, (_, i) => ({ id: `map-ov${i + 1}`, sourceCode: `OV${i + 1}`, categoryCode: `PAY${i + 1}` })),
    automaticRules: { kind: 'explicit_only' },
  });
  it('behoudt OV1 tot en met OV5, factoren en herkomstregel zonder uren te stapelen', () => {
    const categories = [1, 2, 3, 4, 5].map(i => ({ sourceCode: `OV${i}`, minutes: i * 30 }));
    const result = value(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 450, categories }, explicit()));
    expect(result.matrixVersionId).toBe('client-v1');
    expect(result.allocations).toEqual([1, 2, 3, 4, 5].map(i => ({ sourceCategory: `OV${i}`, categoryCode: `PAY${i}`, ruleId: `map-ov${i}`, minutes: i * 30, factor: `1.${i}0` })));
    expect(result.allocations.reduce((sum, row) => sum + row.minutes, 0)).toBe(450);
  });
  it('geeft aangeleverde categorieën voorrang boven automatische tijdvensters', () => {
    const matrix = windows({ categoryMappings: [{ id: 'map-night', sourceCode: 'OV1', categoryCode: 'NIGHT' }] });
    expect(totalByCode(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 480, categories: [{ sourceCode: 'OV1', minutes: 480 }] }, matrix))).toEqual({ NIGHT: 480 });
  });
  it('blokkeert onbekende categorieën, duplicaten en een afwijkende categoriesom', () => {
    expect(codes(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 60, categories: [{ sourceCode: 'OV6', minutes: 60 }] }, explicit()))).toContain('UNMAPPED_SOURCE_CATEGORY');
    expect(codes(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 60, categories: [{ sourceCode: 'OV1', minutes: 30 }, { sourceCode: 'OV1', minutes: 30 }] }, explicit()))).toContain('INVALID_SOURCE_CATEGORY');
    expect(codes(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 60, categories: [{ sourceCode: 'OV1', minutes: 30 }] }, explicit()))).toContain('TOTAL_MISMATCH');
    expect(codes(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 60 }, explicit()))).toContain('MISSING_CATEGORIES');
  });
  it('blokkeert dubbele mappings en onbekende uurcodes', () => {
    const matrix = explicit();
    matrix.categoryMappings.push({ id: 'duplicate', sourceCode: 'OV1', categoryCode: 'PAY2' });
    expect(codes(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 60 }, matrix))).toContain('CONFLICTING_CATEGORY_MAPPING');
    expect(codes(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 60 }, flat({ automaticRules: { kind: 'flat', rule: { id: 'x', categoryCode: 'UNKNOWN' } } })))).toContain('INVALID_FLAT_RULE');
  });
});

describe('exclusieve vaste tijdvensters', () => {
  it('verdeelt op 18:00 en trekt de pauze af van het werkelijk geraakte venster', () => {
    const result = classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 150, shifts: [shift({ start: '17:00', end: '20:00', breaks: [{ start: '18:30', end: '19:00' }] })] }, windows());
    expect(totalByCode(result)).toEqual({ DAY: 60, NIGHT: 90 });
  });
  it('rekent over middernacht en de week/jaargrens zonder dubbele tijd', () => {
    for (const workDate of ['2026-09-13', '2026-12-31']) {
      const result = classifyHoursDay({ workDate, totalMinutes: 570, shifts: [shift({ start: '21:00', end: '07:00', endDayOffset: 1, breaks: [{ start: '02:00', end: '02:30', startDayOffset: 1 }] })] }, windows());
      expect(totalByCode(result)).toEqual({ NIGHT: 510, DAY: 60 });
    }
  });
  it('koppelt het deel na middernacht aan de begindag van een nachtvenster', () => {
    const matrix = windows({ automaticRules: { kind: 'time_windows', rules: [{ id: 'friday-night', categoryCode: 'NIGHT', daysOfWeek: [5], start: '18:00', end: '06:00' }] } });
    expect(totalByCode(classifyHoursDay({ workDate: '2026-09-12', totalMinutes: 120, shifts: [shift({ start: '00:00', end: '02:00' })] }, matrix))).toEqual({ NIGHT: 120 });
  });
  it('vereist tijden bij een dagtotaal en faalt als een gebruikt venster ontbreekt', () => {
    expect(codes(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 480 }, windows()))).toContain('MISSING_SHIFT_TIMES');
    const matrix = windows({ automaticRules: { kind: 'time_windows', rules: [{ id: 'day', categoryCode: 'DAY', daysOfWeek: allDays, start: '06:00', end: '18:00' }] } });
    expect(codes(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 120, shifts: [shift({ start: '17:00', end: '19:00' })] }, matrix))).toContain('MISSING_WINDOW_RULE');
  });
  it('blokkeert ook een vensteroverlap over zondag naar maandag', () => {
    const matrix = windows({ automaticRules: { kind: 'time_windows', rules: [
      { id: 'sun', categoryCode: 'NIGHT', daysOfWeek: [7], start: '22:00', end: '06:00' },
      { id: 'mon', categoryCode: 'DAY', daysOfWeek: [1], start: '05:00', end: '10:00' },
    ] } });
    expect(codes(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 60 }, matrix))).toContain('OVERLAPPING_WINDOW_RULES');
  });
  it('ondersteunt een expliciet heel-dagvenster en blokkeert gelijke begin/eindtijden', () => {
    const rule = { id: 'all', categoryCode: 'DAY', daysOfWeek: allDays, start: '00:00', end: '24:00' };
    const matrix = windows({ automaticRules: { kind: 'time_windows', rules: [rule] } });
    expect(totalByCode(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 480, shifts: [shift()] }, matrix))).toEqual({ DAY: 480 });
    matrix.automaticRules = { kind: 'time_windows', rules: [{ ...rule, end: '00:00' }] };
    expect(codes(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 480 }, matrix))).toContain('INVALID_WINDOW_RULE');
  });
  it('controleert dagtotaal tegen alle diensten en detecteert dubbele diensten', () => {
    const shifts = [shift({ start: '08:00', end: '12:00' }), shift({ start: '13:00', end: '18:00' })];
    expect(codes(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 480, shifts }, flat()))).toContain('TOTAL_MISMATCH');
    expect(value(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 540, shifts }, flat())).totalMinutes).toBe(540);
    expect(codes(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 960, shifts: [shift(), shift()] }, flat()))).toContain('OVERLAPPING_SHIFTS');
  });
  it('laat een categoriesom een afwijking in aangeleverde diensttijden niet overschrijven', () => {
    expect(codes(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 420, shifts: [shift()], categories: [{ sourceCode: 'NOR', minutes: 420 }] }, flat()))).toContain('TOTAL_MISMATCH');
  });
  it.each(['2026-03-29', '2026-10-25'])('blokkeert onopgeloste klokwisseldiensten op %s', workDate => {
    expect(codes(classifyHoursDay({ workDate, totalMinutes: 240, shifts: [shift({ start: '00:00', end: '04:00' })] }, windows()))).toContain('DST_REQUIRES_REVIEW');
  });
  it('blokkeert ook een dienst die de volgende dag een klokwisseling raakt', () => {
    expect(codes(classifyHoursDay({ workDate: '2026-10-24', totalMinutes: 480, shifts: [shift({ start: '22:00', end: '06:00', endDayOffset: 1 })] }, windows()))).toContain('DST_REQUIRES_REVIEW');
  });
  it('kan expliciet bevestigde minuten en categorieën op een klokwisseldag wel behouden', () => {
    expect(value(classifyHoursDay({ workDate: '2026-10-25', totalMinutes: 300, categories: [{ sourceCode: 'NOR', minutes: 300 }] }, flat())).totalMinutes).toBe(300);
  });
});

describe('fail-closed configuratiegrenzen', () => {
  it('negeert geen onbekende schema- of samenloopregels', () => {
    for (const matrix of [
      { ...flat(), schemaVersion: 2 },
      { ...flat(), weeklyThreshold: 2400 },
      { ...flat(), timeBasis: 'elapsed' },
      { ...flat(), automaticRules: { kind: 'weekly_overtime', threshold: 2400 } },
      { ...flat(), automaticRules: { ...flat().automaticRules, stacking: true } },
    ] as unknown as HoursMatrixVersion[]) {
      expect(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 480 }, matrix).ok).toBe(false);
    }
  });
  it.each([undefined, '', 'NaN', '-1', '0', '1,2'])('verzint geen factor voor %s', factor => {
    expect(codes(classifyHoursDay({ workDate: '2026-09-07', totalMinutes: 480 }, flat({ categories: [{ code: 'NOR', factor }] })))).toContain('INVALID_CATEGORY');
  });
  it('blijft puur en wijzigt invoer en matrix niet bij succes of blokkade', () => {
    const matrix = windows();
    const day = { workDate: '2026-09-07', totalMinutes: 480, shifts: [shift()] };
    const before = JSON.stringify({ matrix, day });
    classifyHoursDay(day, matrix);
    classifyHoursDay({ ...day, totalMinutes: 420 }, matrix);
    expect(JSON.stringify({ matrix, day })).toBe(before);
  });
});
