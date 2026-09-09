/**
 * Who a delivered line is about. Every reader of a delivered file asks this
 * question and none of them may answer it loosely, so the rule lives in one
 * place: the spreadsheet reader, the scan reader and anything after them all
 * decide identically, and a change is a change everywhere at once.
 */
export interface HoursWeekMember { id: string; name: string }
export interface HoursMemberMatch { member: HoursWeekMember; uncertain: boolean }

/**
 * A member with its name already taken apart. Deriving this per line means
 * normalising every name again for every row of a delivery — a few hundred
 * thousand string passes on a large crew — for an answer that cannot change
 * while the reading runs.
 */
export interface PreparedHoursMember {
  member: HoursWeekMember;
  normalized: string;
  reversed: string;
  surname: string;
  given: string[];
}

export function prepareHoursMembers(members: HoursWeekMember[]): PreparedHoursMember[] {
  return members.map(member => {
    const normalized = normalizeHoursName(member.name);
    const parts = normalized.split(' ').filter(Boolean);
    return {
      member, normalized,
      reversed: parts.slice().reverse().join(' '),
      surname: parts[parts.length - 1] ?? '',
      given: parts.slice(0, -1),
    };
  });
}

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
export function matchHoursMember(
  text: string, members: HoursWeekMember[] | PreparedHoursMember[],
): HoursMemberMatch | null {
  const wanted = normalizeHoursName(text);
  if (!wanted) return null;
  const prepared = members.length && 'normalized' in members[0]
    ? members as PreparedHoursMember[] : prepareHoursMembers(members as HoursWeekMember[]);
  const exact = prepared.filter(item => item.normalized === wanted || item.reversed === wanted);
  if (exact.length === 1) return { member: exact[0].member, uncertain: false };
  if (exact.length > 1) return null;
  const parts = wanted.split(' ').filter(Boolean);
  const weak = prepared.filter(item => {
    if (!item.surname || !parts.includes(item.surname)) return false;
    // Sharing a surname is not enough: what the file writes in front of it has
    // to fit this person. "J." fits Jan; "Piet" does not, and handing Piet's
    // hours to Jan is exactly what a shared surname invites.
    return parts.filter(part => part !== item.surname)
      .every(part => item.given.some(name => name.startsWith(part) || part.startsWith(name)));
  });
  return weak.length === 1 ? { member: weak[0].member, uncertain: true } : null;
}
