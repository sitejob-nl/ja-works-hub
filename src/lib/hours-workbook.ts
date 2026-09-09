import { parseHoursToMinutes, type HoursIssue } from '../../supabase/functions/_shared/hours-calculation';
import {
  hoursSourceInputSchema, sourceControlIssues, type HoursSourceInput,
} from '@/components/hours-workflow/hours-day-source';
import {
  matchHoursMember, normalizeHoursName, type HoursMemberMatch, type HoursWeekMember,
} from '../../supabase/functions/_shared/hours-member-match';

/** A decoded cell exactly as the spreadsheet stored it; formulas are never run. */
export type WorkbookCell = string | number | boolean | Date | null;
export interface WorkbookSheet { name: string; rows: WorkbookCell[][] }

export type WorkbookWeekMember = HoursWeekMember;
export interface WorkbookWeekDay { id: string; memberId: string; workDate: string }
export interface WorkbookContext { members: WorkbookWeekMember[]; days: WorkbookWeekDay[] }

/**
 * One reviewable proposal candidate. It carries exactly what the sheet said and
 * where it said it; it is not an hour until an internal user saves it as a
 * proposal and then applies that proposal.
 */
export interface WorkbookCandidate {
  dayId: string; memberId: string; employeeName: string; workDate: string;
  minutes: number; noHoursReason: string | null;
  /** The delivered breakdown, kept exactly as the sheet wrote it. */
  sourceInput: HoursSourceInput | null;
  pageNumber: number; pageLabel: string;
  /** Where this came from, for a message that can name the row. */
  sheetName: string; row: number;
  assignmentUncertain: boolean;
  /** What the sheet literally said about this employee. */
  employeeText: string;
  notices: HoursIssue[];
}

/**
 * How many proposals one handling may record. The server enforces the same
 * bound; the screen checks it first so a large reading is narrowed down rather
 * than refused as a whole after the fact.
 */
export const HOURS_READING_MAX_ENTRIES = 500;

/** A row the reader deliberately left alone, named so nothing disappears silently. */
export interface WorkbookSkippedRow { sheet: string; row: number; text: string; reason: string }

/** A delivered row total that does not match the days read from that same row. */
export interface WorkbookRowTotal {
  sheet: string; row: number; employeeName: string;
  deliveredMinutes: number; readMinutes: number;
  /** Days of this week the row left empty; they explain part of a difference. */
  unreadDays: string[];
}

export type WorkbookReading =
  | { ok: false; issues: HoursIssue[] }
  | {
      ok: true; candidates: WorkbookCandidate[]; skipped: WorkbookSkippedRow[];
      rowTotals: WorkbookRowTotal[]; sheetsRead: string[];
      /** Worksheets whose layout was not recognised; named so none disappears silently. */
      sheetsIgnored: string[];
    };

const fail = (code: string, message: string): WorkbookReading => ({ ok: false, issues: [{ code, message }] });

const cellText = (value: WorkbookCell): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
};

const normalizeName = normalizeHoursName;

/**
 * Column titles are matched exactly. A prefix rule looks helpful until a column
 * called "Aantal dagen" wins the race for the hours total and a 1 becomes an
 * hour. An unrecognised title simply does not make this a list worksheet, which
 * ends in an honest blockade rather than in wrong hours.
 */
const NAME_HEADERS = ['naam', 'medewerker', 'werknemer', 'naam medewerker', 'medewerkernaam',
  'employee', 'name', 'nazwisko'];
const DATE_HEADERS = ['datum', 'date', 'dag', 'day', 'werkdag', 'data'];
const TOTAL_HEADERS = ['uren', 'aantal uren', 'totaal uren', 'uren totaal', 'gewerkte uren',
  'totaal', 'total', 'hours', 'godziny'];
