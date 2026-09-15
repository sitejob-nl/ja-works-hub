import {
  previewHoursSchedule, type HoursPlannedAction, type HoursScheduleConfig, type HoursScheduleInput,
} from './hours-schedule.ts';
import { escapeHtml, renderBrandedEmail, type BrandTheme } from './email-layout.ts';

/**
 * The boundary of the outgoing hours mail.
 *
 * `hours-schedule.ts` already decided *what* should go out and *when*; it says so
 * itself — "pure planning only, a sender must recheck the current revision,
 * recipient and outbound pause". This is that sender, and the four things it may
 * not do are the four the ticket names:
 *
 *  - **A send time never bypasses an approval.** A planned action that comes back
 *    `requires_review` is stored as a draft and is not offered to the mailbox; the
 *    claim RPC only ever hands out what a person approved.
 *  - **A repeated run sends nothing twice.** Every action carries the planner's
 *    `dedupKey`, which is unique per organisation in the outbox table. The second
 *    run finds the row already sent and plans nothing new for it.
 *  - **A provider failure is bounded.** A 5xx or 429 is transient and goes back
 *    with a counted attempt and a wait; anything else is permanent and stops.
 *  - **A blocked message is logged, not dropped.** The shared sender logs the
 *    concept in `communications` when the kill-switch is on; the outbox row keeps
 *    its approval and its place in the queue, and the attempt is not counted
 *    against it — a pause is an operator state, not a failed delivery.
 *
 * Nothing here writes to the legacy `timesheets` route, to the release register
 * (`hours_day_releases`, which belongs to T12) or to an hours day.
 */

export interface HoursOutboxAuth {
  mode: 'cron' | 'user';
  /** Present in user mode: a manual run only ever touches its own tenant. */
  organizationId?: string;
}

export interface HoursOutboxRpcResult { data: unknown; error: null | { code?: string; message?: string } }

/** What one outgoing message needs; the port wraps it in the shared Outlook sender. */
export interface HoursOutboundMessage {
  organizationId: string;
  companyId: string;
  /** Ties the logged communication to a dossier, exactly as every other sender does. */
  companyContactId: string | null;
  candidateId: string | null;
  to: string[];
  subject: string;
  htmlBody: string;
}

export interface HoursSendOutcome {
  ok: boolean;
  /** The kill-switch blocked it and the concept is logged; this is not a failure. */
  paused?: boolean;
  /** Provider status, when there was one. 5xx and 429 are transient, the rest is not. */
  status?: number;
  messageId?: string | null;
  conversationId?: string | null;
  error?: string;
}

export interface HoursOutboxPorts {
  authorize(req: Request): Promise<HoursOutboxAuth | Response>;
  serviceRpc(name: string, args: Record<string, unknown>): PromiseLike<HoursOutboxRpcResult>;
  /** The organisation's mail branding, so the wrapper is provably in this path. */
  loadTheme(organizationId: string): Promise<BrandTheme>;
  sendMail(message: HoursOutboundMessage): Promise<HoursSendOutcome>;
  /** Injected so a run is reproducible and never depends on the host clock. */
  now?(): number;
}

/** One run stays small: a cron that never finishes is a cron that never runs. */
const MAX_WEEKS = 25;
const MAX_SENDS = 10;
/**
 * Deliberately longer than the five-minute cron period. With a lease of exactly
 * one period, a run that is still working when the next one starts has its
 * messages swept back and re-claimed — and the client gets the same mail twice.
 */
const LEASE_SECONDS = 900;
/** What one `hours_outbox_sync` call accepts; more would abort the transaction. */
const MAX_ACTIONS = 200;
/** Leaves room for the request code the subject still has to carry. */
const MAX_SUBJECT = 300;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown): string => typeof value === 'string' ? value : '';

/**
 * A deterministic fingerprint of what was rendered. It exists so the database can
 * see that a draft changed under a standing approval; it is not a secret and it
 * guards nothing, so a fast non-cryptographic digest is the honest choice.
 */
