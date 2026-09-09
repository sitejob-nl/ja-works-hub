import { parseHoursToMinutes, type HoursIssue } from './hours-calculation.ts';
import { matchHoursMember, prepareHoursMembers, type HoursWeekMember } from './hours-member-match.ts';
import { sourceControlIssues, type HoursSourceInput } from './hours-source-control.ts';

/**
 * Turning a scanned or photographed timesheet into reviewable proposals.
 *
 * The model reads; this kernel decides. Everything the model returns is text as
 * it appeared on the paper, and every judgement that could hand hours to the
 * wrong person, the wrong day or the wrong number is made here, deterministically,
 * against the week the reader is allowed to see. A proposal is still not an hour:
 * only hours_apply_source_proposal writes a day revision, and it takes the
 * proposal literally.
 */
export interface ScanWeekDay { id: string; memberId: string; workDate: string }
export interface ScanContext {
  members: HoursWeekMember[];
  days: ScanWeekDay[];
  /** How many pages the delivery has, when that could be established. */
  pageCount: number | null;
}

/**
 * What may be reported as read but not certain. Deliberately short and closed:
 * an uncertainty this list does not know is a broken contract, not a value to
 * quietly drop. "employee" and "date" are absent on purpose — doubt about who or
 * which day has nowhere to land in a proposal, so it steers the assignment or
 * removes the line entirely.
 */
export const SCAN_UNCERTAIN_FIELDS = ['total', 'shift', 'break', 'categories', 'reason'] as const;
export type ScanUncertainField = (typeof SCAN_UNCERTAIN_FIELDS)[number];
/**
 * Everything the model may report as unsure. Two of them steer rather than
 * travel: doubt about who becomes an uncertain assignment, doubt about which
 * day removes the line. This is the list the model's own schema offers, so the
 * two can never drift into a reading that fails on a label nobody rejected.
 */
export const REPORTABLE_UNCERTAINTY = ['employee', 'date', ...SCAN_UNCERTAIN_FIELDS] as const;

/**
 * Which deliveries the paid reader accepts. A workbook has its own free,
 * deterministic reader and a legacy .xls has none at all, so neither is offered
 * a route that costs money and could not help them. The endpoint, the screen
 * and the database all answer this question; they answer it from here.
 */
export const HOURS_READABLE_SCAN_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

/** One reading may record at most this many proposals; the database agrees. */
export const HOURS_SCAN_MAX_ENTRIES = 500;

/** Exactly what a scan line offers for review, with where it was found. */
export interface ScanCandidate {
  dayId: string; memberId: string; employeeName: string; workDate: string;
  minutes: number; noHoursReason: string | null;
  sourceInput: HoursSourceInput | null;
  pageNumber: number; pageLabel: string;
  assignmentUncertain: boolean;
  uncertainFields: ScanUncertainField[];
  /** What the paper literally said about this employee. */
  employeeText: string;
  /** The literal readings behind the numbers, so a reviewer can compare. */
  readText: { total: string | null; start: string | null; end: string | null; break: string | null };
  notices: HoursIssue[];
}
export interface ScanSkippedLine { pageNumber: number | null; text: string; reason: string }
export interface ScanUnreadPage { pageNumber: number; reason: string }

export type ScanReading =
  | { ok: false; issues: HoursIssue[] }
  | {
      ok: true; candidates: ScanCandidate[]; skipped: ScanSkippedLine[];
      pagesRead: number[]; pagesUnread: ScanUnreadPage[];
    };

const ENTRY_FIELDS = ['employee_text', 'work_date', 'page_number', 'location_text', 'total_text',
  'no_hours_text', 'start_text', 'end_text', 'break_text', 'categories', 'uncertain'];
const CATEGORY_FIELDS = ['code_text', 'duration_text'];
const UNREADABLE_FIELDS = ['page_number', 'reason'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, allowed: string[]): boolean =>
  Object.keys(value).every(key => allowed.includes(key));
const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};
const fail = (code: string, message: string): ScanReading => ({ ok: false, issues: [{ code, message }] });

/**
 * A dash, a cross or "not applicable" says "nothing is written here". It is not
 * the claim that somebody did not work, so it never becomes a reason.
 */
