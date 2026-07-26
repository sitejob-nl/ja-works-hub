export type CandidateCommunicationRecord = {
  id: string;
  channel: string;
  subject?: string | null;
  body?: string | null;
  direction?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
  email_message_id?: string | null;
  email_from?: string | null;
  email_to?: string[] | null;
  email_cc?: string[] | null;
  profiles?: { full_name?: string | null } | null;
  [key: string]: unknown;
};

export type CandidateOutlookMessage = {
  id: string;
  account_id: string;
  mailbox_label: string;
  mailbox_email: string | null;
  subject?: string | null;
  preview?: string | null;
  from?: { name?: string | null; address?: string | null } | null;
  to?: Array<{ name?: string | null; address?: string | null }>;
  cc?: Array<{ name?: string | null; address?: string | null }>;
  received_at?: string | null;
  sent_at?: string | null;
  has_attachments?: boolean;
};

export type CandidateHistoryItem = {
  id: string;
  source: 'communication' | 'outlook';
  channel: string;
  subject: string | null;
  body: string | null;
  direction: 'inbound' | 'outbound';
  occurred_at: string | null;
  from: string | null;
  to: string[];
  cc: string[];
  mailbox_label: string | null;
  mailbox_email: string | null;
  has_attachments: boolean;
  communication?: CandidateCommunicationRecord;
  outlook?: CandidateOutlookMessage;
};

const EMAIL_RE = /^[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]+$/;
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

export function normalizeCandidateEmail(email: string | null | undefined): string | null {
  const normalized = String(email ?? '').trim().toLowerCase();
  return EMAIL_RE.test(normalized) ? normalized : null;
}

/**
 * Microsoft Graph gebruikt Advanced Query Syntax voor `$search` op berichten.
 * `participants:` doorzoekt afzender, aan, cc en bcc zonder de volledige mailbox op
 * losse teksttreffers voor het adres te laten matchen.
 */
export function buildOutlookParticipantSearch(email: string | null | undefined): string | null {
  const normalized = normalizeCandidateEmail(email);
  return normalized ? `participants:${normalized}` : null;
}

function normalizeSubject(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function emailList(values: Array<string | null | undefined> | null | undefined): string[] {
  return (values ?? []).map((value) => String(value ?? '').trim()).filter(Boolean);
}

function addressList(values: CandidateOutlookMessage['to'] | CandidateOutlookMessage['cc']): string[] {
  return (values ?? []).map((value) => String(value.address ?? '').trim()).filter(Boolean);
}

function directionForOutlook(message: CandidateOutlookMessage, candidateEmail: string | null): 'inbound' | 'outbound' {
  const from = String(message.from?.address ?? '').trim().toLowerCase();
  return candidateEmail && from === candidateEmail ? 'inbound' : 'outbound';
}

function directionForCommunication(record: CandidateCommunicationRecord): 'inbound' | 'outbound' {
  return record.direction === 'inbound' ? 'inbound' : 'outbound';
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isLikelyLoggedCopy(record: CandidateCommunicationRecord, message: CandidateHistoryItem): boolean {
  if (record.channel !== 'email' || message.channel !== 'email') return false;
  if (directionForCommunication(record) !== message.direction) return false;
  if (normalizeSubject(record.subject) !== normalizeSubject(message.subject)) return false;

  const loggedAt = timestamp(record.sent_at ?? record.created_at);
  const outlookAt = timestamp(message.occurred_at);
  if (loggedAt == null || outlookAt == null) return false;
  return Math.abs(loggedAt - outlookAt) <= DEDUPE_WINDOW_MS;
}

export function mergeCandidateHistory(
  communications: CandidateCommunicationRecord[],
  outlookMessages: CandidateOutlookMessage[],
  candidateEmail: string | null | undefined,
): CandidateHistoryItem[] {
  const normalizedEmail = normalizeCandidateEmail(candidateEmail);
  const seenOutlook = new Set<string>();
  const outlookItems: CandidateHistoryItem[] = [];

  for (const message of outlookMessages) {
    const uniqueId = `${message.account_id}:${message.id}`;
    if (seenOutlook.has(uniqueId)) continue;
    seenOutlook.add(uniqueId);

    outlookItems.push({
      id: `outlook:${uniqueId}`,
      source: 'outlook',
      channel: 'email',
      subject: message.subject ?? null,
      body: message.preview ?? null,
      direction: directionForOutlook(message, normalizedEmail),
      occurred_at: message.sent_at ?? message.received_at ?? null,
      from: message.from?.address ?? null,
      to: addressList(message.to),
      cc: addressList(message.cc),
      mailbox_label: message.mailbox_label,
      mailbox_email: message.mailbox_email,
      has_attachments: Boolean(message.has_attachments),
      outlook: message,
    });
  }

  const outlookMessageIds = new Set(outlookMessages.map((message) => message.id));
  const communicationItems = communications.flatMap<CandidateHistoryItem>((record) => {
    if (record.email_message_id && outlookMessageIds.has(record.email_message_id)) return [];
    if (outlookItems.some((message) => isLikelyLoggedCopy(record, message))) return [];

    return [{
      id: `communication:${record.id}`,
      source: 'communication',
      channel: record.channel,
      subject: record.subject ?? null,
      body: record.body ?? null,
      direction: directionForCommunication(record),
      occurred_at: record.sent_at ?? record.created_at ?? null,
      from: record.email_from ?? null,
      to: emailList(record.email_to),
      cc: emailList(record.email_cc),
      mailbox_label: null,
      mailbox_email: null,
      has_attachments: Array.isArray(record.email_attachments) && record.email_attachments.length > 0,
      communication: record,
    }];
  });

  return [...outlookItems, ...communicationItems].sort((a, b) => (
    (timestamp(b.occurred_at) ?? 0) - (timestamp(a.occurred_at) ?? 0)
  ));
}
