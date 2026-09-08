import { checkMinutesTotal, parseHoursToMinutes, type HoursIssue } from '../../supabase/functions/_shared/hours-calculation';
import { hoursSourceInputSchema, type HoursSourceInput } from '@/components/hours-workflow/hours-day-source';

/** A decoded cell exactly as the spreadsheet stored it; formulas are never run. */
export type WorkbookCell = string | number | boolean | Date | null;
export interface WorkbookSheet { name: string; rows: WorkbookCell[][] }

export interface WorkbookWeekMember { id: string; name: string }
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
}

export type WorkbookReading =
  | { ok: false; issues: HoursIssue[] }
  | {
      ok: true; candidates: WorkbookCandidate[]; skipped: WorkbookSkippedRow[];
      rowTotals: WorkbookRowTotal[]; sheetsRead: string[];
    };

const fail = (code: string, message: string): WorkbookReading => ({ ok: false, issues: [{ code, message }] });

const cellText = (value: WorkbookCell): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
};

const normalizeName = (value: string): string =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

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
  'note', 'notes', 'project', 'kostenplaats', 'afdeling', 'functie', 'week', 'weeknummer',
  'nr', 'nummer', 'id', 'personeelsnummer', 'akkoord', 'paraaf', 'handtekening'];

const headerMatches = (value: string, options: string[]): boolean =>
  options.includes(normalizeName(value));

/** Only unambiguous notations; a date that is not a day of this week is never guessed at. */
function parseWorkDate(value: WorkbookCell): string | null {
  // A cell formatted as a time comes back as a Date on the spreadsheet's own
  // epoch. Reading that as a work date makes a list worksheet look like a grid.
  if (value instanceof Date) return value.getUTCFullYear() < 1901 ? null : value.toISOString().slice(0, 10);
  const text = cellText(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dutch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text);
  if (dutch) return `${dutch[3]}-${dutch[2].padStart(2, '0')}-${dutch[1].padStart(2, '0')}`;
  return null;
}

interface MemberMatch { member: WorkbookWeekMember; uncertain: boolean }

/**
 * An exactly written name is certain. A weaker but unique match — a surname, or
 * an initial with a surname — is recorded as a match the reader is unsure about,
 * so a named internal user has to confirm it before it can be applied. Anything
 * that fits nobody or several people is not a match at all.
 */
function matchMember(text: string, members: WorkbookWeekMember[]): MemberMatch | null {
  const wanted = normalizeName(text);
  if (!wanted) return null;
  const exact = members.filter(member => normalizeName(member.name) === wanted
    || normalizeName(member.name).split(' ').reverse().join(' ') === wanted);
  if (exact.length === 1) return { member: exact[0], uncertain: false };
  if (exact.length > 1) return null;
  const parts = wanted.split(' ').filter(Boolean);
  const weak = members.filter(member => {
    const own = normalizeName(member.name).split(' ').filter(Boolean);
    if (!own.length) return false;
    const surname = own[own.length - 1];
    return parts.includes(surname);
  });
  return weak.length === 1 ? { member: weak[0], uncertain: true } : null;
}

interface LongHeader {
  kind: 'long'; row: number; name: number; date: number; total: number;
  /** Every remaining titled column is a delivered source code, kept literally. */
  categories: { column: number; sourceCode: string }[];
}

function detectLongHeader(rows: WorkbookCell[][]): LongHeader | null {
  for (const [index, row] of rows.entries()) {
    const name = row.findIndex(cell => headerMatches(cellText(cell), NAME_HEADERS));
    const date = row.findIndex(cell => headerMatches(cellText(cell), DATE_HEADERS));
    const total = row.findIndex(cell => headerMatches(cellText(cell), TOTAL_HEADERS));
    if (name < 0 || date < 0 || total < 0) continue;
    const categories = row.flatMap((cell, column) => {
      const sourceCode = cellText(cell);
      if (!sourceCode || column === name || column === date || column === total) return [];
      if (headerMatches(sourceCode, [...NAME_HEADERS, ...DATE_HEADERS, ...TOTAL_HEADERS, ...IGNORED_HEADERS])) return [];
      // A remaining column only carries a delivered code when every value under
      // it really is a duration. A remarks or reference column is left alone
      // rather than turned into hours or into a reason to drop the whole row.
      const values = rows.slice(index + 1).map(data => (data ?? [])[column]);
      const readable = values.every(value => {
        const duration = readDuration(value);
        return duration === null || 'minutes' in duration;
      });
      return readable ? [{ column, sourceCode: sourceCode.slice(0, 200) }] : [];
    });
    return { kind: 'long', row: index, name, date, total, categories };
  }
  return null;
}

const ZERO_WITHOUT_REASON: HoursIssue = {
  code: 'ZERO_WITHOUT_REASON',
  message: 'Nul uren zonder reden. Leg de reden zelf als voorstel vast.',
};