const EMPTY_MARKERS = new Set(['-', '--', '\u2013', '\u2014', '\u2212', '\u2011', 'x', '.', '/',
  'n.v.t.', 'nvt', 'n/a', 'na']);
const isEmptyMarker = (value: string): boolean => EMPTY_MARKERS.has(value.trim().toLowerCase().replace(/\s+/g, ''));

const formatMinutes = (minutes: number): string =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

const CLOCK = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/;
function clockText(value: string): string | null {
  const match = CLOCK.exec(value.trim());
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
}
const clockMinutes = (value: string): number => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

interface BreakReading {
  windows: { start: string; end: string }[] | null;
  /** Minutes, when the paper wrote a plain duration instead of a window. */
  durationMinutes: number | null;
  unreadable: boolean;
}

/**
 * A break is written either as windows ("12:00-12:30") or as a bare duration
 * ("30"). A duration says how long, never when; inventing a window for it would
 * be exactly the guess this module avoids, so it is kept out of the stored
 * breakdown and used only to check whether the day adds up.
 */
function readBreak(value: string): BreakReading {
  const parts = value.split(/[;,]/).map(part => part.trim()).filter(Boolean);
  if (!parts.length) return { windows: null, durationMinutes: null, unreadable: true };
  const windows: { start: string; end: string }[] = [];
  for (const part of parts) {
    const range = /^(.+?)\s*(?:-|–|—|t\/m|tot)\s*(.+)$/.exec(part);
    const start = range ? clockText(range[1]) : null;
    const end = range ? clockText(range[2]) : null;
    if (!start || !end) { windows.length = 0; break; }
    windows.push({ start, end });
  }
  if (windows.length === parts.length) return { windows, durationMinutes: null, unreadable: false };
  if (parts.length > 1) return { windows: null, durationMinutes: null, unreadable: true };
  const bare = /^(\d{1,3})\s*(?:min(?:uten|uut)?\.?)?$/i.exec(parts[0]);
  if (bare) {
    const minutes = Number(bare[1]);
    return minutes <= 1440
      ? { windows: null, durationMinutes: minutes, unreadable: false }
      : { windows: null, durationMinutes: null, unreadable: true };
  }
  const duration = parseHoursToMinutes(parts[0], { maxMinutes: 1440 });
  return duration.ok
    ? { windows: null, durationMinutes: duration.value, unreadable: false }
    : { windows: null, durationMinutes: null, unreadable: true };
}

interface Line {
  employeeText: string; workDate: string; pageNumber: number; locationText: string;
  totalText: string | null; noHoursText: string | null;
  startText: string | null; endText: string | null; breakText: string | null;
  categories: { codeText: string; durationText: string }[] | null;
  uncertain: Set<string>;
}

/**
 * Two kinds of wrong answer, deliberately kept apart.
 *
 * A broken *shape* — an unknown field, a wrong type, an uncertainty label the
 * contract does not have — means the model did not honour the schema, and the
 * whole reading is refused. A badly filled *line* — a blank name on a totals
 * row, a date the model could not normalise, a page the file does not have —
 * is one line on a piece of paper, and losing forty other lines over it would
 * throw away a reading that was already paid for.
 */
type LineReading = { ok: true; line: Line } | { ok: false; fatal: boolean; reason: string };
const brokenShape: LineReading = { ok: false, fatal: true, reason: '' };
const badLine = (reason: string): LineReading => ({ ok: false, fatal: false, reason });