/** Titles that are certainly not a delivered duration; they are left alone. */
const IGNORED_HEADERS = ['opmerking', 'opmerkingen', 'notitie', 'toelichting', 'remark', 'remarks',
  'note', 'notes', 'project', 'kostenplaats', 'afdeling', 'functie', 'ploeg', 'week', 'weeknummer',
  'nr', 'nummer', 'id', 'personeelsnummer', 'akkoord', 'paraaf', 'handtekening',
  'aantal', 'aantal dagen', 'dagen', 'stuks', 'ritten',
  // Money is never a piece of the working day, however neatly it fits under the total.
  'uurloon', 'uurtarief', 'tarief', 'loon', 'bedrag', 'totaalbedrag', 'prijs', 'rate',
  'km', 'kilometers', 'reiskosten', 'vergoeding',
  // Shift times are not a breakdown of the day. This module has its own shape
  // for those (shifts with confirmed breaks) and this reader does not fill it.
  'begin', 'begintijd', 'start', 'starttijd', 'aanvang', 'eind', 'einde', 'eindtijd',
  'van', 'tot', 'pauze', 'pauzes', 'pauzetijd', 'break', 'lunch'];

const headerMatches = (value: string, options: string[]): boolean =>
  options.includes(normalizeName(value));

/** Only unambiguous notations; a date that is not a day of this week is never guessed at. */
function parseWorkDate(value: WorkbookCell): string | null {
  // A cell formatted as a time comes back as a Date on the spreadsheet's own
  // epoch. Reading that as a work date makes a list worksheet look like a grid.
  if (value instanceof Date) return isStoredDuration(value) ? null : value.toISOString().slice(0, 10);
  const text = cellText(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dutch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text);
  if (dutch) return `${dutch[3]}-${dutch[2].padStart(2, '0')}-${dutch[1].padStart(2, '0')}`;
  return null;
}

type MemberMatch = HoursMemberMatch;
const matchMember = matchHoursMember;

interface LongHeader {
  kind: 'long'; row: number; name: number; date: number; total: number;
  /** Every remaining titled column is a delivered source code, kept literally. */
  categories: { column: number; sourceCode: string }[];
  /** Titled columns that turned out not to hold durations, named to the reviewer. */
  setAside: string[];
}

function detectLongHeader(rows: WorkbookCell[][], members: WorkbookWeekMember[] = []): LongHeader | null {
  for (const [index, header] of rows.entries()) {
    const row = header ?? [];
    const columnsFor = (options: string[]) =>
      row.flatMap((cell, column) => headerMatches(cellText(cell), options) ? [column] : []);
    const [names, dates, totals] = [NAME_HEADERS, DATE_HEADERS, TOTAL_HEADERS].map(columnsFor);
    // Two columns claiming the same role make the worksheet ambiguous. Picking
    // the leftmost could propose a running week total as one day's hours, so
    // this ends in the same honest blockade as an unknown title.
    if (names.length !== 1 || dates.length !== 1 || totals.length !== 1) continue;
    const [name, date, total] = [names[0], dates[0], totals[0]];
    // Judged on the rows this reader will actually read. A trailing summary row
    // belongs to nobody, so it may not disqualify a delivered code.
    const dataRows = rows.slice(index + 1)
      .filter(data => !members.length || matchMember(cellText((data ?? [])[name]), members) !== null);
    const categories: { column: number; sourceCode: string }[] = [];
    const setAside: string[] = [];
    for (const [column, cell] of row.entries()) {
      const sourceCode = cellText(cell);
      if (!sourceCode || column === name || column === date || column === total) continue;
      if (headerMatches(sourceCode, [...NAME_HEADERS, ...DATE_HEADERS, ...TOTAL_HEADERS, ...IGNORED_HEADERS])) continue;
      // A remaining column only carries a delivered code when the values under
      // it are durations that could be part of that row's own total. A missing
      // or unreadable value proves nothing either way; a remarks column, an
      // hourly rate or an amount does, and is set aside by name.
      const readable = dataRows.every(data => {
        const part = readDuration((data ?? [])[column], 1440, true);
        if (part === null || 'issue' in part) return true;
        if (!('minutes' in part)) return false;
        const whole = readDuration((data ?? [])[total]);
        return whole === null || !('minutes' in whole) || part.minutes <= whole.minutes;
      });
      if (readable) categories.push({ column, sourceCode: sourceCode.slice(0, 200) });
      else setAside.push(sourceCode);
    }
    return { kind: 'long', row: index, name, date, total, categories, setAside };
  }
  return null;
}

