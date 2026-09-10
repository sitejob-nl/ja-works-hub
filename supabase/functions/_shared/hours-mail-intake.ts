import { decodeEmailMessage, readEmailHeaders, type EmailAttachment } from './hours-eml.ts';
import { readHoursFromMailText } from './hours-mail-text.ts';
import { attachmentSourceType } from './hours-attachment-type.ts';
import { extractReplyIds, extractRequestCodes } from './hours-mail-link.ts';
import { readingEntryDoubt } from './hours-source-control.ts';
import type { WorkbookCandidate } from './hours-reading-types.ts';

/**
 * The boundary of the unattended mail intake.
 *
 * Everything that reaches outside — the mailbox, the bucket, the database — sits
 * behind a port, so the whole run is exercisable without a session, a mailbox or
 * a byte of real mail. Three things are deliberately not negotiable from here:
 *
 *  - **The mailbox is only read.** The two ports that touch it are `graphJson`
 *    and `graphBytes`; there is no method to pass and no third port. Nothing is
 *    marked as read, moved, deleted or sent.
 *  - **Nothing is paid for.** A message is read by the same deterministic reader
 *    an upload uses. An attachment is *stored*, never read out: the paid scan
 *    route stays a deliberate act of a person behind the same monthly budget.
 *  - **A message becomes a source with proposals, never a day version.** Only
 *    `hours_apply_source_proposal` writes one, and only for a named internal user.
 */

export interface HoursMailAuth {
  mode: 'cron' | 'user';
  /** Present in user mode: a manual run only ever touches its own tenant. */
  organizationId?: string;
}
export interface HoursMailRpcResult { data: unknown; error: null | { code?: string; message?: string } }
export interface GraphJson { status: number; body: unknown }
export interface GraphBytes { status: number; bytes: Uint8Array }

export interface HoursMailPorts {
  authorize(req: Request): Promise<HoursMailAuth | Response>;
  serviceRpc(name: string, args: Record<string, unknown>): PromiseLike<HoursMailRpcResult>;
  /** Reads. A relative path is resolved against the mailbox this account names. */
  graphJson(accountId: string, url: string): Promise<GraphJson>;
  /** Reads the raw bytes of one message, bounded by the caller's own limit. */
  graphBytes(accountId: string, url: string): Promise<GraphBytes>;
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  digest(bytes: Uint8Array): Promise<string>;
  /** Injected so a slow fetch can be recognised without waiting for one. */
  now?(): number;
}

/** One run stays small on purpose: a cron that never finishes is a cron that never runs. */
const MAX_FOLDERS = 10;
const MAX_PAGES = 20;
const MAX_MESSAGES_PER_FOLDER = 5;
const LEASE_SECONDS = 300;
/** The write bound of one recording call; a pass can see far more than this. */
const RECORD_BATCH = 200;
/** Same ceiling as the delivered-source bucket; above it nothing is stored. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

const SELECT = 'id,internetMessageId,conversationId,subject,from,sender,receivedDateTime,hasAttachments';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

interface DueFolder {
  id: string; organizationId: string; accountId: string; folderId: string; deltaLink: string | null;
}

function readFolders(value: unknown, auth: HoursMailAuth): DueFolder[] {
  if (!Array.isArray(value)) return [];
  const folders: DueFolder[] = [];
  for (const row of value) {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.organization_id !== 'string'
      || typeof row.mail_account_id !== 'string' || typeof row.folder_id !== 'string') continue;
    // A manual run is scoped to the caller's own tenant, whatever the listing says.
    if (auth.mode === 'user' && row.organization_id !== auth.organizationId) continue;
    folders.push({
      id: row.id, organizationId: row.organization_id, accountId: row.mail_account_id,
      folderId: row.folder_id,
      deltaLink: typeof row.delta_link === 'string' && row.delta_link ? row.delta_link : null,
    });
    if (folders.length >= MAX_FOLDERS) break;
  }
  return folders;
}

/** A follow-on link has to come from Graph itself, or it is not followed. */
function safeGraphLink(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.origin === 'https://graph.microsoft.com' ? url.toString() : null;
  } catch { return null; }
}

