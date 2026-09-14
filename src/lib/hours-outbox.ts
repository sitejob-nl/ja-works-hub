import { z } from 'zod';

/**
 * The shapes the outgoing hours mail hands to a screen.
 *
 * Deliberately free of the Supabase client, exactly like `hours-mail.ts`: CI
 * runs the whole suite without environment variables, and a screen that pulls
 * the client in through its data layer takes the gate down with it.
 */

export const HOURS_MAIL_TYPES = [
  'hours_request', 'approval_request', 'submission_reminder', 'approval_reminder', 'correction_query',
] as const;
export type HoursMailType = (typeof HOURS_MAIL_TYPES)[number];

export const HOURS_MAIL_PARTIES = ['customer', 'employee', 'internal'] as const;
export type HoursMailParty = (typeof HOURS_MAIL_PARTIES)[number];

export const HOURS_OUTBOX_STATUSES = [
  'concept', 'gereed', 'goedgekeurd', 'verzonden', 'mislukt', 'vervallen',
] as const;
export type HoursOutboxStatus = (typeof HOURS_OUTBOX_STATUSES)[number];

/** Which party a message type belongs to; the server refuses any other pairing. */
export const HOURS_MAIL_TYPE_PARTY: Record<HoursMailType, readonly HoursMailParty[]> = {
  hours_request: ['customer'],
  submission_reminder: ['customer'],
  approval_request: ['employee'],
  approval_reminder: ['employee'],
  correction_query: ['customer', 'employee', 'internal'],
};

const LABELS: Record<HoursMailType, string> = {
  hours_request: 'Urenuitvraag',
  submission_reminder: 'Herinnering aanleveren',
  approval_request: 'Akkoord vragen',
  approval_reminder: 'Herinnering akkoord',
  correction_query: 'Correctie of navraag',
};

const PARTY_LABELS: Record<HoursMailParty, string> = {
  customer: 'Opdrachtgever',
  employee: 'Medewerker',
  internal: 'Intern',
};

/** Why a message is not going out, in words instead of a code. */
const BLOCK_REASONS: Record<string, string> = {
  goedkeuring_vereist: 'Wacht op goedkeuring',
  goedkeuring_vervallen: 'De uren zijn gewijzigd; keur opnieuw goed',
  correction_approval_required: 'Wacht op goedkeuring',
  onbekende_ontvanger: 'De ingestelde ontvanger heeft geen adres',
  ontbrekende_tekst: 'Er is nog geen tekst voor deze berichtsoort',
  uitgaande_pauze: 'Uitgaande e-mail staat op pauze; opgeslagen als concept',
  tijdelijke_storing: 'Tijdelijke storing; wordt opnieuw geprobeerd',
  te_vaak_geprobeerd: 'Te vaak geprobeerd; een mens moet hiernaar kijken',
  definitief_geweigerd: 'Definitief geweigerd door de mailserver',
  niet_meer_gepland: 'Niet meer nodig',
  niet_meer_nodig: 'Niet meer nodig',
  ingetrokken: 'Ingetrokken',
  already_submitted: 'De week is compleet aangeleverd',
  already_approved: 'Er is al akkoord',
  missing_state: 'Nog niet te beoordelen',
  hours_unavailable: 'Er staan nog geen uren',
  deadline_passed: 'De deadline is verstreken',
  late_approval_requires_review: 'Late aanlevering; beoordeel dit met de hand',
  insufficient_approval_window: 'Te weinig tijd voor akkoord',
  planned: 'Nog niet aan de beurt',
  waiting: 'Wacht op de week',
  requires_review: 'Vraagt een beoordeling',
};

export const describeMailType = (value: string): string =>
  LABELS[value as HoursMailType] ?? value;
export const describeParty = (value: string): string =>
  PARTY_LABELS[value as HoursMailParty] ?? value;
export const describeBlockReason = (value: string | null): string | null =>
  value === null ? null : BLOCK_REASONS[value] ?? value;

const moment = z.union([
  z.object({
    kind: z.literal('week_time'),
    weekOffset: z.number().int().min(-52).max(52),
    weekday: z.number().int().min(1).max(7),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }).strict(),
  z.object({
    kind: z.literal('deadline_offset'),
    deadline: z.enum(['submission', 'approval']),
    offsetMinutes: z.number().int().min(-527_040).max(527_040),
  }).strict(),
]);

