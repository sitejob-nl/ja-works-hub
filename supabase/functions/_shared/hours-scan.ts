import { parseHoursToMinutes, type HoursIssue } from './hours-calculation.ts';
import { matchHoursMember, type HoursWeekMember } from './hours-member-match.ts';
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
const REPORTABLE_UNCERTAINTY = [...SCAN_UNCERTAIN_FIELDS, 'employee', 'date'] as const;

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
const EMPTY_MARKERS = new Set(['-', '--', '—', 'x', 'X', '.', '/', 'n.v.t.', 'nvt', 'n/a', 'na']);
const isEmptyMarker = (value: string): boolean => EMPTY_MARKERS.has(value.trim().toLowerCase().replace(/\s+/g, ''));

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

function readLine(value: unknown): Line | null {
  if (!isRecord(value) || !hasOnly(value, ENTRY_FIELDS)) return null;
  const employeeText = text(value.employee_text);
  const workDate = text(value.work_date);
  const locationText = text(value.location_text);
  const pageNumber = value.page_number;
  if (!employeeText || !workDate || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)
    || typeof pageNumber !== 'number' || !Number.isSafeInteger(pageNumber)) return null;
  if (employeeText.length > 200 || (locationText?.length ?? 0) > 200) return null;
  let categories: Line['categories'] = null;
  if (value.categories !== undefined && value.categories !== null) {
    if (!Array.isArray(value.categories) || value.categories.length > 64) return null;
    categories = [];
    for (const raw of value.categories) {
      if (!isRecord(raw) || !hasOnly(raw, CATEGORY_FIELDS)) return null;
      const codeText = text(raw.code_text);
      const durationText = text(raw.duration_text);
      if (!codeText || codeText.length > 200 || (durationText?.length ?? 0) > 64) return null;
      categories.push({ codeText, durationText: durationText ?? '' });
    }
  }
  const uncertain = new Set<string>();
  if (value.uncertain !== undefined && value.uncertain !== null) {
    if (!Array.isArray(value.uncertain)) return null;
    for (const field of value.uncertain) {
      // An uncertainty this contract does not know may not be silently dropped:
      // that would turn the model's own doubt into apparent certainty.
      if (typeof field !== 'string' || !(REPORTABLE_UNCERTAINTY as readonly string[]).includes(field)) return null;
      uncertain.add(field);
    }
  }
  for (const key of ['total_text', 'no_hours_text', 'start_text', 'end_text', 'break_text']) {
    const raw = value[key];
    if (raw !== undefined && raw !== null && (typeof raw !== 'string' || raw.length > 200)) return null;
  }
  return {
    employeeText, workDate, pageNumber, locationText: locationText ?? '',
    totalText: text(value.total_text), noHoursText: text(value.no_hours_text),
    startText: text(value.start_text), endText: text(value.end_text), breakText: text(value.break_text),
    categories, uncertain,
  };
}

/** Reported in a fixed order so two readings of one file describe it identically. */
const orderUncertain = (fields: Set<string>): ScanUncertainField[] =>
  SCAN_UNCERTAIN_FIELDS.filter(field => fields.has(field));