const address = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  const inner = isRecord(value.emailAddress) ? value.emailAddress : null;
  const raw = inner && typeof inner.address === 'string' ? inner.address : null;
  return raw ? raw.trim().toLowerCase().slice(0, 320) : null;
};
const displayName = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  const inner = isRecord(value.emailAddress) ? value.emailAddress : null;
  return inner && typeof inner.name === 'string' ? inner.name.slice(0, 320) : null;
};

/**
 * How far one pass got. `delta` is set when the folder was read to its end;
 * `resume` is the point to continue from when it was not.
 */
interface PassResult { delta: string | null; resume: string | null }

/**
 * One delta pass over a folder, recording every page as it comes.
 *
 * Recording per page rather than at the end does two things a big folder needs.
 * A first full read of an existing inbox is thousands of messages, far past what
 * one write may carry; and a run that stops halfway has already put what it saw
 * in the queue, so the next one continues instead of starting over.
 *
 * Graph reports a removed message as an id with `@removed` and nothing else, so
 * the two are collected apart.
 */
async function observeFolder(ports: HoursMailPorts, folder: DueFolder, resync: boolean,
  record: (messages: Record<string, unknown>[], removed: string[]) => Promise<boolean>):
Promise<{ ok: true; pass: PassResult; resynced: boolean }
  | { ok: false; error: string; resynced: boolean }> {
  let url = !resync && folder.deltaLink
    ? folder.deltaLink
    : `/mailFolders/${encodeURIComponent(folder.folderId)}/messages/delta?$select=${SELECT}`;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const answer = await ports.graphJson(folder.accountId, url);
    // 410 is Graph saying the cursor has expired. Starting the folder over is
    // safe precisely because the same message yields the same row: the full pass
    // produces no second source.
    if (answer.status === 410) {
      if (resync) return { ok: false, error: 'graph_410', resynced: true };
      return { ok: false, error: 'resync', resynced: false };
    }
    if (answer.status !== 200 || !isRecord(answer.body)) {
      return { ok: false, error: `graph_${answer.status}`, resynced: resync };
    }
    const messages: Record<string, unknown>[] = [];
    const removed: string[] = [];
    for (const entry of Array.isArray(answer.body.value) ? answer.body.value : []) {
      if (!isRecord(entry) || typeof entry.id !== 'string') continue;
      if ('@removed' in entry) { removed.push(entry.id); continue; }
      messages.push(entry);
    }
    const next = safeGraphLink(answer.body['@odata.nextLink']);
    const delta = safeGraphLink(answer.body['@odata.deltaLink']);
    // What was seen goes into the queue before the cursor moves anywhere.
    for (let from = 0; from < messages.length || from === 0; from += RECORD_BATCH) {
      const slice = messages.slice(from, from + RECORD_BATCH);
      const last = from + RECORD_BATCH >= messages.length;
      if (!slice.length && !(last && removed.length)) break;
      if (!await record(slice, last ? removed : [])) {
        return { ok: false, error: 'record_failed', resynced: resync };
      }
    }
    if (delta) return { ok: true, pass: { delta, resume: null }, resynced: resync };
    if (!next) return { ok: true, pass: { delta: null, resume: null }, resynced: resync };
    url = next;
  }
  // Out of pages for this run. The follow-on link is a Graph cursor of its own,
  // so storing it lets the next run continue where this one stopped instead of
  // reading the same first pages again and never reaching the end.
  return { ok: true, pass: { delta: null, resume: safeGraphLink(url) }, resynced: resync };
}