export const hoursMailRuleSchema = z.object({
  id: z.string().min(1).max(120),
  enabled: z.boolean(),
  mailType: z.enum(HOURS_MAIL_TYPES),
  party: z.enum(HOURS_MAIL_PARTIES),
  recipientIds: z.array(z.string().min(1)).min(1).max(25),
  at: moment,
  templateId: z.string().min(1).max(63),
  language: z.enum(['nl', 'en', 'pl']),
});
export type HoursMailRuleView = z.infer<typeof hoursMailRuleSchema>;

export const hoursMailTemplateSchema = z.object({
  template_id: z.string(), language: z.enum(['nl', 'en', 'pl']),
  subject: z.string(), body: z.string(),
});
export type HoursMailTemplateView = z.infer<typeof hoursMailTemplateSchema>;

/** What the planner could not read the last time it ran, in its own words. */
export const hoursMailIssueSchema = z.object({
  scope: z.string(), code: z.string(), message: z.string(),
});
export type HoursMailIssue = z.infer<typeof hoursMailIssueSchema>;

export const hoursMailProfileSchema = z.object({
  company_id: z.string().uuid(),
  version: z.number().int().nonnegative(),
  late_approval_mode: z.enum(['require_review', 'send_if_window']),
  late_approval_window_minutes: z.number().int().positive(),
  last_issues: z.array(hoursMailIssueSchema).default([]),
  last_planned_at: z.string().nullable().default(null),
  // A rule the screen cannot read must not take the whole profile down; it is
  // reported instead, so it can be replaced rather than silently dropped.
  rules: z.array(z.unknown()),
  templates: z.array(hoursMailTemplateSchema),
  can_manage: z.boolean(),
});
export type HoursMailProfile = z.infer<typeof hoursMailProfileSchema>;

export const hoursOutboxMessageSchema = z.object({
  id: z.string().uuid(), week_id: z.string().uuid(), company_id: z.string().uuid(),
  company_name: z.string(), week_start: z.string(),
  rule_id: z.string(), mail_type: z.string(), party: z.string(),
  scheduled_at: z.string(), effective_at: z.string(),
  status: z.enum(HOURS_OUTBOX_STATUSES), block_reason: z.string().nullable(),
  approval_required: z.boolean(),
  subject: z.string(), body_html: z.string(), recipients: z.array(z.string()),
  content_hash: z.string(), source_revision: z.string(),
  approved_at: z.string().nullable(), approved_by: z.string().nullable(),
  attempt_count: z.number().int(), next_attempt_at: z.string().nullable(),
  last_error: z.string().nullable(),
  sent_at: z.string().nullable(), outbound_message_id: z.string().nullable(),
});
export type HoursOutboxMessage = z.infer<typeof hoursOutboxMessageSchema>;

export const hoursOutboxOverviewSchema = z.object({
  messages: z.array(hoursOutboxMessageSchema),
  can_manage: z.boolean(),
});
export type HoursOutboxOverview = z.infer<typeof hoursOutboxOverviewSchema>;

export const parseOutboxOverview = (value: unknown): HoursOutboxOverview =>
  hoursOutboxOverviewSchema.parse(value);
export const parseMailProfile = (value: unknown): HoursMailProfile =>
  hoursMailProfileSchema.parse(value);

/**
 * Reads the stored rules one by one. A rule this release cannot understand is
 * returned as an unreadable entry rather than throwing the profile away: the
 * screen has to be able to show it and let somebody replace it.
 */
export function readMailRules(rules: readonly unknown[]): {
  rules: HoursMailRuleView[]; unreadable: number;
} {
  const parsed: HoursMailRuleView[] = [];
  let unreadable = 0;
  for (const rule of rules) {
    const result = hoursMailRuleSchema.safeParse(rule);
    if (result.success) parsed.push(result.data);
    else unreadable += 1;
  }
  return { rules: parsed, unreadable };
}

/** A message a person may still approve or withdraw. */
export const isPendingApproval = (message: HoursOutboxMessage): boolean =>
  message.status === 'concept' && message.approval_required
  && message.recipients.length > 0 && message.subject.trim().length > 0;

/** Sent is terminal; nothing on the screen may offer to change it. */
export const isTerminal = (message: HoursOutboxMessage): boolean =>
  message.status === 'verzonden' || message.status === 'vervallen';
