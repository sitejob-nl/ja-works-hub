/**
 * How a reply is recognised as belonging to one client week.
 *
 * This module only *reads*: it pulls the candidate couplings out of a message
 * and hands them to the database, which decides. Everything that could put hours
 * on the wrong week — which request, which sender, which week — is decided there,
 * against rows this side cannot see.
 */

/** The alphabet has no 0/O and no 1/I, so a code can be read back over the phone. */
const CODE = /\bUR-([23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4})-([23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4})\b/gi;

/**
 * The codes a message carries, from the subject and the text that was written
 * now. Never from the quoted history: last month's request is in there too, and
 * picking one of those would be exactly the guess this route must not make.
 */
export function extractRequestCodes(subject: string, newText: string): string[] {
  const found = new Set<string>();
  for (const part of [subject ?? '', newText ?? '']) {
    for (const match of part.matchAll(CODE)) found.add(`UR-${match[1]}-${match[2]}`.toUpperCase());
  }
  return [...found];
}

/**
 * The message ids this reply hangs from. `In-Reply-To` names its parent and
 * `References` the whole thread; the outbox's own id is somewhere in there once
 * T8 has actually sent something.
 *
 * Bounded on purpose: a long-running thread can carry hundreds, and the database
 * only has to look up the handful that could be an hours request.
 */
export function extractReplyIds(headers: Record<string, string | undefined>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const name of ['in-reply-to', 'references']) {
    for (const match of (headers[name] ?? '').matchAll(/<[^<>\s]{1,510}>/g)) {
      const id = match[0];
      if (seen.has(id)) continue;
      seen.add(id);
      found.push(id);
      if (found.length >= 20) return found;
    }
  }
  return found;
}