export function interpretScanReading(raw: unknown, context: ScanContext): ScanReading {
  if (!isRecord(raw) || !hasOnly(raw, ['entries', 'unreadable']) || !Array.isArray(raw.entries)) {
    return fail('INVALID_SCAN_RESULT', 'De uitlezing leverde geen bruikbaar resultaat op. Er zijn geen voorstellen gemaakt.');
  }
  if (raw.entries.length > HOURS_SCAN_MAX_ENTRIES * 2) {
    return fail('SCAN_TOO_LARGE', 'De uitlezing leverde meer regels op dan één aanlevering kan bevatten. Bekijk de bron zelf.');
  }
  const pagesUnread: ScanUnreadPage[] = [];
  if (raw.unreadable !== undefined && raw.unreadable !== null) {
    if (!Array.isArray(raw.unreadable) || raw.unreadable.length > 200) {
      return fail('INVALID_SCAN_RESULT', 'De uitlezing leverde geen bruikbaar resultaat op. Er zijn geen voorstellen gemaakt.');
    }
    for (const value of raw.unreadable) {
      if (!isRecord(value) || !hasOnly(value, UNREADABLE_FIELDS) || typeof value.page_number !== 'number'
        || !Number.isSafeInteger(value.page_number)) {
        return fail('INVALID_SCAN_RESULT', 'De uitlezing leverde geen bruikbaar resultaat op. Er zijn geen voorstellen gemaakt.');
      }
      pagesUnread.push({ pageNumber: value.page_number, reason: text(value.reason) ?? 'Onleesbaar' });
    }
  }

  const candidates: ScanCandidate[] = [];
  const skipped: ScanSkippedLine[] = [];
  const pagesRead = new Set<number>();
  const seenDays = new Map<string, string>();

  for (const value of raw.entries) {
    const line = readLine(value);
    if (!line) {
      return fail('INVALID_SCAN_RESULT', 'De uitlezing leverde geen bruikbaar resultaat op. Er zijn geen voorstellen gemaakt.');
    }
    const where = line.locationText || `pagina ${line.pageNumber}`;
    const skip = (reason: string) => skipped.push({ pageNumber: line.pageNumber, text: `${line.employeeText} · ${where}`, reason });

    if (line.uncertain.has('date')) {
      skip('De uitlezing wist niet zeker om welke datum het gaat. Beoordeel deze regel zelf in de bron.');
      continue;
    }
    if (line.pageNumber < 1 || (context.pageCount !== null && line.pageNumber > context.pageCount)) {
      skip('Deze pagina bestaat niet in de aangeleverde bron.');
      continue;
    }
    const match = matchHoursMember(line.employeeText, context.members);
    if (!match) {
      skipped.push({ pageNumber: line.pageNumber, text: line.employeeText,
        reason: 'Deze naam past bij niemand of bij meerdere medewerkers van deze week.' });
      continue;
    }
    const day = context.days.find(item => item.memberId === match.member.id && item.workDate === line.workDate);
    if (!day) {
      skip('Deze datum is geen werkdag van deze medewerker in deze week.');
      continue;
    }
    const earlier = seenDays.get(day.id);
    if (earlier) {
      return fail('DUPLICATE_SCAN_DAY', `Deze bron beschrijft dezelfde werkdag van ${match.member.name} tweemaal `
        + `(${earlier} en ${where}). Kies zelf welke regel klopt en leg die als voorstel vast.`);
    }
    seenDays.set(day.id, where);

    const uncertain = new Set<string>(
      [...line.uncertain].filter(field => (SCAN_UNCERTAIN_FIELDS as readonly string[]).includes(field)));
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
    if (start && end && minutes > 0 && !breakReading?.unreadable) {
      const crossesMidnight = clockMinutes(end) <= clockMinutes(start);
      if (crossesMidnight) {
        // Reading an earlier end as the next day is the likely meaning and never
        // a silent one: it changes the length of the day, so it is marked.
        uncertain.add('shift');
        notices.push({ code: 'SCAN_SHIFT_CROSSES_MIDNIGHT',
          message: 'De eindtijd ligt vóór de begintijd; de dienst is gelezen als doorlopend naar de volgende dag.' });
      }
      if (breakReading?.windows) {
        source.shifts = [{
          start, end, endDayOffset: crossesMidnight ? 1 : 0,
          breaks: breakReading.windows.map(window => ({ ...window, startDayOffset: 0, endDayOffset: 0 })),
        }];
      } else {
        if (!breakReading) source.shifts = [{ start, end, endDayOffset: crossesMidnight ? 1 : 0, breaks: [] }];
        // A bare break duration cannot be stored, but it still decides whether
        // the written total is consistent with the written times.
        const gross = clockMinutes(end) + (crossesMidnight ? 1440 : 0) - clockMinutes(start);
        const net = gross - (breakReading?.durationMinutes ?? 0);
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
    for (const issue of sourceControlIssues(minutes, sourceInput)) {
      notices.push(issue);
      if (issue.code === 'TOTAL_MISMATCH') uncertain.add('total');
    }

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
