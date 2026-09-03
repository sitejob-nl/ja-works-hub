// Deelnemer-filter voor Outlook-maillijsten (opdrachtgever-/kandidaat-/contact-historie).
//
// Twee lagen, bewust allebei:
// 1. `buildParticipantSearch` → één KQL-string voor Graph `$search`. Graph verwacht
//    `$search="participants:a OR participants:b"` (één set aanhalingstekens rond de héle
//    expressie). Losse quoted termen aan elkaar geplakt met OR (`"participants:a" OR
//    "participants:b"`) worden door Graph NIET als filter gelezen en geven de complete
//    mailbox terug — dat was de oorzaak van ongerelateerde mail op de opdrachtgever-tab.
// 2. `messageMatchesParticipants` → server-side nafilter op afzender/aan/cc/bcc, zodat
//    tokenmatches op weergavenamen of prefixen nooit mail van derden lekken.

export const MAX_PARTICIPANT_EMAILS = 10;

export function buildParticipantSearch(emails: string[]): string | null {
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
    .slice(0, MAX_PARTICIPANT_EMAILS);
  if (unique.length === 0) return null;
  return `"${unique.map((email) => `participants:${email}`).join(" OR ")}"`;
}

type GraphRecipient = { emailAddress?: { address?: string | null } | null } | null | undefined;

export type GraphMessageParticipants = {
  from?: GraphRecipient;
  sender?: GraphRecipient;
  toRecipients?: GraphRecipient[] | null;
  ccRecipients?: GraphRecipient[] | null;
  bccRecipients?: GraphRecipient[] | null;
};

function address(recipient: GraphRecipient): string | null {
  const value = String(recipient?.emailAddress?.address ?? "").trim().toLowerCase();
  return value || null;
}

export function messageParticipantAddresses(message: GraphMessageParticipants): string[] {
  const all = [
    address(message.from),
    address(message.sender),
    ...(message.toRecipients ?? []).map(address),
    ...(message.ccRecipients ?? []).map(address),
    ...(message.bccRecipients ?? []).map(address),
  ];
  return [...new Set(all.filter((value): value is string => Boolean(value)))];
}

export function messageMatchesParticipants(message: GraphMessageParticipants, emails: Iterable<string>): boolean {
  const wanted = new Set([...emails].map((e) => e.trim().toLowerCase()).filter(Boolean));
  if (wanted.size === 0) return true;
  return messageParticipantAddresses(message).some((value) => wanted.has(value));
}