function recordable(entry: Record<string, unknown>): Record<string, unknown> {
  const graphId = String(entry.id);
  const internet = typeof entry.internetMessageId === 'string' && entry.internetMessageId.trim()
    ? entry.internetMessageId.trim().slice(0, 512) : null;
  return {
    // The RFC Message-ID survives a move between folders, where Graph's own id
    // does not. A sender broken enough to omit it falls back to that id, which
    // is honestly less stable and says so by carrying the prefix.
    message_key: (internet ?? `graph:${graphId}`).slice(0, 512),
    graph_message_id: graphId.slice(0, 2048),
    internet_message_id: internet,
    subject: typeof entry.subject === 'string' ? entry.subject.slice(0, 1000) : null,
    from_address: address(entry.from) ?? address(entry.sender),
    from_name: displayName(entry.from) ?? displayName(entry.sender),
    // A date the database cannot read would abort the whole write, and the
    // cursor would then stand still on it for good. An unreadable one is simply
    // unknown; everything else about the message is still true.
    received_at: typeof entry.receivedDateTime === 'string'
      && Number.isFinite(Date.parse(entry.receivedDateTime)) ? entry.receivedDateTime : null,
    has_attachments: entry.hasAttachments === true,
    conversation_id: typeof entry.conversationId === 'string' ? entry.conversationId : null,
  };
}

interface ClaimedMessage {
  id: string; graphId: string; subject: string; fromAddress: string | null;
  organizationId: string;
}

function readClaim(value: unknown): { token: string; messages: ClaimedMessage[] } | null {
  if (!isRecord(value) || typeof value.claim_token !== 'string' || !Array.isArray(value.messages)) return null;
  const messages: ClaimedMessage[] = [];
  for (const row of value.messages) {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.graph_message_id !== 'string'
      || typeof row.organization_id !== 'string') continue;
    messages.push({
      id: row.id, graphId: row.graph_message_id,
      subject: typeof row.subject === 'string' ? row.subject : '',
      fromAddress: typeof row.from_address === 'string' ? row.from_address : null,
      organizationId: row.organization_id,
    });
  }
  return { token: value.claim_token, messages };
}

interface WeekMatch {
  weekId: string; organizationId: string;
  members: { id: string; name: string }[];
  days: { id: string; memberId: string; workDate: string }[];
}

function readMatch(value: unknown): { ok: true; match: WeekMatch } | { ok: false; reason: string } {
  if (!isRecord(value)) return { ok: false, reason: 'niet_leesbaar' };
  if (value.ok !== true) {
    const reason = typeof value.reason_code === 'string' ? value.reason_code : 'geen_uitvraag';
    return { ok: false, reason };
  }
  const context = isRecord(value.context) ? value.context : {};
  const members: WeekMatch['members'] = [];
  for (const row of Array.isArray(context.members) ? context.members : []) {
    if (isRecord(row) && typeof row.id === 'string' && typeof row.name === 'string') {
      members.push({ id: row.id, name: row.name });
    }
  }
  const days: WeekMatch['days'] = [];
  for (const row of Array.isArray(context.days) ? context.days : []) {
    if (isRecord(row) && typeof row.id === 'string' && typeof row.member_id === 'string'
      && typeof row.work_date === 'string') {
      days.push({ id: row.id, memberId: row.member_id, workDate: row.work_date });
    }
  }
  if (typeof value.week_id !== 'string' || !days.length) return { ok: false, reason: 'geen_werkdagen' };
  return { ok: true, match: { weekId: value.week_id, organizationId: '', members, days } };
}

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc', 'message/rfc822': 'eml',
};

/** The digest is both the deduplication key and the stored object's name. */
async function store(ports: HoursMailPorts, organizationId: string, weekId: string,
  bytes: Uint8Array, contentType: string, fileName: string, pageCount: number | null):
Promise<Record<string, unknown>> {
  const digest = await ports.digest(bytes);
  const path = `${organizationId}/${weekId}/${digest}.${EXTENSIONS[contentType]}`;
  await ports.upload(path, bytes, contentType);
  return { content_hash: digest, file_name: fileName, content_type: contentType, page_count: pageCount };
}

/**
 * A file name Storage, the database and a human can all live with.
 *
 * A subject line is free text: it can carry a slash, a newline or nothing at
 * all, and the database refuses exactly those. Replacing them beats letting a
 * whole delivery fail over the punctuation somebody typed.
 */