/**
 * A spreadsheet stores a duration as a fraction of a day counted from
 * 1899-12-30. Reading only the clock part of that date would silently turn a
 * week total of 40:00 into 16:00.
 */
const SPREADSHEET_EPOCH = Date.UTC(1899, 11, 30);
const isStoredDuration = (value: Date): boolean => value.getUTCFullYear() < 1901;
const storedDurationMinutes = (value: Date): number =>
  Math.round((value.getTime() - SPREADSHEET_EPOCH) / 60_000);

const ZERO_WITHOUT_REASON: HoursIssue = {
  code: 'ZERO_WITHOUT_REASON',
  message: 'Nul uren zonder reden. Leg de reden zelf als voorstel vast.',
};

/** Marks that a cell is empty in intent: a dash, a cross, a "not applicable". */
const PLACEHOLDERS = ['-', '\u2013', '\u2014', 'x', '.', '/', '\\', 'nvt', 'n.v.t.', 'geen'];
const isPlaceholder = (text: string): boolean => PLACEHOLDERS.includes(text.trim().toLowerCase());
/**
 * A cell a spreadsheet filled with its own failure says nothing about the work.
 * The shapes vary — `#N/A`, `#DIV/0!`, and read-excel-file's own `#ERROR_…` —
 * so the leading hash is the signal; no delivered reason ever starts with one.
 */
const isErrorValue = (text: string): boolean => text.trim().startsWith('#');

const asDuration = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * Durations are read exactly: decimal comma, decimal point and H:MM, never
 * rounded. `allowZero` is for a breakdown column, where nought overtime on a
 * Tuesday is a delivered fact rather than a day without hours.
 */
function readDuration(value: WorkbookCell, maxMinutes = 1440, allowZero = false):
  { minutes: number } | { reason: string } | { issue: HoursIssue } | null {
  if (value === null || value === undefined || cellText(value) === '') return null;
  if (typeof value !== 'number' && isPlaceholder(cellText(value))) {
    return { issue: { code: 'PLACEHOLDER', message: 'Deze cel bevat geen waarde, alleen een streepje of kruisje.' } };
  }
  if (typeof value !== 'number' && isErrorValue(cellText(value))) {
    return { issue: { code: 'SPREADSHEET_ERROR',
      message: `Deze cel bevat een foutwaarde van het rekenblad (${cellText(value)}) en zegt niets over de gewerkte tijd.` } };
  }
  if (value instanceof Date) {
    // Excel stores a typed "8:30" as a time on its own epoch; a real work date never lands there.
    if (!isStoredDuration(value)) {
      return { issue: { code: 'INVALID_HOURS', message: 'Deze cel bevat een datum in plaats van een duur.' } };
    }
    const minutes = storedDurationMinutes(value);
    if (minutes === 0) return allowZero ? { minutes } : { issue: ZERO_WITHOUT_REASON };
    if (minutes < 0 || minutes > maxMinutes) {
      return { issue: { code: 'HOURS_OUT_OF_RANGE', message: `De duur mag niet meer dan ${maxMinutes} minuten zijn.` } };
    }
    return { minutes };
  }
  // A spreadsheet stores an elapsed-time cell ([h]:mm) as a fraction of a day,
  // and read-excel-file hands that over as a plain number. A bare 0,5 is then
  // either half an hour written as a decimal or twelve hours written as a time,
  // and nothing in the file says which. Where both readings fit, the reader
  // refuses to choose rather than quietly dividing a day by twenty-four.
  if (typeof value === 'number' && value > 0 && value < 1) {
    return { issue: { code: 'AMBIGUOUS_DURATION',
      message: `Deze cel kan zowel ${asDuration(Math.round(value * 60))} als `
        + `${asDuration(Math.round(value * 1440))} betekenen. Leg de duur zelf als voorstel vast.` } };
  }
  const text = cellText(value);
  const parsed = parseHoursToMinutes(typeof value === 'number' ? String(value) : text.replace(/\s*uur$/i, ''), { maxMinutes });
  if (parsed.ok === false) {
    // Only text can be a literal reason for no hours. A number that will not
    // parse — negative, out of range, sub-minute — is a problem, not a reason.
    if (typeof value === 'number' || /^[-+]?\d/.test(text)) return { issue: parsed.issues[0] };
    return { reason: text.slice(0, 500) };
  }
  if (parsed.value === 0 && !allowZero) return { issue: ZERO_WITHOUT_REASON };
  return { minutes: parsed.value };
}

