import { parseHoursToMinutes } from '../../supabase/functions/_shared/hours-calculation';
import {
  matchHoursMember, normalizeHoursName, prepareHoursMembers, type PreparedHoursMember,
} from '../../supabase/functions/_shared/hours-member-match';
import type {
  WorkbookCandidate, WorkbookContext, WorkbookReading, WorkbookSkippedRow,
} from '@/lib/hours-workbook';

/**
 * The hours somebody typed into an e-mail, read line by line.
 *
 * A message is not a table: there is no heading that says which column is what,
 * so every line has to carry its own proof. This reader therefore only accepts a
 * line it can read completely — one employee, one day, one duration — and names
 * every other line it looked at instead of filling in what it thinks was meant.
 * That is the same discipline the spreadsheet reader follows; a message simply
 * offers fewer certainties, so it refuses more often.
 *
 * Two things are specific to mail. Quoted history is cut away before this reader
 * ever sees it, so last week's Saturday cannot propose itself a second time. And
 * a message may correct itself in its own next sentence, which is why a second
 * statement about the same day is a correction where it says so, and an
 * ambiguity where it does not.
 */

export interface MailReadingContext extends WorkbookContext {
  /** Often the only place a message names the employee it is about. */
  subject?: string;
}

const fail = (code: string, message: string): WorkbookReading => ({ ok: false, issues: [{ code, message }] });

/** Lower case without accents, but with the punctuation a duration needs. */
const fold = (value: string): string =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const WEEKDAYS: Record<string, number> = {
  maandag: 1, ma: 1, dinsdag: 2, di: 2, woensdag: 3, wo: 3, donderdag: 4, do: 4,
  vrijdag: 5, vr: 5, zaterdag: 6, za: 6, zondag: 7, zo: 7,
};
const WEEKDAY_SOURCE = `\\b(${Object.keys(WEEKDAYS).join('|')})\\b`;
/** A fresh object per use: a shared /g regex remembers where it stopped. */
const weekdayPattern = (): RegExp => new RegExp(WEEKDAY_SOURCE, 'g');
const hasWeekday = (value: string): boolean => new RegExp(WEEKDAY_SOURCE).test(value);

