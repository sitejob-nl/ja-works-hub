/**
 * Who a delivered line is about. Every reader of a delivered file asks this
 * question and none of them may answer it loosely, so the rule lives in one
 * place: the spreadsheet reader, the scan reader and anything after them all
 * decide identically, and a change is a change everywhere at once.
 */
export interface HoursWeekMember { id: string; name: string }
export interface HoursMemberMatch { member: HoursWeekMember; uncertain: boolean }

export function normalizeHoursName(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * An exactly written name is certain. A weaker but unique match — a surname, or
 * an initial with a surname — is recorded as a match the reader is unsure about,
 * so a named internal user has to confirm it before it can be applied. Anything
 * that fits nobody or several people is not a match at all.
 */
export function matchHoursMember(text: string, members: HoursWeekMember[]): HoursMemberMatch | null {
  const wanted = normalizeHoursName(text);
  if (!wanted) return null;
  const exact = members.filter(member => normalizeHoursName(member.name) === wanted
    || normalizeHoursName(member.name).split(' ').reverse().join(' ') === wanted);
  if (exact.length === 1) return { member: exact[0], uncertain: false };
  if (exact.length > 1) return null;
  const parts = wanted.split(' ').filter(Boolean);
  const weak = members.filter(member => {
    const own = normalizeHoursName(member.name).split(' ').filter(Boolean);
    if (!own.length) return false;
    const surname = own[own.length - 1];
    if (!parts.includes(surname)) return false;
    // Sharing a surname is not enough: what the file writes in front of it has
    // to fit this person. "J." fits Jan; "Piet" does not, and handing Piet's
    // hours to Jan is exactly what a shared surname invites.
    const given = own.slice(0, -1);
    return parts.filter(part => part !== surname)
      .every(part => given.some(name => name.startsWith(part) || part.startsWith(name)));
  });
  return weak.length === 1 ? { member: weak[0], uncertain: true } : null;
}