export function outboxContentHash(parts: readonly string[]): string {
  let high = 0x811c9dc5;
  let low = 0x811c9dc5;
  const joined = parts.join('\u0000');
  for (let index = 0; index < joined.length; index += 1) {
    const code = joined.charCodeAt(index);
    high = Math.imul(high ^ code, 0x01000193) >>> 0;
    low = Math.imul(low ^ (code + index), 0x01000193) >>> 0;
  }
  return `${high.toString(16).padStart(8, '0')}${low.toString(16).padStart(8, '0')}`;
}

/** ISO-8601 week number of the Monday a client week starts on. */
export function isoWeekNumber(weekStart: string): number {
  const date = new Date(`${weekStart}T00:00:00Z`);
  const thursday = new Date(date.getTime() + 3 * 86_400_000);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const offset = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - offset + 3);
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

function formatDutchMoment(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '';
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  }).format(parsed);
}

interface Recipient {
  email: string; name: string; kind: string;
  companyContactId: string | null; candidateId: string | null;
}

interface DueWeek {
  weekId: string; organizationId: string; companyId: string; companyName: string; weekStart: string;
  input: Omit<HoursScheduleInput, 'asOf'>;
  recipients: Record<string, Recipient>;
  templates: Record<string, { subject: string; body: string }>;
  requestCode: string | null;
  requestId: string | null;
  facts: Record<string, unknown>;
}

function readRecipients(value: unknown): Record<string, Recipient> {
  const out: Record<string, Recipient> = {};
  if (!isRecord(value)) return out;
  for (const [id, row] of Object.entries(value)) {
    if (!isRecord(row)) continue;
    const email = text(row.email).trim();
    if (!email) continue;
    out[id] = {
      email, name: text(row.name).trim() || email, kind: text(row.kind) || 'onbekend',
      companyContactId: typeof row.company_contact_id === 'string' ? row.company_contact_id : null,
      candidateId: typeof row.candidate_id === 'string' ? row.candidate_id : null,
    };
  }
  return out;
}

function readTemplates(value: unknown): Record<string, { subject: string; body: string }> {
  const out: Record<string, { subject: string; body: string }> = {};
  if (!isRecord(value)) return out;
  for (const [key, row] of Object.entries(value)) {
    if (!isRecord(row)) continue;
    const subject = text(row.subject).trim();
    const body = text(row.body);
    if (subject && body.trim()) out[key] = { subject, body };
  }
  return out;
}

function readWeeks(value: unknown, auth: HoursOutboxAuth): DueWeek[] {
  if (!Array.isArray(value)) return [];
  const weeks: DueWeek[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    const weekId = text(row.week_id);
    const organizationId = text(row.organization_id);
    const companyId = text(row.company_id);
    const weekStart = text(row.week_start);
    if (!weekId || !organizationId || !companyId || !weekStart) continue;
    // A manual run is scoped to the caller's own tenant, whatever the listing says.
    if (auth.mode === 'user' && organizationId !== auth.organizationId) continue;
    if (!isRecord(row.config)) continue;
    const request = isRecord(row.request) ? row.request : null;
    // A withdrawn request no longer identifies a week, so its code may not travel.
    const live = request && !request.revoked_at ? request : null;
    weeks.push({
      weekId, organizationId, companyId, weekStart,
      companyName: text(row.company_name) || 'Opdrachtgever',
      input: {
        organizationId, companyId, weekStart,
        config: row.config as unknown as HoursScheduleConfig,
        recipientStates: Array.isArray(row.recipient_states) ? row.recipient_states as never : [],
        correctionApprovals: Array.isArray(row.correction_approvals) ? row.correction_approvals as never : [],
        existingActions: Array.isArray(row.existing_actions) ? row.existing_actions as never : [],
      },
      recipients: readRecipients(row.recipients),
      templates: readTemplates(row.templates),
      requestCode: live ? text(live.code) || null : null,
      requestId: live ? text(live.id) || null : null,
      facts: isRecord(row.facts) ? row.facts : {},
    });
    if (weeks.length >= MAX_WEEKS) break;
  }
  return weeks;
}