/** ISO weekday (Monday is 1) of a date written as YYYY-MM-DD. */
function isoWeekday(workDate: string): number {
  const [year, month, day] = workDate.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

const DATE_PATTERN = /\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?\b/;

/**
 * A stated date, only in notations that mean one thing. A date that is not a day
 * of this week is reported rather than ignored: a message about another week is
 * something a reviewer has to see, not something to read past.
 */
function readDate(line: string, weekDates: string[]):
{ workDate: string | null; text: string } | null {
  const match = DATE_PATTERN.exec(line);
  if (!match) return null;
  if (match[1]) {
    const workDate = `${match[1]}-${match[2]}-${match[3]}`;
    return { workDate: weekDates.includes(workDate) ? workDate : null, text: match[0] };
  }
  const day = Number(match[4]);
  const month = Number(match[5]);
  // A year the message left out comes from the week itself; a message about one
  // week cannot mean a day in another one.
  const years = match[6]
    ? [Number(match[6].length === 2 ? `20${match[6]}` : match[6])]
    : Array.from(new Set(weekDates.map(date => Number(date.slice(0, 4)))));
  for (const year of years) {
    const workDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (weekDates.includes(workDate)) return { workDate, text: match[0] };
  }
  // A date this message wrote that is not a day of this week.
  return { workDate: null, text: match[0] };
}

interface DurationToken { text: string; index: number }

const NUMBER_PATTERN = /\d{1,3}(?::\d{2}|[.,]\d{1,2})?/g;

/**
 * Every number left on the line once the day and the week number have been taken
 * out. They all count, including a bare one: dropping the unqualified numbers
 * would let "maandag 8 en 9 uur" quietly become nine hours, which is precisely
 * the choice this reader must not make. One number is the duration; more than
 * one leaves the line to say which of them still stands.
 */
function durationTokens(line: string): DurationToken[] {
  return Array.from(line.matchAll(NUMBER_PATTERN), match => ({ text: match[0], index: match.index ?? 0 }));
}

const CORRECTION_WORDS = /\b(correctie|gecorrigeerd|gewijzigd|aangepast|moet|was|in plaats van)\b|->|→|=>/;

interface Connector { pattern: RegExp; take: 'after' | 'before' }

/**
 * How a message says it is taking something back. The order matters: "zaterdag
 * was geen 9,5 maar 4,75" carries both "was" and "geen … maar", and only the
 * second one says which of the two numbers still stands.
 */
const CONNECTORS: Connector[] = [
  { pattern: /\b(?:geen|niet)\b[^.;]*?\bmaar\b/, take: 'after' },
  { pattern: /\bmoet\b/, take: 'after' },
  { pattern: /\bin plaats van\b/, take: 'before' },
  { pattern: /->|→|=>/, take: 'after' },
  { pattern: /\b(?:gewijzigd|aangepast|gecorrigeerd)\b[^.;]*?\bnaar\b/, take: 'after' },
  { pattern: /\bwas\b/, take: 'before' },
];

/** Which of two stated durations still stands, or nothing when the line does not say. */
function correctedToken(line: string, tokens: DurationToken[]): DurationToken | null {
  for (const connector of CONNECTORS) {
    const match = connector.pattern.exec(line);
    if (!match) continue;
    const end = (match.index ?? 0) + match[0].length;
    const chosen = connector.take === 'after'
      ? tokens.find(token => token.index >= end)
      : [...tokens].reverse().find(token => token.index < (match.index ?? 0));
    if (chosen) return chosen;
  }
  return null;
}

const NO_HOURS_MARKERS =
  /\b(ziek|vrij|vrije dag|verlof|vakantie|afwezig|feestdag|snipperdag|niet gewerkt|geen uren)\b/;

/** The employees this line could be about, matched on the whole name only. */
function inlineMember(line: string, members: PreparedHoursMember[]): PreparedHoursMember[] {
  const normalized = ` ${normalizeHoursName(line)} `;
  return members.filter(member =>
    member.normalized && (normalized.includes(` ${member.normalized} `) || normalized.includes(` ${member.reversed} `)));
}

interface Statement {
  candidate: WorkbookCandidate;
  correction: boolean;
  /** What the line said besides the value that stands, for a correction message. */
  supersededText: string | null;
}

export function readHoursFromMailText(text: string, context: MailReadingContext): WorkbookReading {
  const lines = text.split(/\r?\n/);
  if (!lines.some(line => line.trim())) {
    return fail('EMPTY_MESSAGE',
      'Dit bericht bevat geen nieuwe tekst; er staat alleen geciteerde geschiedenis of een handtekening in. Er zijn geen voorstellen gemaakt.');
  }
  const members = prepareHoursMembers(context.members);
  const dayOf = new Map(context.days.map(day => [`${day.memberId}|${day.workDate}`, day.id]));
  const weekDates = [...new Set(context.days.map(day => day.workDate))];
  const daysByMember = new Map<string, { workDate: string; weekday: number }[]>();
  for (const day of context.days) {
    const list = daysByMember.get(day.memberId) ?? [];
    list.push({ workDate: day.workDate, weekday: isoWeekday(day.workDate) });
    daysByMember.set(day.memberId, list);
  }

  const skipped: WorkbookSkippedRow[] = [];
  const statements = new Map<string, Statement>();
  const note = (row: number, lineText: string, reason: string) =>
    skipped.push({ sheet: 'bericht', row, text: lineText.slice(0, 120), reason });

  // The subject is part of the message, and a mail about one employee often
  // names them only there. It is a sentence rather than a name, so the whole
  // name has to stand in it; a surname on its own would hand Piet's week to Jan.
  const fromSubject = context.subject ? inlineMember(context.subject, members) : [];
  let current = fromSubject.length === 1 ? { member: fromSubject[0].member, uncertain: false } : null;
  let conflict: { first: WorkbookCandidate; second: WorkbookCandidate } | null = null;

  for (const [index, raw] of lines.entries()) {
    const lineText = raw.trim();
    const row = index + 1;
    if (!lineText) continue;
    const folded = fold(lineText);

    // A line that is nothing but a name introduces the employee the lines under
    // it are about. Written in full it is certain; an initial with a surname is
    // a match a named person still has to confirm.
    const heading = matchHoursMember(lineText.replace(/[:;-]\s*$/, ''), members);
    const headingHasValue = hasWeekday(folded) || DATE_PATTERN.test(folded);
    if (heading && !headingHasValue) {
      current = { member: heading.member, uncertain: heading.uncertain };
      continue;
    }

    const named = inlineMember(lineText, members);
    if (named.length > 1) {
      note(row, lineText, 'Deze regel noemt meer dan één medewerker van deze week; er is niet gekozen.');
      continue;
    }
    const owner = named.length === 1
      ? { member: named[0].member, uncertain: false }
      : current;

    // Everything that is not a day is not this reader's business, and a message
    // is mostly not a day. Only a line that reaches for a day and misses is
    // reported, so the reviewer sees what was tried rather than a greeting.
    let working = folded;
    const date = readDate(working, weekDates);
    if (date && !date.workDate) {
      note(row, lineText, 'De datum in deze regel valt niet in deze week.');
      continue;
    }
    if (date) working = working.replace(date.text, ' ');
    working = working.replace(/\bweek\s*\d{1,2}\b/g, ' ');
    const weekdayNames = [...new Set(Array.from(working.matchAll(weekdayPattern()), match => WEEKDAYS[match[1]]))];
    if (!date && !weekdayNames.length) continue;
    if (weekdayNames.length > 1) {
      note(row, lineText, 'Deze regel noemt meer dan één dag; er is niet gekozen welke bedoeld is.');
      continue;
    }
    if (!owner) {
      note(row, lineText, 'Het is niet duidelijk over welke medewerker deze regel gaat. Noem de naam boven de dagen.');
      continue;
    }
    const memberDays = daysByMember.get(owner.member.id) ?? [];
    const byWeekday = weekdayNames.length
      ? memberDays.filter(day => day.weekday === weekdayNames[0]).map(day => day.workDate)
      : [];
    if (date && byWeekday.length && !byWeekday.includes(date.workDate)) {
      note(row, lineText, 'De genoemde dag en datum horen niet bij elkaar; er is niet gekozen welke geldt.');
      continue;
    }
    const workDate = date?.workDate ?? byWeekday[0];
    if (!workDate) {
      note(row, lineText, `Deze dag is geen werkdag van ${owner.member.name} in deze week.`);
      continue;
    }
    const dayId = dayOf.get(`${owner.member.id}|${workDate}`);
    if (!dayId) {
      note(row, lineText, `Deze dag is geen werkdag van ${owner.member.name} in deze week.`);
      continue;
    }

    // The weekday and the date have said what they had to say; leaving them in
    // would offer "9" of "9 september" as a duration.
    const values = working.replace(weekdayPattern(), ' ');
    const tokens = durationTokens(values);
    const correction = CORRECTION_WORDS.test(folded);
    let chosen: DurationToken | null = null;
    let superseded: string | null = null;
    if (tokens.length === 1) {
      chosen = tokens[0];
    } else if (tokens.length > 1) {
      chosen = correctedToken(values, tokens);
      if (!chosen) {
        note(row, lineText, 'Deze regel noemt meer dan één duur en zegt niet welke geldt.');
        continue;
      }
      superseded = tokens.filter(token => token !== chosen).map(token => token.text).join(' en ');
    }

    if (!chosen) {
      if (!NO_HOURS_MARKERS.test(values)) {
        note(row, lineText, 'Er staan geen uren in deze regel; er wordt niets ingevuld wat er niet staat.');
        continue;
      }
      const withoutDay = date ? lineText.replace(new RegExp(date.text, 'i'), ' ') : lineText;
      const reason = withoutDay.replace(new RegExp(WEEKDAY_SOURCE, 'gi'), ' ')
        .replace(/\s+/g, ' ').replace(/^[\s:;.,-]+|[\s:;.,-]+$/g, '');
      record({
        dayId, memberId: owner.member.id, employeeName: owner.member.name, workDate,
        minutes: 0, noHoursReason: (reason || lineText).slice(0, 500), sourceInput: null,
        pageNumber: 1, pageLabel: `bericht · regel ${row}`, sheetName: 'bericht', row,
        assignmentUncertain: owner.uncertain, employeeText: owner.member.name, notices: [],
      }, correction, superseded);
      continue;
    }

    if (NO_HOURS_MARKERS.test(values)) {
      note(row, lineText, 'Deze regel noemt zowel uren als een reden om niet te werken; er is niet gekozen.');
      continue;
    }
    const parsed = parseHoursToMinutes(chosen.text, { maxMinutes: 1440 });
    if (parsed.ok === false) {
      note(row, lineText, parsed.issues[0].message);
      continue;
    }
    if (parsed.value === 0) {
      note(row, lineText, 'Nul uren zonder reden. Leg de reden zelf als voorstel vast.');
      continue;
    }
    record({
      dayId, memberId: owner.member.id, employeeName: owner.member.name, workDate,
      minutes: parsed.value, noHoursReason: null, sourceInput: null,
      pageNumber: 1, pageLabel: `bericht · regel ${row}`, sheetName: 'bericht', row,
      assignmentUncertain: owner.uncertain, employeeText: owner.member.name, notices: [],
    }, correction, superseded);
  }

  /**
   * A day may be spoken about twice, but only when the second sentence says it
   * is taking the first one back. Two plain statements about one day leave the
   * message ambiguous, and choosing between them is exactly the guess this
   * module avoids.
   */
  function record(candidate: WorkbookCandidate, correction: boolean, superseded: string | null): void {
    const existing = statements.get(candidate.dayId);
    if (!existing) {
      statements.set(candidate.dayId, {
        candidate: superseded ? { ...candidate, correctionOf: superseded } : candidate,
        correction, supersededText: superseded,
      });
      return;
    }
    if (!correction) {
      conflict ??= { first: existing.candidate, second: candidate };
      return;
    }
    const earlier = existing.candidate.noHoursReason ?? formatMinutes(existing.candidate.minutes);
    statements.set(candidate.dayId, {
      candidate: { ...candidate, correctionOf: [superseded, earlier].filter(Boolean).join(' en ') },
      correction: true, supersededText: superseded,
    });
  }

  if (conflict) {
    return fail('DUPLICATE_DAY',
      `${conflict.first.employeeName} staat meer dan één keer op ${conflict.first.workDate}: `
      + `regel ${conflict.first.row} en regel ${conflict.second.row}. `
      + 'Maak in het bericht duidelijk welke regel geldt; er zijn geen voorstellen gemaakt.');
  }
  const candidates = [...statements.values()].map(statement => statement.candidate)
    .sort((left, right) => left.row - right.row);
  if (!candidates.length && !skipped.length) {
    return fail('NO_LAYOUT',
      'In dit bericht staat geen regel met een medewerker, een dag en een duur. Er zijn geen voorstellen gemaakt.');
  }
  return {
    ok: true, sourceKind: 'message', candidates, skipped, rowTotals: [],
    sheetsRead: ['bericht'], sheetsIgnored: [],
  };
}

const formatMinutes = (minutes: number): string =>
  `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

const formatDayName = (workDate: string): string => {
  const names = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
  return names[isoWeekday(workDate) - 1] ?? workDate;
};