/**
 * The delivered breakdown, read as written. A code the sheet used stays that
 * code; nothing is mapped to an internal category here.
 */
function readCategories(header: LongHeader, row: WorkbookCell[], notices: HoursIssue[]):
  { sourceInput: HoursSourceInput | null } | { issue: HoursIssue } {
  const categories: { sourceCode: string; minutes: number }[] = [];
  for (const category of header.categories) {
    const value = readDuration(row[category.column], 1440, true);
    if (value === null) continue;
    if ('issue' in value) {
      // The column as a whole does carry durations, so one unreadable cell means
      // "nothing delivered here" and is reported next to the proposal.
      notices.push({ code: value.issue.code, message: `Kolom ${category.sourceCode}: ${value.issue.message}` });
      continue;
    }
    if ('reason' in value) {
      return { issue: { code: 'INVALID_CATEGORY', message: `Kolom ${category.sourceCode} bevat geen duur maar tekst.` } };
    }
    categories.push({ sourceCode: category.sourceCode, minutes: value.minutes });
  }
  if (!categories.length) return { sourceInput: null };
  const sourceInput: HoursSourceInput = { schemaVersion: 1, categories };
  if (!hoursSourceInputSchema.safeParse(sourceInput).success) {
    return { issue: { code: 'INVALID_SOURCE_INPUT', message: 'De aangeleverde broncodes passen niet in één dag.' } };
  }
  return { sourceInput };
}

interface WideHeader { row: number; name: number; days: { column: number; workDate: string }[]; total: number | null }

/**
 * The most common delivered shape: the employees underneath each other and the
 * days across the top. Two or more date columns tell it apart from a list
 * worksheet, which carries exactly one date column.
 */
function detectWideHeader(rows: WorkbookCell[][], members: WorkbookWeekMember[]): WideHeader | null {
  for (const [index, row] of rows.entries()) {
    const days = (row ?? []).flatMap((cell, column) => {
      const workDate = parseWorkDate(cell);
      return workDate ? [{ column, workDate }] : [];
    });
    // The days of a grid stand next to each other. A banner such as
    // "Periode: 07-09-2026 t/m 13-09-2026" also holds two dates, but with
    // something else between them, and reading it as the header would book
    // every column onto the wrong day.
    if (days.length < 2 || days.some((day, position) =>
      position > 0 && day.column !== days[position - 1].column + 1)) continue;
    const first = days[0].column;
    const name = row.findIndex((cell, column) => column < first && headerMatches(cellText(cell), NAME_HEADERS));
    // Without a titled name column the leftmost one has to serve, and there has
    // to be one to the left of the days at all. A grid that starts with a date
    // has nowhere to put the names, so it is not a grid this reader understands.
    if (name < 0 && first === 0) continue;
    const nameColumn = name < 0 ? 0 : name;
    // The row of days stands directly above the employees. A banner higher up
    // may carry two adjacent dates too — "Periode 08-09-2026 09-09-2026" — and
    // reading that as the header would book every column one day across.
    const next = rows.slice(index + 1).find(data => (data ?? []).some(cell => cellText(cell)));
    if (!next || matchMember(cellText(next[nameColumn]), members) === null) continue;
    // A delivered week total may stand on either side of the days.
    const dayColumns = new Set(days.map(day => day.column));
    const total = row.findIndex((cell, column) =>
      column !== nameColumn && !dayColumns.has(column) && headerMatches(cellText(cell), TOTAL_HEADERS));
    return { row: index, name: nameColumn, days, total: total < 0 ? null : total };
  }
  return null;
}