/** Durations are read exactly: decimal comma, decimal point and H:MM, never rounded. */
function readDuration(value: WorkbookCell, maxMinutes = 1440): { minutes: number } | { reason: string } | { issue: HoursIssue } | null {
  if (value === null || value === undefined || cellText(value) === '') return null;
  if (value instanceof Date) {
    // Excel stores a typed "8:30" as a time on its own epoch; a real work date never lands there.
    if (value.getUTCFullYear() >= 1901) {
      return { issue: { code: 'INVALID_HOURS', message: 'Deze cel bevat een datum in plaats van een duur.' } };
    }
    const minutes = value.getUTCHours() * 60 + value.getUTCMinutes();
    return minutes === 0 ? { issue: ZERO_WITHOUT_REASON } : { minutes };
  }
  const text = cellText(value);
  const parsed = parseHoursToMinutes(typeof value === 'number' ? String(value) : text.replace(/\s*uur$/i, ''), { maxMinutes });
  if (parsed.ok === false) {
    // Only text can be a literal reason for no hours. A number that will not
    // parse — negative, out of range, sub-minute — is a problem, not a reason.
    if (typeof value === 'number' || /^[-+]?\d/.test(text)) return { issue: parsed.issues[0] };
    return { reason: text.slice(0, 500) };
  }
  return parsed.value === 0 ? { issue: ZERO_WITHOUT_REASON } : { minutes: parsed.value };
}

/**
 * The delivered breakdown, read as written. A code the sheet used stays that
 * code; nothing is mapped to an internal category here.
 */
function readCategories(header: LongHeader, row: WorkbookCell[]): { sourceInput: HoursSourceInput | null } | { issue: HoursIssue } {
  const categories: { sourceCode: string; minutes: number }[] = [];
  for (const category of header.categories) {
    const value = readDuration(row[category.column]);
    if (value === null) continue;
    if ('issue' in value) {
      return { issue: { code: value.issue.code, message: `Kolom ${category.sourceCode}: ${value.issue.message}` } };
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
function detectWideHeader(rows: WorkbookCell[][]): WideHeader | null {
  for (const [index, row] of rows.entries()) {
    const days = row.flatMap((cell, column) => {
      const workDate = parseWorkDate(cell);
      return workDate ? [{ column, workDate }] : [];
    });
    if (days.length < 2) continue;
    const first = days[0].column;
    const name = row.findIndex((cell, column) => column < first && headerMatches(cellText(cell), NAME_HEADERS));
    const total = row.findIndex((cell, column) => column > first && headerMatches(cellText(cell), TOTAL_HEADERS));
    return { row: index, name: name < 0 ? 0 : name, days, total: total < 0 ? null : total };
  }
  return null;
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
    for (const day of header.days) {
      const dayId = dayOf.get(`${match.member.id}|${day.workDate}`);
      const where = { ...place, text: `${nameText} · ${day.workDate}` };
      if (!dayId) {
        if (cellText(row[day.column])) {
          skipped.push({ ...where, reason: `${day.workDate} is geen werkdag van deze medewerker in deze week.` });
        }
        continue;
      }
      const duration = readDuration(row[day.column]);
      if (duration === null) continue;
      if ('issue' in duration) { skipped.push({ ...where, reason: duration.issue.message }); continue; }
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
    if (header.total === null) continue;
    // A week total legitimately exceeds a day, so it is read against the week bound.
    const delivered = readDuration(row[header.total], 10080);
    if (delivered === null) continue;
    if (!('minutes' in delivered)) {
      skipped.push({ ...place, text: `${nameText} · totaal`, reason: 'Het aangeleverde weektotaal is niet als duur te lezen; het is niet vergeleken.' });
      continue;
    }
    if (delivered.minutes !== readMinutes) {
      rowTotals.push({
        sheet: sheet.name, row: rowNumber, employeeName: match.member.name,
        deliveredMinutes: delivered.minutes, readMinutes,
      });
    }
  }
}

/** A delivered total is a control figure, never the truth about the parts. */
function controlNotices(minutes: number, sourceInput: HoursSourceInput | null): HoursIssue[] {
  if (!sourceInput?.categories?.length) return [];
  const total = checkMinutesTotal(sourceInput.categories.map(category => category.minutes), minutes);
  return total.ok === false ? total.issues : [];
}

export function readHoursWorkbook(sheets: WorkbookSheet[], context: WorkbookContext): WorkbookReading {
  if (!sheets.length) return fail('EMPTY_WORKBOOK', 'Dit bestand bevat geen werkbladen.');
  const candidates: WorkbookCandidate[] = [];
  const skipped: WorkbookSkippedRow[] = [];
  const rowTotals: WorkbookRowTotal[] = [];
  const sheetsRead: string[] = [];
  const dayOf = new Map(context.days.map(day => [`${day.memberId}|${day.workDate}`, day.id]));

  for (const [sheetIndex, sheet] of sheets.entries()) {
    const wide = detectWideHeader(sheet.rows);
    if (wide) {
      sheetsRead.push(sheet.name);
      readWideSheet(sheet, sheetIndex, wide, context, dayOf, candidates, skipped, rowTotals);
      continue;
    }
    const header = detectLongHeader(sheet.rows);
    if (!header) continue;
    sheetsRead.push(sheet.name);
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
      const breakdown = readCategories(header, row);
      if ('issue' in breakdown) { skipped.push({ ...place, reason: breakdown.issue.message }); continue; }
      candidates.push({
        dayId, memberId: match.member.id, employeeName: match.member.name, workDate,
        minutes, noHoursReason: 'reason' in duration ? duration.reason : null,
        sourceInput: breakdown.sourceInput,
        pageNumber: sheetIndex + 1, pageLabel: `blad ${sheet.name} · rij ${rowNumber}`,
        sheetName: sheet.name, row: rowNumber,
        assignmentUncertain: match.uncertain, employeeText: nameText,
        notices: controlNotices(minutes, breakdown.sourceInput),
      });
    }
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
  return { ok: true, candidates, skipped, rowTotals, sheetsRead };
}