function placeholders(week: DueWeek, recipient: Recipient | null): Record<string, string> {
  const missing = Array.isArray(week.facts.missing_members)
    ? (week.facts.missing_members as unknown[]).map(name => text(name)).filter(Boolean) : [];
  return {
    opdrachtgever: week.companyName,
    week: String(isoWeekNumber(week.weekStart)),
    weekstart: week.weekStart,
    ontvanger: recipient?.name ?? '',
    code: week.requestCode ?? '',
    deadline: formatDutchMoment(text(week.facts.submission_deadline_at)),
    akkoorddeadline: formatDutchMoment(text(week.facts.confirmation_deadline_at)),
    ontbrekend: missing.join(', '),
  };
}

/** Only the names below are substituted; anything else stays literally in the text. */
export function fillPlaceholders(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z]+)\s*\}\}/gi, (match, name: string) => {
    const key = name.toLowerCase();
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
  });
}

function renderBody(body: string, theme: BrandTheme, preheader: string): string {
  const paragraphs = body.split(/\n{2,}/).map(block => block.trim()).filter(Boolean)
    .map(block => `<p style="margin:0 0 12px;">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return renderBrandedEmail({
    theme, contentHtml: paragraphs, preheader,
    footerNote: 'Dit bericht hoort bij de urenadministratie en is automatisch verstuurd.',
  });
}

interface SyncAction {
  dedup_key: string; rule_id: string; mail_type: string; party: string; recipient_id: string;
  channel: string; scheduled_at: string; effective_at: string; status: string; reason: string | null;
  approval_required: boolean; subject: string; body_html: string; recipients: string[];
  company_contact_id: string | null; candidate_id: string | null;
  content_hash: string; request_id: string | null; issue: string | null;
}

function buildAction(week: DueWeek, action: HoursPlannedAction, theme: BrandTheme): SyncAction | null {
  // A deadline escalation is a task for the responsible person, not a mail. T11
  // owns that; offering it to a mailbox here would invent a message nobody asked for.
  if (action.channel !== 'email') return null;
  const recipient = week.recipients[action.recipientId] ?? null;
  const template = action.templateId && action.language
    ? week.templates[`${action.templateId}:${action.language}`] ?? null : null;
  const values = placeholders(week, recipient);
  // A customer answers by replying, so the reference has to be in the subject it
  // replies to. The intake side already knows how to read it back.
  const codeSuffix = week.requestCode && action.party === 'customer' ? ` [${week.requestCode}]` : '';
  const subject = template
    ? `${fillPlaceholders(template.subject, values).trim().slice(0, MAX_SUBJECT)}${codeSuffix}`
    : '';
  const body = template ? fillPlaceholders(template.body, values) : '';
  const issue = !recipient ? 'onbekende_ontvanger' : !template ? 'ontbrekende_tekst' : null;
  const htmlBody = issue ? '' : renderBody(body, theme, subject);
  return {
    dedup_key: action.dedupKey, rule_id: action.ruleId, mail_type: action.mailType, party: action.party,
    recipient_id: action.recipientId, channel: action.channel,
    scheduled_at: action.scheduledAt, effective_at: action.effectiveAt,
    status: action.status, reason: action.reason, approval_required: action.approvalRequired,
    subject, body_html: htmlBody,
    recipients: recipient ? [recipient.email] : [],
    company_contact_id: recipient?.companyContactId ?? null,
    candidate_id: recipient?.candidateId ?? null,
    content_hash: outboxContentHash([subject, body, recipient?.email ?? '']),
    request_id: week.requestId,
    issue,
  };
}

interface ClaimedMessage {
  id: string; organizationId: string; companyId: string; weekId: string;
  subject: string; bodyHtml: string; recipients: string[];
  companyContactId: string | null; candidateId: string | null; requestId: string | null;
}

function readClaim(value: unknown): { token: string; messages: ClaimedMessage[]; unusable: string[] } | null {
  if (!isRecord(value) || typeof value.claim_token !== 'string' || !Array.isArray(value.messages)) return null;
  const messages: ClaimedMessage[] = [];
  // A row the claim should never have handed out. It is put back rather than
  // left holding its lease, so it cannot quietly eat its retry budget.
  const unusable: string[] = [];
  for (const row of value.messages) {
    if (!isRecord(row)) continue;
    const id = text(row.id);
    const subject = text(row.subject);
    const bodyHtml = text(row.body_html);
    const recipients = Array.isArray(row.recipients)
      ? row.recipients.map(entry => text(entry).trim()).filter(Boolean) : [];
    // Nothing without an addressee ever reaches the mailbox; the row stays visible.
    if (!id || !subject || !bodyHtml || !recipients.length) {
      if (id) unusable.push(id);
      continue;
    }
    messages.push({
      id, organizationId: text(row.organization_id), companyId: text(row.company_id),
      weekId: text(row.week_id), subject, bodyHtml, recipients,
      companyContactId: typeof row.company_contact_id === 'string' ? row.company_contact_id : null,
      candidateId: typeof row.candidate_id === 'string' ? row.candidate_id : null,
      requestId: typeof row.request_id === 'string' ? row.request_id : null,
    });
  }
  return { token: value.claim_token, messages, unusable };
}

/** 429 and 5xx are worth waiting for; everything else will fail again identically. */
const isTransient = (status?: number): boolean =>
  status === undefined || status === 429 || (status >= 500 && status < 600);

export function createHoursOutboxHandler(ports: HoursOutboxPorts, headers: Record<string, string>) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
  const now = () => ports.now ? ports.now() : Date.now();

  async function planWeek(week: DueWeek, theme: BrandTheme): Promise<number> {
    const preview = previewHoursSchedule({ ...week.input, asOf: new Date(now()).toISOString() });
    const actions: SyncAction[] = [];
    for (const action of preview.actions) {
      const built = buildAction(week, action, theme);
      if (built) actions.push(built);
    }
    // The store bounds one call at two hundred actions. Cutting the list would
    // silently drop the latest-scheduled messages *and* let the end-of-call
    // sweep cancel their existing rows — approvals included. So send every
    // action, in batches, and only let the last full pass prune: a call that did
    // not see the whole plan may not decide what is no longer part of it.
    const batches: SyncAction[][] = [];
    for (let at = 0; at < actions.length; at += MAX_ACTIONS) {
      batches.push(actions.slice(at, at + MAX_ACTIONS));
    }
    if (!batches.length) batches.push([]);
    for (const [index, batch] of batches.entries()) {
      const stored = await ports.serviceRpc('hours_outbox_sync', {
        p_week_id: week.weekId,
        p_actions: batch,
        // Visible configuration problems travel with the plan instead of being
        // swallowed: a rule that cannot be read has to be fixable from the screen.
        p_issues: index === 0 ? preview.issues : [],
        p_prune: batches.length === 1 && index === 0,
      });
      // `rpc()` resolves with `{data, error}` and never throws, so an unchecked
      // call reports success for a write that was refused.
      if (stored.error) throw new Error('sync_failed');
    }
    return actions.length;
  }

  async function deliver(message: ClaimedMessage, token: string): Promise<'sent' | 'paused' | 'failed' | 'unrecorded'> {
    const outcome = await ports.sendMail({
      organizationId: message.organizationId, companyId: message.companyId,
      companyContactId: message.companyContactId, candidateId: message.candidateId,
      to: message.recipients, subject: message.subject, htmlBody: message.bodyHtml,
    });
    if (outcome.ok) {
      const recorded = await ports.serviceRpc('hours_outbox_record_sent', {
        p_id: message.id, p_claim_token: token,
        p_outbound_message_id: outcome.messageId ?? null,
        p_conversation_id: outcome.conversationId ?? null,
        p_recipients: message.recipients,
      });
      // The mail is already in somebody's inbox. If the database will not record
      // that, the row keeps its claim and its lease runs out, which parks it as
      // `verzending_onzeker` for a person — deliberately, because sending twice
      // is worse than sending once and asking somebody to check.
      if (recorded.error) return 'unrecorded';
      return 'sent';
    }
    // The kill-switch already logged the concept in `communications`. The row
    // keeps its approval and its turn; a pause is not a failed attempt.
    const kind = outcome.paused ? 'paused' : isTransient(outcome.status) ? 'transient' : 'permanent';
    const recorded = await ports.serviceRpc('hours_outbox_record_failure', {
      p_id: message.id, p_claim_token: token, p_kind: kind,
      p_error: (outcome.error ?? '').slice(0, 500),
    });
    // A failure that cannot be recorded leaves the claim standing; say so rather
    // than reporting a tidy outcome for a message that is now stuck on a lease.
    if (recorded.error) return 'unrecorded';
    return kind === 'paused' ? 'paused' : 'failed';
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') {
      return json({ error: 'Gebruik POST om de urenmail te draaien.', code: 'method_not_allowed' }, 405);
    }
    try {
      const auth = await ports.authorize(req);
      if (auth instanceof Response) return auth;
      const due = await ports.serviceRpc('hours_outbox_due_weeks', {
        p_limit: MAX_WEEKS,
        p_organization_id: auth.mode === 'user' ? auth.organizationId ?? null : null,
      });
      if (due.error) {
        return json({ error: 'De urenmail is tijdelijk niet beschikbaar.', code: 'outbox_unavailable' }, 503);
      }
      const weeks = readWeeks(due.data, auth);
      const themes = new Map<string, BrandTheme>();
      let planned = 0;
      const errors: string[] = [];
      for (const week of weeks) {
        // One broken tenant may not stop every other tenant's mail.
        try {
          let theme = themes.get(week.organizationId);
          if (!theme) {
            theme = await ports.loadTheme(week.organizationId);
            themes.set(week.organizationId, theme);
          }
          planned += await planWeek(week, theme);
        } catch { errors.push('week_failed'); }
      }

      let sent = 0;
      let paused = 0;
      let failed = 0;
      for (let round = 0; round < MAX_SENDS; round += 1) {
        const claim = await ports.serviceRpc('hours_outbox_claim', {
          p_limit: 1, p_lease_seconds: LEASE_SECONDS,
          p_organization_id: auth.mode === 'user' ? auth.organizationId ?? null : null,
        });
        if (claim.error) break;
        const claimed = readClaim(claim.data);
        if (!claimed) break;
        // Hand back anything the claim should not have offered, so it waits its
        // turn again instead of sitting on a lease it cannot use.
        for (const id of claimed.unusable) {
          await ports.serviceRpc('hours_outbox_release', { p_id: id, p_claim_token: claimed.token });
        }
        if (!claimed.messages.length) break;
        for (const message of claimed.messages) {
          let outcome: 'sent' | 'paused' | 'failed' | 'unrecorded';
          try {
            outcome = await deliver(message, claimed.token);
          } catch {
            // The lease runs out and the next pass picks it up; the attempt is
            // already counted, so this can never loop without a bound.
            await ports.serviceRpc('hours_outbox_release', { p_id: message.id, p_claim_token: claimed.token });
            outcome = 'failed';
          }
          if (outcome === 'sent') sent += 1;
          else if (outcome === 'paused') paused += 1;
          else {
            failed += 1;
            if (outcome === 'unrecorded') errors.push('record_failed');
          }
        }
      }
      return json({ mode: auth.mode, weeks: weeks.length, planned, sent, paused, failed, errors });
    } catch {
      // Never expose tokens, provider payloads, database details or mail content.
      return json({ error: 'De urenmail is tijdelijk niet beschikbaar.', code: 'outbox_unavailable' }, 503);
    }
  };
}
