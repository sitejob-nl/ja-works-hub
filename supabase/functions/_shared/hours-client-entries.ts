import { parseHoursToMinutes } from './hours-calculation.ts';

/**
 * What a client types on the personal week page, turned into the entries the
 * database accepts.
 *
 * This runs in the edge function, which is the only caller of
 * `hours_client_week_save`. The browser runs the very same code so the client
 * sees a mistake while typing, but nothing here is a trust boundary: the
 * database checks every rule again. What lives here is the *reading* of a typed
 * duration, and it deliberately reuses the released `parseHoursToMinutes`, so
 * "8,5" and "8:30" mean exactly what they mean everywhere else in this module.
 *
 * The rule that matters most is the smallest one: a blank field produces no
 * entry at all. An unfilled day stays unknown, and never quietly becomes zero.
 */

/** One day as the page presents it. Everything is optional; blank means unknown. */
export interface ClientDayInput {
  day_id?: unknown;
  hours?: unknown;
  no_hours?: unknown;
  reason?: unknown;
  note?: unknown;
}

/** One day as `hours_client_week_save` reads it. */
export interface ClientDayEntry {
  day_id: string;
  minutes: number;
  no_hours_reason: string | null;
  note: string | null;
}

export interface ClientEntryIssue {
  day_id: string | null;
  message: string;
}

export interface ClientEntriesResult {
  entries: ClientDayEntry[];
  issues: ClientEntryIssue[];
}

/** The server bound, mirrored here so a large delivery is narrowed, not refused whole. */
export const MAX_CLIENT_ENTRIES = 500;
const MAX_NOTE = 2000;
const MAX_REASON = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

/**
 * Builds the delivery. Any day with a problem produces an issue and no entry,
 * and a delivery that contradicts itself produces no entries at all — half a
 * delivery is worse than none, exactly as on the server.
 */
export function buildClientEntries(input: unknown): ClientEntriesResult {
  if (!Array.isArray(input)) {
    return { entries: [], issues: [{ day_id: null, message: 'Er is niets ingevuld om op te slaan.' }] };
  }
  if (input.length > MAX_CLIENT_ENTRIES) {
    return {
      entries: [],
      issues: [{ day_id: null, message: `Er passen maximaal ${MAX_CLIENT_ENTRIES} dagen in één keer opslaan.` }],
    };
  }
  const entries: ClientDayEntry[] = [];
  const issues: ClientEntryIssue[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const day = (raw ?? {}) as ClientDayInput;
    const dayId = typeof day.day_id === 'string' && UUID.test(day.day_id) ? day.day_id : null;
    if (!dayId) {
      issues.push({ day_id: null, message: 'Deze regel hoort niet bij een werkdag van deze week.' });
      continue;
    }
    if (seen.has(dayId)) {
      issues.push({ day_id: dayId, message: 'Deze werkdag staat er meer dan één keer in; vul hem één keer in.' });
      continue;
    }
    seen.add(dayId);
    const note = text(day.note);
    if (note && note.length > MAX_NOTE) {
      issues.push({ day_id: dayId, message: 'Deze opmerking is te lang.' });
      continue;
    }
    if (day.no_hours === true) {
      const reason = text(day.reason);
      if (!reason) {
        issues.push({ day_id: dayId, message: 'Geef een reden waarom er geen uren zijn.' });
        continue;
      }
      if (reason.length > MAX_REASON) {
        issues.push({ day_id: dayId, message: 'Deze reden is te lang.' });
        continue;
      }
      entries.push({ day_id: dayId, minutes: 0, no_hours_reason: reason, note });
      continue;
    }
    const hours = text(day.hours);
    // A blank field is unknown. Not zero, not a guess, and not an error either:
    // a client is allowed to deliver part of the week. A note on its own is a
    // different case: something was typed about this day, so dropping it in
    // silence and reporting success would be a lie.
    if (!hours) {
      if (note) {
        issues.push({ day_id: dayId, message: 'Vul bij deze dag ook uren in, of kies "geen uren" met een reden.' });
      }
      continue;
    }
    const parsed = parseHoursToMinutes(hours, { maxMinutes: 1440 });
    if (parsed.ok === false) {
      issues.push({ day_id: dayId, message: parsed.issues[0]?.message ?? 'Deze duur is niet te lezen.' });
      continue;
    }
    if (parsed.value === 0) {
      issues.push({ day_id: dayId, message: 'Kies "geen uren" en geef een reden in plaats van nul uren.' });
      continue;
    }
    entries.push({ day_id: dayId, minutes: parsed.value, no_hours_reason: null, note });
  }
  return issues.length ? { entries: [], issues } : { entries, issues };
}

/** Why a personal link does not open, in terms the page can act on. */
export type ClientLinkStatus = 'expired' | 'revoked' | 'invalid' | 'unavailable';

/**
 * The SQLSTATEs that say something about the *link itself*. Everything else —
 * including a workday that does not belong to this link, or an unreadable
 * duration — is a refusal about the request, and the visitor should read the
 * server's own words instead of losing the page they were filling in.
 *
 * `42501` is deliberately absent: it also guards a day outside this link's
 * week, and reporting that as a dead link would replace the whole page and
 * throw away what the client had just typed.
 */
const LINK_CODES = new Set(['PT410', 'PT403', 'PT404']);

export function isClientLinkCode(code: unknown): boolean {
  return typeof code === 'string' && LINK_CODES.has(code);
}

/**
 * The database says why through its SQLSTATE, so the page never has to match on
 * a sentence. Anything unrecognised is "unavailable": a link is only ever open
 * when the server actually returned a week.
 */
export function clientLinkStatusFromCode(code: unknown): ClientLinkStatus {
  switch (code) {
    case 'PT410': return 'expired';
    case 'PT403': return 'revoked';
    case 'PT404': return 'invalid';
    default: return 'unavailable';
  }
}

/**
 * The SQLSTATEs whose message this module wrote itself, in Dutch, for exactly
 * this reader. Everything else — a deadlock, a unique-index name, a failed uuid
 * cast, a missing function — is Postgres talking to a developer, and it has no
 * business on a page that anyone with a link can open.
 */
const SPEAKABLE_CODES = new Set(['22023', '42501']);
const GENERIC_REFUSAL =
  'Dit kon niet worden opgeslagen. Probeer het opnieuw of neem contact op met uw contactpersoon.';

export function clientRefusalMessage(error: { code?: string | null; message?: string } | null): string {
  const code = error?.code;
  const message = error?.message;
  return typeof code === 'string' && SPEAKABLE_CODES.has(code) && typeof message === 'string' && message.trim()
    ? message : GENERIC_REFUSAL;
}

/**
 * Whether a storage refusal means the object is already there. The upload path
 * is the digest of the bytes, so an existing object holds exactly these bytes
 * and registering it again yields one source. Any other failure is a real
 * failure, and calling it "already delivered" would surface later as a
 * misleading "file not found".
 */
export function isAlreadyStoredObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { statusCode?: string | number; message?: string };
  return String(value.statusCode ?? '') === '409'
    || /already exists|duplicate/i.test(value.message ?? '');
}