/**
 * A bare number in a week total is the same riddle as anywhere else — 1,75 is
 * either 1:45 written as a decimal or 42:00 written as [h]:mm — except that the
 * days of that very row can settle it. Where exactly one reading matches what
 * was read, that is the delivered total; otherwise it falls back to the plain
 * decimal reading and the difference is shown.
 */
function readWeekTotal(value: WorkbookCell, readMinutes: number):
  { minutes: number } | { reason: string } | { issue: HoursIssue } | null {
  if (typeof value === 'number' && value > 0) {
    const readings = [Math.round(value * 60), Math.round(value * 1440)]
      .filter(minutes => minutes > 0 && minutes <= 10080);
    const matching = readings.filter(minutes => minutes === readMinutes);
    if (matching.length === 1) return { minutes: matching[0] };
  }
  return readDuration(value, 10080);
}

function readWideSheet(
  sheet: WorkbookSheet, sheetIndex: number, header: WideHeader, context: WorkbookContext,
  dayOf: Map<string, string>, candidates: WorkbookCandidate[], skipped: WorkbookSkippedRow[],
  rowTotals: WorkbookRowTotal[],
): void {
  for (let index = header.row + 1; index < sheet.rows.length; index += 1) {
    const row = sheet.rows[index] ?? [];
    const nameText = cellText(row[header.name]);
    if (!nameText && !row.some(cell => cellText(cell))) continue;
    const rowNumber = index + 1;
    const place = { sheet: sheet.name, row: rowNumber, text: nameText };
    const match = matchMember(nameText, context.members);
    if (!match) {
      skipped.push({ ...place, reason: 'Deze naam hoort bij geen enkele medewerker van deze week, of bij meer dan één.' });
      continue;
    }
    let readMinutes = 0;
    // A delivered total covers the whole row. Once part of that row falls
    // outside this week, comparing it would report a difference the file does
    // not actually have.
    let wholeRowRead = true;
    const unreadDays: string[] = [];
    for (const day of header.days) {
      const dayId = dayOf.get(`${match.member.id}|${day.workDate}`);
      const where = { ...place, text: `${nameText} · ${day.workDate}` };
      if (!dayId) {
        if (cellText(row[day.column])) {
          wholeRowRead = false;
          skipped.push({ ...where, reason: `${day.workDate} is geen werkdag van deze medewerker in deze week.` });
        }
        continue;
      }
      const duration = readDuration(row[day.column]);
      if (duration === null) { unreadDays.push(day.workDate); continue; }
      if ('issue' in duration) {
        // A dash or a bare nought says "nothing was delivered for this day", so
        // the row total can still be compared against what was. A value the
        // reader cannot read at all makes any comparison meaningless.
        if (duration.issue.code === 'PLACEHOLDER' || duration.issue.code === 'ZERO_WITHOUT_REASON') {
          unreadDays.push(day.workDate);
          skipped.push({ ...where, reason: duration.issue.message });
        } else {
          wholeRowRead = false;
          skipped.push({ ...where, reason: duration.issue.message });
        }
        continue;
      }
      const minutes = 'minutes' in duration ? duration.minutes : 0;
      readMinutes += minutes;
      candidates.push({
        dayId, memberId: match.member.id, employeeName: match.member.name, workDate: day.workDate,
        minutes, noHoursReason: 'reason' in duration ? duration.reason : null, sourceInput: null,
        pageNumber: sheetIndex + 1, pageLabel: `blad ${sheet.name} · rij ${rowNumber}`,
        sheetName: sheet.name, row: rowNumber,
        assignmentUncertain: match.uncertain, employeeText: nameText, notices: [],
      });
    }
    if (header.total === null || !wholeRowRead) continue;
    // A week total legitimately exceeds a day, so it is read against the week bound.
    const delivered = readWeekTotal(row[header.total], readMinutes);
    if (delivered === null) continue;
    if (!('minutes' in delivered)) {
      skipped.push({ ...place, text: `${nameText} · totaal`, reason: 'Het aangeleverde weektotaal is niet als duur te lezen; het is niet vergeleken.' });
      continue;
    }
    if (delivered.minutes !== readMinutes) {
      rowTotals.push({
        sheet: sheet.name, row: rowNumber, employeeName: match.member.name,
        deliveredMinutes: delivered.minutes, readMinutes, unreadDays,
      });
    }
  }
}

