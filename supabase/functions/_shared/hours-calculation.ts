/**
 * Deterministic hours kernel, schema version 1 (no provider, DB or payroll writes).
 * All quantities are integer minutes. Decimal inputs that contain fractions of a
 * minute require review; no rounding or break/CAO inference happens here.
 *
 * Supported: confirmed effective matrix snapshots; supplied category mappings;
 * exclusive flat classification or recurring weekly wall-clock windows. A window
 * crossing midnight belongs to its starting weekday. Intervals are [start, end).
 * Factors are preserved as configured metadata, never calculated into wages.
 *
 * Not supported: automatic daily/weekly overtime thresholds, stacking, holidays,
 * elapsed-time/DST rules or a guessed fallback CAO. Such rules must be represented
 * by a future schema version; unknown configuration keys/types fail closed.
 * Version selection is a separate step: persist the selected immutable snapshot
 * with the day revision so a later matrix does not change historical results.
 */
export interface HoursIssue {
  code: string;
  message: string;
  field?: string;
  expectedMinutes?: number;
  actualMinutes?: number;
}
export type HoursResult<T> = { ok: true; value: T } | { ok: false; issues: HoursIssue[] };
const success = <T>(value: T): HoursResult<T> => ({ ok: true, value });
const failure = <T>(code: string, message: string, field?: string): HoursResult<T> => ({
  ok: false, issues: [{ code, message, ...(field ? { field } : {}) }],
});
const isMinutes = (value: unknown, max = 10080): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const hasOnlyKeys = (value: object, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Decimal hours (comma/dot) and H:MM durations are distinct; default bound is one week. */
export function parseHoursToMinutes(input: unknown, options: { maxMinutes?: number } = {}): HoursResult<number> {
  const max = options.maxMinutes ?? 10080;
  if (!isMinutes(max, Number.MAX_SAFE_INTEGER)) return failure('INVALID_BOUND', 'De minutengrens is ongeldig.');
  if (input === null || input === undefined || input === '') return failure('MISSING_HOURS', 'Het aantal uren ontbreekt.');
  if (typeof input !== 'string' && typeof input !== 'number') return failure('INVALID_HOURS', 'Gebruik decimale uren of uren:minuten.');
  const text = String(input).trim();
  if (text.length > 32 || !/^\d+(?:[.,]\d+|:\d{2})?$/.test(text)) {
    return failure('INVALID_HOURS', 'Gebruik bijvoorbeeld 8,5 of 8:30; geen gemengde notatie.');
  }
  let minutes: bigint;
  if (text.includes(':')) {
    const [hours, minutePart] = text.split(':');
    if (Number(minutePart) > 59) return failure('INVALID_DURATION', 'Het minutendeel moet tussen 00 en 59 liggen.');
    minutes = BigInt(hours) * 60n + BigInt(minutePart);
  } else {
    const [hours, fraction = ''] = text.replace(',', '.').split('.');
    const denominator = 10n ** BigInt(fraction.length);
    const numerator = (BigInt(hours) * denominator + BigInt(fraction || '0')) * 60n;
    if (numerator % denominator !== 0n) {
      return failure('SUB_MINUTE_PRECISION', 'Deze waarde bevat een deel van een minuut. Bevestig de exacte duur; er wordt niet afgerond.');
    }
    minutes = numerator / denominator;
  }
  if (minutes > BigInt(max)) return failure('HOURS_OUT_OF_RANGE', `De duur mag niet meer dan ${max} minuten zijn.`);
  return success(Number(minutes));
}

export interface MinuteInterval { startMinute: number; endMinute: number }
export interface HoursBreak {
  start: string;
  end: string;
  startDayOffset?: 0 | 1;
  endDayOffset?: 0 | 1;
}
export interface HoursShift {
  start: string;
  end: string;
  /** Required: an earlier end time never silently implies the next day. */
  endDayOffset: 0 | 1;
  /** Required, including [] to explicitly state that there were no breaks. */
  breaks: HoursBreak[];
}
export interface CalculatedHoursShift {
  grossMinutes: number;
  breakMinutes: number;
  netMinutes: number;
  /** Offsets from midnight of the shift's workDate, after subtracting breaks. */
  workedIntervals: MinuteInterval[];
}

function clockMinutes(value: unknown, allowEndOfDay = false): HoursResult<number> {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return failure('INVALID_TIME', 'Gebruik een tijdstip als 06:00.');
  if (value === '24:00' && allowEndOfDay) return success(1440);
  const [hours, minutes] = value.split(':').map(Number);
  return hours < 24 && minutes < 60 ? success(hours * 60 + minutes) : failure('INVALID_TIME', 'Het tijdstip is ongeldig.');
}

export function calculateShiftMinutes(shift: HoursShift): HoursResult<CalculatedHoursShift> {
  if (!isRecord(shift) || !hasOnlyKeys(shift, ['start', 'end', 'endDayOffset', 'breaks'])) {
    return failure('INVALID_SHIFT', 'De dienst bevat onbekende of ongeldige gegevens.');
  }
  if (shift.endDayOffset !== 0 && shift.endDayOffset !== 1) return failure('MISSING_DAY_OFFSET', 'Geef aan of de eindtijd op de volgende dag valt.');
  if (!Array.isArray(shift.breaks)) return failure('MISSING_BREAKS', 'Bevestig de pauzes, ook als er geen pauze was.');
  const start = clockMinutes(shift.start);
  const end = clockMinutes(shift.end);
  if (start.ok === false) return start;
  if (end.ok === false) return end;
  const startMinute = start.value;
  const endMinute = end.value + shift.endDayOffset * 1440;
  if (endMinute <= startMinute || endMinute - startMinute > 1440) return failure('INVALID_SHIFT_RANGE', 'Een dienst moet langer dan nul en maximaal 24 uur zijn.');
  const breaks: MinuteInterval[] = [];
  for (const [index, pause] of shift.breaks.entries()) {
    if (!isRecord(pause) || !hasOnlyKeys(pause, ['start', 'end', 'startDayOffset', 'endDayOffset'])) return failure('INVALID_BREAK', 'De pauze bevat onbekende gegevens.', `breaks.${index}`);
    const startOffset = pause.startDayOffset ?? 0;
    const endOffset = pause.endDayOffset ?? startOffset;
    if (![0, 1].includes(startOffset) || ![0, 1].includes(endOffset)) return failure('INVALID_BREAK', 'De pauzedatum is ongeldig.', `breaks.${index}`);
    const pauseStart = clockMinutes(pause.start);
    const pauseEnd = clockMinutes(pause.end);
    if (pauseStart.ok === false) return pauseStart;
    if (pauseEnd.ok === false) return pauseEnd;
    const interval = { startMinute: pauseStart.value + startOffset * 1440, endMinute: pauseEnd.value + endOffset * 1440 };
    if (interval.endMinute <= interval.startMinute || interval.startMinute < startMinute || interval.endMinute > endMinute) {
      return failure('BREAK_OUTSIDE_SHIFT', 'De volledige pauze moet binnen de dienst vallen.', `breaks.${index}`);
    }
    breaks.push(interval);
  }
  breaks.sort((a, b) => a.startMinute - b.startMinute);
  if (breaks.some((pause, index) => index > 0 && pause.startMinute < breaks[index - 1].endMinute)) {
    return failure('OVERLAPPING_BREAKS', 'Pauzes overlappen en kunnen niet dubbel worden afgetrokken.');
  }
  const workedIntervals: MinuteInterval[] = [];
  let cursor = startMinute;
  for (const pause of breaks) {
    if (pause.startMinute > cursor) workedIntervals.push({ startMinute: cursor, endMinute: pause.startMinute });
    cursor = pause.endMinute;
  }
  if (cursor < endMinute) workedIntervals.push({ startMinute: cursor, endMinute });
  const grossMinutes = endMinute - startMinute;
  const breakMinutes = breaks.reduce((sum, pause) => sum + pause.endMinute - pause.startMinute, 0);
  return success({ grossMinutes, breakMinutes, netMinutes: grossMinutes - breakMinutes, workedIntervals });
}

/** Recomputes a control total without changing the supplied components. */
export function checkMinutesTotal(components: number[], reported: number): HoursResult<number> {
  if (!Array.isArray(components) || components.length === 0 || components.some(value => !isMinutes(value)) || !isMinutes(reported)) {
    return failure('INVALID_TOTAL', 'Volledige componenten en een geldig controletotaal zijn vereist.');
  }
  const calculated = components.reduce((sum, value) => sum + value, 0);
  if (!isMinutes(calculated)) return failure('HOURS_OUT_OF_RANGE', 'Het berekende totaal is groter dan één week.');
  if (calculated !== reported) return { ok: false, issues: [{ code: 'TOTAL_MISMATCH', message: 'De som wijkt af van het aangeleverde totaal.', expectedMinutes: calculated, actualMinutes: reported }] };
  return success(calculated);
}

export interface HoursCategory { code: string; factor: string }
export interface HoursCategoryMapping { id: string; sourceCode: string; categoryCode: string }
export interface HoursWindowRule {
  id: string;
  categoryCode: string;
  /** ISO weekdays: Monday=1 through Sunday=7; overnight windows belong to this day. */
  daysOfWeek: number[];
  start: string;
  end: string;
}
export type HoursAutomaticRules =
  | { kind: 'flat'; rule: { id: string; categoryCode: string } }
  | { kind: 'time_windows'; rules: HoursWindowRule[] }
  | { kind: 'explicit_only' };
export interface HoursMatrixVersion {
  schemaVersion: 1;
  id: string;
  scope: 'client' | 'cao';
  validFrom: string;
  /** Exclusive upper bound. The start date owns an entire overnight shift. */
  validUntil?: string | null;
  confirmed: boolean;
  timeBasis: 'wall_clock';
  categories: HoursCategory[];
  categoryMappings: HoursCategoryMapping[];
  automaticRules: HoursAutomaticRules;
}
export interface HoursDayInput {
  workDate: string;
  totalMinutes: number;
  shifts?: HoursShift[];
  /** These are exclusive worked-hour categories, not additional premiums. */
  categories?: { sourceCode: string; minutes: number }[];
}
export interface HoursAllocation {
  categoryCode: string;
  factor: string;
  minutes: number;
  ruleId: string;
  sourceCategory?: string;
}
export interface ClassifiedHoursDay {
  workDate: string;
  matrixVersionId: string;
  totalMinutes: number;
  allocations: HoursAllocation[];
}
function parseDate(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
  return time;
}
function validateMatrixHeader(matrix: HoursMatrixVersion): HoursResult<true> {
  if (!isRecord(matrix) || !hasOnlyKeys(matrix, ['schemaVersion', 'id', 'scope', 'validFrom', 'validUntil', 'confirmed', 'timeBasis', 'categories', 'categoryMappings', 'automaticRules'])) return failure('UNSUPPORTED_MATRIX', 'De matrix bevat onbekende instellingen.');
  if (matrix.schemaVersion !== 1 || matrix.timeBasis !== 'wall_clock' || !['client', 'cao'].includes(matrix.scope)) return failure('UNSUPPORTED_MATRIX', 'Deze matrixversie of tijdbasis wordt nog niet ondersteund.');
  if (!hasText(matrix.id) || parseDate(matrix.validFrom) === null || (matrix.validUntil != null && (parseDate(matrix.validUntil) === null || matrix.validUntil <= matrix.validFrom))) return failure('INVALID_MATRIX_PERIOD', 'De matrix heeft geen geldige versie en geldigheidsperiode.');
  return success(true);
}

/** No guessed CAO: the caller supplies only the explicitly applicable client/CAO versions. */
export function selectEffectiveHoursMatrix(input: { workDate: string; clientVersions: HoursMatrixVersion[]; caoVersions: HoursMatrixVersion[] }): HoursResult<HoursMatrixVersion> {
  if (!input || parseDate(input.workDate) === null) return failure('INVALID_WORK_DATE', 'De werkdatum is ongeldig.');
  for (const [scope, versions] of [['client', input.clientVersions], ['cao', input.caoVersions]] as const) {
    if (!Array.isArray(versions)) return failure('MISSING_MATRIX', 'De toepasselijke matrixversies ontbreken.');
    for (const matrix of versions) {
      const valid = validateMatrixHeader(matrix);
      if (valid.ok === false) return valid;
      if (matrix.scope !== scope) return failure('MATRIX_SCOPE_MISMATCH', 'De matrix hoort niet bij de opgegeven regelbron.');
    }
    const active = versions.filter(matrix => matrix.validFrom <= input.workDate && (!matrix.validUntil || input.workDate < matrix.validUntil));
    if (active.length > 1) return failure('OVERLAPPING_MATRIX_VERSIONS', 'Meerdere matrixversies gelden op deze werkdatum.');
    if (active.length === 1) {
      const validated = validateMatrix(active[0]);
      return validated.ok === true ? success(active[0]) : validated;
    }
  }
  return failure('MISSING_MATRIX', 'Er is geen vastgelegde klant- of toepasselijke CAO-matrix voor deze werkdatum.');
}

interface ValidatedMatrix { categoryByCode: Map<string, HoursCategory>; windowSchedule: (HoursWindowRule | undefined)[] }
function validateMatrix(matrix: HoursMatrixVersion): HoursResult<ValidatedMatrix> {
  const header = validateMatrixHeader(matrix);
  if (header.ok === false) return header;
  if (matrix.confirmed !== true) return failure('UNCONFIRMED_MATRIX', 'De matrix is nog niet bevestigd.');
  if (!Array.isArray(matrix.categories) || !matrix.categories.length || !Array.isArray(matrix.categoryMappings)) return failure('INVALID_CATEGORIES', 'Uurcodes en expliciete categorie-mappings moeten worden vastgelegd.');
  const categoryByCode = new Map<string, HoursCategory>();
  for (const category of matrix.categories) {
    if (!isRecord(category) || !hasOnlyKeys(category, ['code', 'factor']) || !hasText(category.code) || typeof category.factor !== 'string' || !/^\d+(?:\.\d+)?$/.test(category.factor) || category.factor.length > 20 || !Number.isFinite(Number(category.factor)) || Number(category.factor) <= 0) return failure('INVALID_CATEGORY', 'Elke uurcode vereist een expliciet vastgelegde positieve factor.');
    if (categoryByCode.has(category.code)) return failure('DUPLICATE_CATEGORY', 'Dezelfde uurcode is meer dan eenmaal ingericht.');
    categoryByCode.set(category.code, category);
  }
  const ids = new Set<string>();
  const sourceCodes = new Set<string>();
  const validateRule = (rule: { id: string; categoryCode: string }): boolean => {
    if (!hasText(rule.id) || ids.has(rule.id) || !categoryByCode.has(rule.categoryCode)) return false;
    ids.add(rule.id);
    return true;
  };
  for (const mapping of matrix.categoryMappings) {
    if (!isRecord(mapping) || !hasOnlyKeys(mapping, ['id', 'sourceCode', 'categoryCode']) || !hasText(mapping.sourceCode) || sourceCodes.has(mapping.sourceCode) || !validateRule(mapping)) return failure('CONFLICTING_CATEGORY_MAPPING', 'De categorie-mapping ontbreekt, is dubbel of verwijst naar een onbekende uurcode.');
    sourceCodes.add(mapping.sourceCode);
  }
  const automatic = matrix.automaticRules;
  const windowSchedule: (HoursWindowRule | undefined)[] = new Array(10080);
  if (!isRecord(automatic)) return failure('UNSUPPORTED_RULES', 'De automatische indelingsregels ontbreken.');
  if (automatic.kind === 'explicit_only' && hasOnlyKeys(automatic, ['kind'])) return success({ categoryByCode, windowSchedule });
  if (automatic.kind === 'flat') {
    if (!hasOnlyKeys(automatic, ['kind', 'rule']) || !isRecord(automatic.rule) || !hasOnlyKeys(automatic.rule, ['id', 'categoryCode']) || !validateRule(automatic.rule)) return failure('INVALID_FLAT_RULE', 'De vaste uurcode is niet eenduidig ingericht.');
    return success({ categoryByCode, windowSchedule });
  }
  if (automatic.kind !== 'time_windows' || !hasOnlyKeys(automatic, ['kind', 'rules']) || !Array.isArray(automatic.rules) || !automatic.rules.length) return failure('UNSUPPORTED_RULES', 'Deze indeling of samenloop van regels wordt nog niet ondersteund.');
  for (const rule of automatic.rules) {
    if (!isRecord(rule) || !hasOnlyKeys(rule, ['id', 'categoryCode', 'daysOfWeek', 'start', 'end']) || !validateRule(rule) || !Array.isArray(rule.daysOfWeek) || rule.daysOfWeek.length === 0 || new Set(rule.daysOfWeek).size !== rule.daysOfWeek.length || rule.daysOfWeek.some(day => !Number.isInteger(day) || day < 1 || day > 7)) return failure('INVALID_WINDOW_RULE', 'Een tijdvenster heeft geen eenduidige regel, weekdagen en uurcode.');
    const start = clockMinutes(rule.start);
    const end = clockMinutes(rule.end, true);
    if (start.ok === false) return start;
    if (end.ok === false) return end;
    if (start.value === end.value) return failure('INVALID_WINDOW_RULE', 'Een tijdvenster met gelijke tijden is ambigu; gebruik 00:00–24:00 voor een hele dag.');
    const duration = end.value > start.value ? end.value - start.value : 1440 - start.value + end.value;
    for (const day of rule.daysOfWeek) {
      for (let minute = 0; minute < duration; minute++) {
        const index = ((day - 1) * 1440 + start.value + minute) % 10080;
        if (windowSchedule[index]) return failure('OVERLAPPING_WINDOW_RULES', 'Tijdvensters overlappen; leg eerst de samenloop eenduidig vast.');
        windowSchedule[index] = rule;
      }
    }
  }
  return success({ categoryByCode, windowSchedule });
}

/** Wall-clock v1 cannot resolve missing/duplicated DST times. Block timed shifts on that civil date. */
function hasAmsterdamClockChange(date: number): boolean {
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23' });
  return formatter.format(new Date(date - 12 * 3600000)) !== formatter.format(new Date(date + 12 * 3600000));
}

export function classifyHoursDay(day: HoursDayInput, matrix: HoursMatrixVersion): HoursResult<ClassifiedHoursDay> {
  if (!isRecord(day) || !hasOnlyKeys(day, ['workDate', 'totalMinutes', 'shifts', 'categories'])) return failure('INVALID_DAY', 'De dag bevat onbekende gegevens.');
  const date = parseDate(day.workDate);
  if (date === null) return failure('INVALID_WORK_DATE', 'De werkdatum is ongeldig.');
  if (!isMinutes(day.totalMinutes, 1440)) return failure('INVALID_DAY_TOTAL', 'Het dagtotaal moet tussen 0 en 1440 gehele minuten liggen.');
  const validated = validateMatrix(matrix);
  if (validated.ok === false) return validated;
  if (day.workDate < matrix.validFrom || (matrix.validUntil && day.workDate >= matrix.validUntil)) return failure('MATRIX_NOT_EFFECTIVE', 'Deze matrixversie geldt niet op de werkdatum.');
  const intervals: MinuteInterval[] = [];
  if (day.shifts !== undefined) {
    if (!Array.isArray(day.shifts) || day.shifts.length === 0) return failure('MISSING_SHIFT_TIMES', 'De diensttijden ontbreken.');
    const shiftRanges: MinuteInterval[] = [];
    let totalMinutes = 0;
    for (const shift of day.shifts) {
      const calculated = calculateShiftMinutes(shift);
      if (calculated.ok === false) return calculated;
      const start = clockMinutes(shift.start);
      // calculateShiftMinutes has already validated the clock values.
      if (start.ok === false) return start;
      const range = { startMinute: start.value, endMinute: start.value + calculated.value.grossMinutes };
      shiftRanges.push(range);
      if (hasAmsterdamClockChange(date) || (range.endMinute > 1440 && hasAmsterdamClockChange(date + 86400000))) return failure('DST_REQUIRES_REVIEW', 'Deze dienst valt op een klokwisseldag; bevestig de werkelijk gewerkte duur en uurcategorieën.');
      totalMinutes += calculated.value.netMinutes;
      intervals.push(...calculated.value.workedIntervals);
    }
    shiftRanges.sort((a, b) => a.startMinute - b.startMinute);
    if (shiftRanges.some((range, index) => index > 0 && range.startMinute < shiftRanges[index - 1].endMinute)) return failure('OVERLAPPING_SHIFTS', 'Diensten overlappen en zouden gewerkte tijd dubbel tellen.');
    const total = checkMinutesTotal([totalMinutes], day.totalMinutes);
    if (total.ok === false) return total;
  }
  const allocations: HoursAllocation[] = [];
  const append = (categoryCode: string, ruleId: string, minutes: number, sourceCategory?: string) => {
    const previous = allocations.find(item => item.ruleId === ruleId && item.sourceCategory === sourceCategory);
    if (previous) previous.minutes += minutes;
    else allocations.push({ categoryCode, ruleId, factor: validated.value.categoryByCode.get(categoryCode)!.factor, minutes, ...(sourceCategory === undefined ? {} : { sourceCategory }) });
  };
  if (day.categories !== undefined) {
    if (!Array.isArray(day.categories) || day.categories.length === 0) return failure('MISSING_CATEGORIES', 'De aangeleverde uurcategorieën ontbreken.');
    const sourceCodes = new Set<string>();
    for (const category of day.categories) {
      if (!isRecord(category) || !hasOnlyKeys(category, ['sourceCode', 'minutes']) || !hasText(category.sourceCode) || !isMinutes(category.minutes, 1440) || sourceCodes.has(category.sourceCode)) return failure('INVALID_SOURCE_CATEGORY', 'Aangeleverde uurcategorieën moeten eenduidig zijn en gehele minuten bevatten.');
      sourceCodes.add(category.sourceCode);
      const mapping = matrix.categoryMappings.find(item => item.sourceCode === category.sourceCode);
      if (!mapping) return failure('UNMAPPED_SOURCE_CATEGORY', `Voor categorie ${category.sourceCode} ontbreekt een bevestigde uurcode.`);
      append(mapping.categoryCode, mapping.id, category.minutes, category.sourceCode);
    }
    const total = checkMinutesTotal(day.categories.map(category => category.minutes), day.totalMinutes);
    if (total.ok === false) return total;
  } else if (matrix.automaticRules.kind === 'flat') {
    append(matrix.automaticRules.rule.categoryCode, matrix.automaticRules.rule.id, day.totalMinutes);
  } else if (matrix.automaticRules.kind === 'time_windows') {
    if (day.shifts === undefined) return failure('MISSING_SHIFT_TIMES', 'Start-, eind- en pauzetijden zijn nodig voor indeling over tijdvensters.');
    const isoDay = (new Date(date).getUTCDay() + 6) % 7;
    for (const interval of intervals) {
      for (let minute = interval.startMinute; minute < interval.endMinute; minute++) {
        const rule = validated.value.windowSchedule[(isoDay * 1440 + minute) % 10080];
        if (!rule) return failure('MISSING_WINDOW_RULE', 'Voor een deel van de gewerkte tijd ontbreekt een toepasselijke tijdvensterregel.');
        append(rule.categoryCode, rule.id, 1);
      }
    }
  } else return failure('MISSING_CATEGORIES', 'Deze matrix vereist expliciet aangeleverde uurcategorieën.');
  return success({ workDate: day.workDate, matrixVersionId: matrix.id, totalMinutes: day.totalMinutes, allocations });
}