function readLine(value: unknown): LineReading {
  if (!isRecord(value) || !hasOnly(value, ENTRY_FIELDS)) return brokenShape;
  const employeeText = text(value.employee_text);
  const workDate = text(value.work_date);
  const locationText = text(value.location_text);
  const pageNumber = value.page_number;
  if (typeof pageNumber !== 'number' || !Number.isSafeInteger(pageNumber)) return brokenShape;
  if (!employeeText) return badLine('Op deze regel staat geen naam.');
  if (!workDate || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return badLine('De datum van deze regel is niet als kalenderdatum gelezen.');
  }
  if (employeeText.length > 200 || (locationText?.length ?? 0) > 200) {
    return badLine('Deze regel is onbruikbaar lang gelezen.');
  }
  let categories: Line['categories'] = null;
  if (value.categories !== undefined && value.categories !== null) {
    if (!Array.isArray(value.categories) || value.categories.length > 64) return brokenShape;
    categories = [];
    for (const raw of value.categories) {
      if (!isRecord(raw) || !hasOnly(raw, CATEGORY_FIELDS)) return brokenShape;
      const codeText = text(raw.code_text);
      const durationText = text(raw.duration_text);
      if (!codeText || codeText.length > 200 || (durationText?.length ?? 0) > 64) {
        return badLine('Een urensoort op deze regel is onbruikbaar gelezen.');
      }
      categories.push({ codeText, durationText: durationText ?? '' });
    }
  }
  const uncertain = new Set<string>();
  if (value.uncertain !== undefined && value.uncertain !== null) {
    if (!Array.isArray(value.uncertain)) return brokenShape;
    for (const field of value.uncertain) {
      // An uncertainty this contract does not know may not be silently dropped:
      // that would turn the model's own doubt into apparent certainty.
      if (typeof field !== 'string' || !(REPORTABLE_UNCERTAINTY as readonly string[]).includes(field)) return brokenShape;
      uncertain.add(field);
    }
  }
  for (const key of ['total_text', 'no_hours_text', 'start_text', 'end_text', 'break_text']) {
    const raw = value[key];
    if (raw !== undefined && raw !== null && typeof raw !== 'string') return brokenShape;
    if (typeof raw === 'string' && raw.length > 200) return badLine('Deze regel is onbruikbaar lang gelezen.');
  }
  return { ok: true, line: {
    employeeText, workDate, pageNumber, locationText: locationText ?? '',
    totalText: text(value.total_text), noHoursText: text(value.no_hours_text),
    startText: text(value.start_text), endText: text(value.end_text), breakText: text(value.break_text),
    categories, uncertain,
  } };
}

/**
 * Which field a reviewer has to go and check when the shared control refuses a
 * delivered breakdown. Anything unlisted lands on the total, which is the one
 * field every proposal carries.
 */
const CONTROL_FIELD: Record<string, ScanUncertainField> = {
  TOTAL_MISMATCH: 'total', HOURS_OUT_OF_RANGE: 'total', INVALID_TOTAL: 'total',
  INVALID_ZERO_SOURCE: 'total',
  BREAK_OUTSIDE_SHIFT: 'break', OVERLAPPING_BREAKS: 'break', MISSING_BREAKS: 'break',
  INVALID_BREAK: 'break', INVALID_BREAK_RANGE: 'break',
  OVERLAPPING_SHIFTS: 'shift', INVALID_SHIFT: 'shift', INVALID_SHIFT_RANGE: 'shift',
  MISSING_DAY_OFFSET: 'shift', INVALID_TIME: 'shift',
  DUPLICATE_SOURCE_CATEGORY: 'categories',
};

/** Reported in a fixed order so two readings of one file describe it identically. */
const orderUncertain = (fields: Set<string>): ScanUncertainField[] =>
  SCAN_UNCERTAIN_FIELDS.filter(field => fields.has(field));