/**
 * A delivered total is a control figure, never the truth about the parts. This
 * is the same check manual entry runs, so a reader and a person see the same
 * warnings about the same delivery — including a source code delivered twice.
 */
function controlNotices(minutes: number, sourceInput: HoursSourceInput | null): HoursIssue[] {
  return sourceControlIssues(minutes, sourceInput);
}

/** One list worksheet: a heading of name, date and hours, one row per workday. */
function readLongSheet(
  sheet: WorkbookSheet, sheetIndex: number, header: LongHeader, context: WorkbookContext,
  dayOf: Map<string, string>, candidates: WorkbookCandidate[], skipped: WorkbookSkippedRow[],
): void {
  for (const column of header.setAside) {
    skipped.push({
      sheet: sheet.name, row: header.row + 1, text: column,
      reason: 'Deze kolom bevat geen aangeleverde uren en is niet als broncode overgenomen.',
    });
  }
  for (let index = header.row + 1; index < sheet.rows.length; index += 1) {
    const row = sheet.rows[index] ?? [];
    const nameText = cellText(row[header.name]);
    if (!nameText && !row.some(cell => cellText(cell))) continue;
    const rowNumber = index + 1;
    const place = { sheet: sheet.name, row: rowNumber, text: nameText };
    const match = matchMember(nameText, context.members);
    if (!match) {
      skipped.push({ ...place, reason: 'Deze naam hoort bij geen enkele medewerker van deze week, of bij meer dan één.' });
      continue;
    }
    const workDate = parseWorkDate(row[header.date]);
    if (!workDate) {
      skipped.push({ ...place, reason: 'De datum in deze regel is niet eenduidig te lezen.' });
      continue;
    }
    const dayId = dayOf.get(`${match.member.id}|${workDate}`);
    if (!dayId) {
      skipped.push({ ...place, reason: `${workDate} is geen werkdag van deze medewerker in deze week.` });
      continue;
    }
    const duration = readDuration(row[header.total]);
    if (duration === null) {
      skipped.push({ ...place, reason: 'Er staan geen uren in deze regel; er wordt niets ingevuld wat er niet staat.' });
      continue;
    }
    if ('issue' in duration) {
      skipped.push({ ...place, reason: duration.issue.message });
      continue;
    }
    const minutes = 'minutes' in duration ? duration.minutes : 0;
    // No hours means no breakdown: the two together are a combination the
    // server refuses to classify, so a reader must never propose it.
    const notices: HoursIssue[] = [];
    const breakdown = minutes === 0 ? { sourceInput: null } : readCategories(header, row, notices);
    if ('issue' in breakdown) { skipped.push({ ...place, reason: breakdown.issue.message }); continue; }
    candidates.push({
      dayId, memberId: match.member.id, employeeName: match.member.name, workDate,
      minutes, noHoursReason: 'reason' in duration ? duration.reason : null,
      sourceInput: breakdown.sourceInput,
      pageNumber: sheetIndex + 1, pageLabel: `blad ${sheet.name} · rij ${rowNumber}`,
      sheetName: sheet.name, row: rowNumber,
      assignmentUncertain: match.uncertain, employeeText: nameText,
      notices: [...notices, ...controlNotices(minutes, breakdown.sourceInput)],
    });
  }
}