export function safeName(raw: string, fallback: string): string {
  const cleaned = [...(raw || '')]
    .map(character => {
      const code = character.charCodeAt(0);
      const forbidden = code < 0x20 || code === 0x7f || character === '/' || character === '\\';
      return forbidden ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255)
    .trim();
  return cleaned || fallback;
}

/**
 * One read line, in the shape every reading route records.
 *
 * `note` stays empty on purpose: it is proposed content that gets applied to a
 * day revision *literally*, so a reader may never write into it. What a line
 * corrects is shown beside the proposal on the review screen, exactly as the
 * browser reader does it.
 *
 * `uncertain_fields` travels along for the same reason it does on the other two
 * routes: a contradiction the control found has to block applying, or the same
 * contradiction would block on one route and write an unclassifiable day
 * revision on another.
 */
const proposalOf = (candidate: WorkbookCandidate) => ({
  day_id: candidate.dayId,
  minutes: candidate.minutes,
  no_hours_reason: candidate.noHoursReason,
  note: null,
  source_input: candidate.sourceInput,
  page_label: candidate.pageLabel,
  page_number: 1,
  assignment_uncertain: candidate.assignmentUncertain,
  uncertain_fields: readingEntryDoubt(candidate.notices),
});

export function createHoursMailIntakeHandler(ports: HoursMailPorts,
  corsHeaders: Record<string, string> = {}) {
  const headers = { ...corsHeaders, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

  async function finish(messageId: string, token: string, status: 'needs_attention' | 'dismissed',
    reason: string, note: string | null = null): Promise<void> {
    await ports.serviceRpc('hours_mail_fail_message', {
      p_message_id: messageId, p_claim_token: token, p_status: status,
      p_reason_code: reason, p_reason_note: note,
    });
  }

  const clock = () => (ports.now ? ports.now() : Date.now());

  /** One claimed message, from raw bytes to a filed receipt. */
  async function processMessage(folder: DueFolder, token: string, message: ClaimedMessage):
  Promise<'filed' | 'attention' | 'gone' | 'retry'> {
    const started = clock();
    const raw = await ports.graphBytes(folder.accountId,
      `/messages/${encodeURIComponent(message.graphId)}/$value`);
    // A 25 MB message over a slow line can eat most of the lease before anything
    // is written. Renewing once here keeps a second instance from picking the
    // message up halfway through filing it; the renewals themselves are bounded
    // by the database, so a worker that is truly stuck still loses its claim.
    if (clock() - started > (LEASE_SECONDS * 1000) / 2) {
      await ports.serviceRpc('hours_mail_renew_lease',
        { p_message_id: message.id, p_claim_token: token, p_lease_seconds: LEASE_SECONDS });
    }
    // Between seeing it and fetching it, the message can be gone. Nothing has
    // been written, and nothing will be: this is where "no half processing" is.
    if (raw.status === 404 || raw.status === 410) {
      await finish(message.id, token, 'dismissed', 'verdwenen');
      return 'gone';
    }
    // Too large is not a temporary failure: trying again gives the same answer,
    // five times, and ends in the bin with a reason that explains nothing.
    if (raw.status === 413 || raw.bytes.byteLength > MAX_SOURCE_BYTES) {
      await finish(message.id, token, 'needs_attention', 'niet_leesbaar',
        'Dit bericht is groter dan 25 MB en kan niet als bron worden bewaard.');
      return 'attention';
    }
    if (raw.status !== 200 || !raw.bytes?.byteLength) {
      // A temporary failure hands the claim back; the attempt is already counted.
      await ports.serviceRpc('hours_mail_release_message',
        { p_message_id: message.id, p_claim_token: token });
      return 'retry';
    }

    const buffer = raw.bytes.slice().buffer as ArrayBuffer;
    const decoded = decodeEmailMessage(buffer);
    if (decoded.ok === false) {
      await finish(message.id, token, 'needs_attention', 'niet_leesbaar',
        decoded.issues[0]?.message ?? null);
      return 'attention';
    }

    // The reference is read from the subject and from what was written now —
    // never from the quoted history, where last month's request also stands.
    const codes = extractRequestCodes(decoded.message.subject || message.subject,
      decoded.message.text);
    const replyIds = extractReplyIds(readEmailHeaders(buffer));
    const answer = await ports.serviceRpc('hours_mail_match_message', {
      p_message_id: message.id, p_claim_token: token,
      p_codes: codes.length ? codes : null,
      p_reply_ids: replyIds.length ? replyIds : null,
      p_conversation_id: null,
    });
    if (answer.error) {
      await ports.serviceRpc('hours_mail_release_message',
        { p_message_id: message.id, p_claim_token: token });
      return 'retry';
    }
    const matched = readMatch(answer.data);
    if (matched.ok === false) {
      await finish(message.id, token, 'needs_attention', matched.reason);
      return 'attention';
    }
    const week = matched.match;

    // The same reader an upload uses, on the text that was written now.
    const reading = readHoursFromMailText(decoded.message.text, {
      members: week.members, days: week.days, subject: decoded.message.subject,
    });
    const proposals = reading.ok ? reading.candidates.map(proposalOf) : [];

    const source = await store(ports, folder.organizationId, week.weekId, raw.bytes,
      'message/rfc822', safeName(`${decoded.message.subject || 'Bericht'}.eml`, 'bericht.eml'), 1);

    // The attachments are stored, not read out. Reading a scan costs money, and
    // an unattended run may not spend it.
    const attachments: Record<string, unknown>[] = [];
    for (const attachment of decoded.message.attachments) {
      const stored = await storeAttachment(folder, week.weekId, attachment);
      if (stored) attachments.push(stored);
    }

    const filed = await ports.serviceRpc('hours_mail_file_message', {
      p_message_id: message.id, p_claim_token: token, p_source: source,
      p_attachments: attachments, p_proposals: proposals,
    });
    if (filed.error) {
      // Nothing landed: filing is one transaction. The claim goes back so the
      // next run tries again rather than leaving half a receipt.
      await ports.serviceRpc('hours_mail_release_message',
        { p_message_id: message.id, p_claim_token: token });
      return 'retry';
    }
    return 'filed';
  }

  async function storeAttachment(folder: DueFolder, weekId: string, attachment: EmailAttachment):
  Promise<Record<string, unknown> | null> {
    // A logo the body points at is part of a signature, not a delivery of hours.
    if (attachment.inline) return null;
    const contentType = attachmentSourceType(attachment.fileName, attachment.contentType, attachment.bytes);
    // One receipt is one level deep, and a type whose bytes disagree with its
    // name is not stored at all.
    if (!contentType || contentType === 'message/rfc822') return null;
    if (!attachment.bytes.byteLength || attachment.bytes.byteLength > MAX_SOURCE_BYTES) return null;
    // Nothing counted the pages of a mailed attachment, so it stays honestly
    // unknown rather than getting an invented number.
    return await store(ports, folder.organizationId, weekId, attachment.bytes, contentType,
      safeName(attachment.fileName, 'bijlage'), null);
  }

  async function runFolder(folder: DueFolder): Promise<{ filed: number; attention: number; error: string | null }> {
    // Recording is what makes the cursor safe to move, so its failure stops the
    // pass: stepping over what was not written would lose those messages, which
    // is exactly what a durable cursor exists to prevent.
    const record = async (messages: Record<string, unknown>[], removed: string[]) => {
      const answer = await ports.serviceRpc('hours_mail_record_messages', {
        p_folder_row_id: folder.id,
        p_messages: messages.map(recordable),
        p_removed: removed.length ? removed : null,
      });
      return !answer.error;
    };

    let outcome = await observeFolder(ports, folder, false, record);
    let resynced = false;
    if (outcome.ok === false && outcome.error === 'resync') {
      // The cursor expired. Throw it away and read the folder in full.
      await ports.serviceRpc('hours_mail_clear_cursor', { p_folder_row_id: folder.id });
      resynced = true;
      outcome = await observeFolder(ports, { ...folder, deltaLink: null }, true, record);
    }
    if (outcome.ok === false) {
      await ports.serviceRpc('hours_mail_set_cursor', {
        p_folder_row_id: folder.id, p_delta_link: null, p_resynced: false, p_error: outcome.error,
      });
      return { filed: 0, attention: 0, error: outcome.error };
    }
    // The cursor moves only now, when everything this pass saw is in the queue.
    // A pass that ran out of pages stores where to continue rather than nothing,
    // so a folder larger than one run still converges.
    await ports.serviceRpc('hours_mail_set_cursor', {
      p_folder_row_id: folder.id,
      p_delta_link: outcome.pass.delta ?? outcome.pass.resume,
      p_resynced: resynced, p_error: null,
    });

    let filed = 0;
    let attention = 0;
    for (let round = 0; round < MAX_MESSAGES_PER_FOLDER; round += 1) {
      const claim = await ports.serviceRpc('hours_mail_claim_messages', {
        p_folder_row_id: folder.id, p_limit: 1, p_lease_seconds: LEASE_SECONDS,
      });
      if (claim.error) break;
      const claimed = readClaim(claim.data);
      if (!claimed || !claimed.messages.length) break;
      for (const message of claimed.messages) {
        // One message that falls over unexpectedly may not hold up the rest of
        // the folder. The claim goes back so the next run picks it up again;
        // the attempt is already counted, so it cannot loop forever.
        let outcome: 'filed' | 'attention' | 'gone' | 'retry';
        try {
          outcome = await processMessage(folder, claimed.token, message);
        } catch {
          await ports.serviceRpc('hours_mail_release_message',
            { p_message_id: message.id, p_claim_token: claimed.token });
          outcome = 'retry';
        }
        if (outcome === 'filed') filed += 1;
        if (outcome === 'attention') attention += 1;
      }
    }
    return { filed, attention, error: null };
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') {
      return json({ error: 'Gebruik POST om de mailinname te draaien.', code: 'method_not_allowed' }, 405);
    }
    try {
      const auth = await ports.authorize(req);
      if (auth instanceof Response) return auth;
      const due = await ports.serviceRpc('hours_mail_due_folders', {
        p_limit: MAX_FOLDERS,
        // A manual run asks for its own tenant. Filtering a globally ordered
        // page here would hide a folder that happens to sit past the bound.
        p_organization_id: auth.mode === 'user' ? auth.organizationId ?? null : null,
      });
      if (due.error) {
        return json({ error: 'De mailinname is tijdelijk niet beschikbaar.',
          code: 'mail_intake_unavailable' }, 503);
      }
      const folders = readFolders(due.data, auth);
      let filed = 0;
      let attention = 0;
      const errors: string[] = [];
      for (const folder of folders) {
        // One mailbox that is broken — a revoked consent, a deleted account, a
        // provider that throws instead of answering — may not stop every other
        // tenant's intake. Each folder stands on its own.
        let result: { filed: number; attention: number; error: string | null };
        try {
          result = await runFolder(folder);
        } catch {
          result = { filed: 0, attention: 0, error: 'folder_failed' };
          // Say so on the folder, but never let saying so take the run down too.
          try {
            await ports.serviceRpc('hours_mail_set_cursor', {
              p_folder_row_id: folder.id, p_delta_link: null, p_resynced: false,
              p_error: 'folder_failed',
            });
          } catch { /* the folder's own failure is what matters here */ }
        }
        filed += result.filed;
        attention += result.attention;
        if (result.error) errors.push(result.error);
      }
      return json({ mode: auth.mode, folders: folders.length, filed, attention, errors });
    } catch {
      // Never expose tokens, provider payloads, database details or mail content.
      return json({ error: 'De mailinname is tijdelijk niet beschikbaar.',
        code: 'mail_intake_unavailable' }, 503);
    }
  };
}