export function interpretScanReading(raw: unknown, context: ScanContext): ScanReading {
  if (!isRecord(raw) || !hasOnly(raw, ['entries', 'unreadable']) || !Array.isArray(raw.entries)) {
    return fail('INVALID_SCAN_RESULT', 'De uitlezing leverde geen bruikbaar resultaat op. Er zijn geen voorstellen gemaakt.');
  }
  // One reading is one handling, so the reader never produces more than one
  // handling can record. A larger cap would promise a remainder that is lost
  // the moment the first part is saved.
  if (raw.entries.length > HOURS_SCAN_MAX_ENTRIES) {
    return fail('SCAN_TOO_LARGE', 'De uitlezing leverde meer regels op dan in één aanlevering passen. '
      + 'Bekijk de bron zelf en splits hem, of leg de uren handmatig vast.');
  }
  const pagesUnread: ScanUnreadPage[] = [];
  if (raw.unreadable !== undefined && raw.unreadable !== null) {
    if (!Array.isArray(raw.unreadable) || raw.unreadable.length > 200) {
      return fail('INVALID_SCAN_RESULT', 'De uitlezing leverde geen bruikbaar resultaat op. Er zijn geen voorstellen gemaakt.');
    }
    for (const value of raw.unreadable) {
      if (!isRecord(value) || !hasOnly(value, UNREADABLE_FIELDS) || typeof value.page_number !== 'number'
        || !Number.isSafeInteger(value.page_number) || !text(value.reason)) {
        return fail('INVALID_SCAN_RESULT', 'De uitlezing leverde geen bruikbaar resultaat op. Er zijn geen voorstellen gemaakt.');
      }
      pagesUnread.push({ pageNumber: value.page_number, reason: text(value.reason)!.slice(0, 200) });
    }
  }

  const candidates: ScanCandidate[] = [];
  const skipped: ScanSkippedLine[] = [];
  const pagesRead = new Set<number>();
  const seenDays = new Map<string, string>();
  // The week does not change while a reading runs, so it is taken apart once
  // rather than per line: a large crew otherwise costs a linear scan of every
  // day and a fresh normalisation of every name for each of the entries.
  const members = prepareHoursMembers(context.members);
  const dayIndex = new Map(context.days.map(day => [`${day.memberId}|${day.workDate}`, day]));

  for (const value of raw.entries) {
    const parsed = readLine(value);
    if (parsed.ok === false) {
      if (parsed.fatal) {
        return fail('INVALID_SCAN_RESULT', 'De uitlezing leverde geen bruikbaar resultaat op. Er zijn geen voorstellen gemaakt.');
      }
      const spot = isRecord(value) && typeof value.location_text === 'string' && value.location_text.trim()
        ? value.location_text.trim().slice(0, 200) : 'onbekende plek';
      skipped.push({ pageNumber: null, text: spot, reason: parsed.reason });
      continue;
    }
    const line = parsed.line;
    const where = line.locationText || `pagina ${line.pageNumber}`;
    const skip = (reason: string) => skipped.push({ pageNumber: line.pageNumber, text: `${line.employeeText} · ${where}`, reason });

    if (line.uncertain.has('date')) {
      skip('De uitlezing wist niet zeker om welke datum het gaat. Beoordeel deze regel zelf in de bron.');
      continue;
    }
    // 2000 is the bound the database enforces; proposing beyond it would make
    // the whole recording fail after the reading was already paid for.
    if (line.pageNumber < 1 || line.pageNumber > 2000
      || (context.pageCount !== null && line.pageNumber > context.pageCount)) {
      skip('Deze pagina bestaat niet in de aangeleverde bron.');
      continue;
    }
    const match = matchHoursMember(line.employeeText, members);
    if (!match) {
      skipped.push({ pageNumber: line.pageNumber, text: line.employeeText,
        reason: 'Deze naam past bij niemand of bij meerdere medewerkers van deze week.' });
      continue;
    }
    const day = dayIndex.get(`${match.member.id}|${line.workDate}`);
    if (!day) {
      skip('Deze datum is geen werkdag van deze medewerker in deze week.');
      continue;
    }
    const earlier = seenDays.get(day.id);
    if (earlier) {
      return fail('DUPLICATE_SCAN_DAY', `Deze bron beschrijft dezelfde werkdag van ${match.member.name} tweemaal `
        + `(${earlier} en ${where}). Kies zelf welke regel klopt en leg die als voorstel vast.`);
    }

    const uncertain = new Set<string>(line.uncertain);
    const notices: HoursIssue[] = [];

    // Hours first: without a readable duration or an explicit reason there is
    // nothing to propose, and no reported certainty changes that.
    let minutes: number | null = null;
    let noHoursReason: string | null = null;
    if (line.totalText !== null && !isEmptyMarker(line.totalText)) {
      const parsed = parseHoursToMinutes(line.totalText, { maxMinutes: 1440 });
      if (parsed.ok === false) {
        skip(`Het aantal uren is gelezen als “${line.totalText}” en dat is geen bruikbare duur.`);
        continue;
      }
      minutes = parsed.value;
      // A dot means decimal in one notation and a clock in the other, and a
      // timesheet uses both. Where the two readings differ, the paper does not
      // say which was meant, so the reader reports both and asks.
      const asClock = clockText(line.totalText);
      if (asClock !== null && clockMinutes(asClock) !== minutes) {
        uncertain.add('total');
        notices.push({ code: 'AMBIGUOUS_SCAN_TOTAL',
          message: `“${line.totalText}” kan ${formatMinutes(minutes)} of ${formatMinutes(clockMinutes(asClock))} betekenen; `
            + 'de bron zegt niet welke van de twee.' });
      }
    }
    const reason = line.noHoursText !== null && !isEmptyMarker(line.noHoursText) ? line.noHoursText : null;
    if (minutes !== null && minutes > 0 && reason) {
      skip(`De bron noemt zowel ${line.totalText} uur als “${reason}”; die spreken elkaar tegen.`);
      continue;
    }
    if (minutes !== null && minutes > 0) {
      noHoursReason = null;
    } else if (reason) {
      minutes = 0;
      noHoursReason = reason.slice(0, 500);
    } else {
      skip(minutes === 0
        ? 'Er staan nul uren zonder reden. Leg zelf vast waarom er niet is gewerkt.'
        : 'Er is geen aantal uren en geen reden gelezen voor deze dag.');
      continue;
    }

    // A shift is only stored when both ends are on the paper. Half a shift is a
    // missing fact, not an uncertain one, so it is named instead of guessed at.
    const source: HoursSourceInput = { schemaVersion: 1 };
    const start = line.startText ? clockText(line.startText) : null;
    const end = line.endText ? clockText(line.endText) : null;
    if (line.startText && !start) notices.push({ code: 'INCOMPLETE_SCAN_SHIFT', message: `De begintijd is gelezen als “${line.startText}” en is geen tijdstip.` });
    if (line.endText && !end) notices.push({ code: 'INCOMPLETE_SCAN_SHIFT', message: `De eindtijd is gelezen als “${line.endText}” en is geen tijdstip.` });
    if ((line.startText || line.endText) && !(start && end)) {
      notices.push({ code: 'INCOMPLETE_SCAN_SHIFT',
        message: 'Er is maar een deel van de diensttijd gelezen; de dienst is daarom niet overgenomen.' });
    }
    const breakReading = line.breakText ? readBreak(line.breakText) : null;
    if (breakReading?.unreadable) {
      uncertain.add('break');
      notices.push({ code: 'UNREADABLE_SCAN_BREAK', message: `De pauze is gelezen als “${line.breakText}” en is niet te herleiden.` });
    }
    if (start && end && minutes > 0 && clockMinutes(end) === clockMinutes(start)) {
      // A start equal to the end is a repeated cell, never a twenty-four hour
      // day. Reading it as one would put a full day on the paper's authority.
      notices.push({ code: 'INCOMPLETE_SCAN_SHIFT',
        message: `Begin- en eindtijd zijn allebei als ${start} gelezen; de dienst is daarom niet overgenomen.` });
    } else if (start && end && minutes > 0 && !breakReading?.unreadable) {
      const crossesMidnight = clockMinutes(end) < clockMinutes(start);
      if (crossesMidnight) {
        // Reading an earlier end as the next day is the likely meaning and never
        // a silent one: it changes the length of the day, so it is marked.
        uncertain.add('shift');
        notices.push({ code: 'SCAN_SHIFT_CROSSES_MIDNIGHT',
          message: 'De eindtijd ligt vóór de begintijd; de dienst is gelezen als doorlopend naar de volgende dag.' });
      }
      if (breakReading?.windows) {
        // A break belongs to the day the shift is on at that hour. Stamping
        // every window as day zero puts a two-o'clock break twenty hours before
        // a shift that began at ten in the evening, which the calculation
        // kernel then rejects for the rest of that day's life.
        source.shifts = [{
          start, end, endDayOffset: crossesMidnight ? 1 : 0,
          breaks: breakReading.windows.map(window => {
            const offset = crossesMidnight && clockMinutes(window.start) < clockMinutes(start) ? 1 : 0;
            return { ...window, startDayOffset: offset as 0 | 1, endDayOffset: offset as 0 | 1 };
          }),
        }];
      } else if (!breakReading) {
        source.shifts = [{ start, end, endDayOffset: crossesMidnight ? 1 : 0, breaks: [] }];
      } else {
        // A bare duration says how long the break was, never when. The stored
        // shape has no room for that, so the shift is left out — and said so,
        // because a fact this reader dropped is never dropped silently. It still
        // decides whether the written times and the written total agree.
        notices.push({ code: 'INCOMPLETE_SCAN_SHIFT',
          message: `De pauze is als duur gelezen (“${line.breakText}”) en niet als tijdvak, `
            + 'dus de dienst is niet overgenomen. De uren zelf blijven staan.' });
        const gross = clockMinutes(end) + (crossesMidnight ? 1440 : 0) - clockMinutes(start);
        const net = gross - (breakReading.durationMinutes ?? 0);
        if (net !== minutes) {
          uncertain.add('total');
          notices.push({ code: 'TOTAL_MISMATCH',
            message: 'De gelezen diensttijd wijkt af van het opgeschreven totaal.',
            expectedMinutes: net > 0 ? net : 0, actualMinutes: minutes });
        }
      }
    }

    if (line.categories?.length && minutes > 0) {
      const parsed = line.categories.map(category => ({
        category, minutes: parseHoursToMinutes(category.durationText, { maxMinutes: 1440 }),
      }));
      const broken = parsed.filter(item => item.minutes.ok === false);
      if (broken.length) {
        // Half a breakdown is more misleading than none: it would look like a
        // complete division of a day that it is not.
        uncertain.add('categories');
        for (const item of broken) {
          notices.push({ code: 'UNREADABLE_SCAN_CATEGORY',
            message: `De duur bij ${item.category.codeText} is gelezen als “${item.category.durationText}” en is niet te herleiden.` });
        }
      } else {
        source.categories = parsed.map(item => ({
          sourceCode: item.category.codeText, minutes: item.minutes.ok ? item.minutes.value : 0,
        }));
      }
    } else if (line.categories?.length) {
      notices.push({ code: 'INVALID_ZERO_SOURCE',
        message: 'Er is een indeling gelezen bij een dag zonder uren; die is niet overgenomen.' });
    }

    const sourceInput = source.shifts || source.categories ? source : null;
    // The same control a person entering this day by hand would see, so the
    // machine and the human report the same contradictions about one delivery.
    //
    // Every one of them makes the proposal uncertain, not just a mismatching
    // total. A notice does not travel with the proposal; only recorded doubt
    // does, and a breakdown the calculation kernel refuses would otherwise be
    // applied blind and leave a day that can never be classified.
    for (const issue of sourceControlIssues(minutes, sourceInput)) {
      notices.push(issue);
      uncertain.add(CONTROL_FIELD[issue.code] ?? 'total');
    }

    // Doubt about something the paper never showed has nowhere to land: it would
    // block applying on a field the reviewer cannot go and check. Doubt about
    // something that *was* written stays, even when the reader decided not to
    // carry it into the proposal — that is exactly the case a person has to
    // look at.
    const written: Record<ScanUncertainField, boolean> = {
      total: true, shift: !!(line.startText || line.endText), break: !!line.breakText,
      categories: !!line.categories?.length, reason: noHoursReason !== null,
    };
    for (const field of [...uncertain]) {
      if (!written[field as ScanUncertainField]) uncertain.delete(field);
    }

    seenDays.set(day.id, where);
    candidates.push({
      dayId: day.id, memberId: match.member.id, employeeName: match.member.name, workDate: day.workDate,
      minutes, noHoursReason, sourceInput,
      pageNumber: line.pageNumber, pageLabel: line.locationText.slice(0, 200),
      assignmentUncertain: match.uncertain || line.uncertain.has('employee'),
      uncertainFields: orderUncertain(uncertain),
      employeeText: line.employeeText,
      readText: { total: line.totalText, start: line.startText, end: line.endText, break: line.breakText },
      notices,
    });
    pagesRead.add(line.pageNumber);
  }

  return { ok: true, candidates, skipped, pagesRead: [...pagesRead].sort((a, b) => a - b), pagesUnread };
}