export function readHoursWorkbook(sheets: WorkbookSheet[], context: WorkbookContext): WorkbookReading {
  if (!sheets.length) return fail('EMPTY_WORKBOOK', 'Dit bestand bevat geen werkbladen.');
  const candidates: WorkbookCandidate[] = [];
  const skipped: WorkbookSkippedRow[] = [];
  const rowTotals: WorkbookRowTotal[] = [];
  const sheetsRead: string[] = [];
  const sheetsIgnored: string[] = [];
  const dayOf = new Map(context.days.map(day => [`${day.memberId}|${day.workDate}`, day.id]));

  for (const [sheetIndex, sheet] of sheets.entries()) {
    // A worksheet that titles a name, a date and an hours column is a list. Its
    // rows may well carry a second date — a date of birth, a start date — and
    // that must not turn the sheet into a grid whose columns land on the wrong
    // days. A list heading with nothing under it is not this sheet's real shape
    // either, so a grid underneath still gets its turn.
    const longHeader = detectLongHeader(sheet.rows, context.members);
    const wideHeader = detectWideHeader(sheet.rows, context.members);
    if (longHeader) {
      const read: WorkbookCandidate[] = [];
      const left: WorkbookSkippedRow[] = [];
      readLongSheet(sheet, sheetIndex, longHeader, context, dayOf, read, left);
      if (read.length || !wideHeader) {
        sheetsRead.push(sheet.name);
        candidates.push(...read);
        skipped.push(...left);
        continue;
      }
    }
    if (wideHeader) {
      sheetsRead.push(sheet.name);
      readWideSheet(sheet, sheetIndex, wideHeader, context, dayOf, candidates, skipped, rowTotals);
      continue;
    }
    if (sheet.rows.some(row => (row ?? []).some(cell => cellText(cell)))) sheetsIgnored.push(sheet.name);
  }

  if (!sheetsRead.length) {
    return fail('NO_LAYOUT', 'Geen enkel werkblad heeft een herkenbare indeling met namen, dagen en uren. Er zijn geen voorstellen gemaakt.');
  }
  // One workday can carry only one proposal out of one delivery. A file that
  // says two different things about the same day is ambiguous about that day,
  // and picking one of the two would be exactly the guess this module avoids.
  const repeated = candidates.filter((candidate, index) =>
    candidates.findIndex(other => other.dayId === candidate.dayId) !== index);
  if (repeated.length) {
    const second = repeated[0];
    const first = candidates.find(candidate => candidate.dayId === second.dayId)!;
    const place = (candidate: WorkbookCandidate) => first.sheetName === second.sheetName
      ? `rij ${candidate.row}` : `blad ${candidate.sheetName}, rij ${candidate.row}`;
    const where = first.sheetName === second.sheetName
      ? `blad ${first.sheetName}, ${place(first)} en ${place(second)}`
      : `${place(first)} en ${place(second)}`;
    return fail('DUPLICATE_DAY',
      `${first.employeeName} staat meer dan één keer op ${first.workDate}: ${where}. `
      + 'Maak in het bestand duidelijk welke regel geldt; er zijn geen voorstellen gemaakt.');
  }
  return { ok: true, candidates, skipped, rowTotals, sheetsRead, sheetsIgnored };
}
