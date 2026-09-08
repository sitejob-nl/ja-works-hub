/** Pure planning only. A sender must recheck the current revision, recipient and outbound pause. */
export const HOURS_TIME_ZONE = "Europe/Amsterdam" as const;
export type HoursParty = "customer" | "employee" | "internal";
export type HoursDeadline = "submission" | "approval";
export type HoursMailType =
  | "hours_request"
  | "approval_request"
  | "submission_reminder"
  | "approval_reminder"
  | "correction_query"
  | "submission_deadline"
  | "approval_deadline";
export type HoursTimeDisambiguation = "reject" | "earlier" | "later";

export interface HoursWeekTime {
  kind: "week_time";
  /** Relative to the Monday of the working week, not the week of the scheduler run. */
  weekOffset: number;
  /** ISO weekday: Monday = 1, Sunday = 7. */
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  time: string;
  /** A repeated autumn time requires an explicit choice. Missing spring times always fail. */
  disambiguation?: HoursTimeDisambiguation;
}

export type HoursScheduleMoment = HoursWeekTime | {
  kind: "deadline_offset";
  deadline: HoursDeadline;
  /** Elapsed minutes, including across a clock change; -60 means one real hour before. */
  offsetMinutes: number;
};

export interface HoursMailRule {
  /** Keep this ID on a timing/template change; a new reminder needs its own ID. */
  id: string;
  enabled: boolean;
  mailType: HoursMailType;
  party: HoursParty;
  recipientIds: readonly string[];
  at: HoursScheduleMoment;
  templateId?: string;
  language?: "nl" | "en" | "pl";
}

/** Persist the effective snapshot on the customer week; do not merge new settings on each run. */
export interface HoursScheduleConfig {
  timezone: typeof HOURS_TIME_ZONE;
  submissionDeadline: HoursWeekTime;
  approvalDeadline: HoursWeekTime;
  lateApproval: {
    mode: "require_review" | "send_if_window";
    /** Minimum real minutes remaining when a late request is evaluated, strictly positive. */
    minimumWindowMinutes: number;
  };
  rules: readonly HoursMailRule[];
}

export interface HoursRecipientState {
  party: HoursParty;
  recipientId: string;
  /** Customer/internal completeness must come from the current authoritative week snapshot. */
  submissionComplete?: boolean;
  /** Internal aggregate only. Employee approval always compares the actual revision below. */
  approvalComplete?: boolean;
  hours?: {
    availableAt: string;
    revision: string;
    approvedRevision: string | null;
  };
}

export interface HoursCorrectionApproval {
  ruleId: string;
  recipientId: string;
  contentHash: string;
  sourceRevision: string;
  approvedContentHash: string | null;
  approvedSourceRevision: string | null;
}

export interface HoursScheduleInput {
  organizationId: string;
  companyId: string;
  /** ISO date of the Monday, for example 2026-09-07. */
  weekStart: string;
  /** Explicit clock: the result never depends on Date.now() or the host timezone. */
  asOf: string;
  config: HoursScheduleConfig;
  recipientStates?: readonly HoursRecipientState[];
  correctionApprovals?: readonly HoursCorrectionApproval[];
  existingActions?: readonly {
    dedupKey: string;
    status: "completed" | "provider_accepted" | "uncertain" | "in_progress";
  }[];
}

export type HoursActionReason =
  | "already_completed" | "delivery_uncertain" | "in_progress"
  | "already_submitted" | "already_approved" | "missing_state" | "hours_unavailable"
  | "late_approval_requires_review" | "insufficient_approval_window" | "deadline_passed"
  | "correction_approval_required" | "invalid_hours_state";

export interface HoursPlannedAction {
  dedupKey: string;
  ruleId: string;
  mailType: HoursMailType;
  party: HoursParty;
  recipientId: string;
  channel: "email" | "task";
  scheduledAt: string;
  /** Can differ for explicitly permitted late approval requests. */
  effectiveAt: string;
  status: "planned" | "due" | "waiting" | "skipped" | "requires_review";
  reason: HoursActionReason | null;
  approvalRequired: boolean;
  requiresRecheck: true;
  templateId?: string;
  language?: "nl" | "en" | "pl";
}

export interface HoursScheduleIssue {
  scope: string;
  code: string;
  message: string;
}

export interface HoursSchedulePreview {
  timezone: typeof HOURS_TIME_ZONE;
  weekStart: string;
  submissionDeadlineAt: string | null;
  approvalDeadlineAt: string | null;
  actions: HoursPlannedAction[];
  disabledRuleIds: string[];
  issues: HoursScheduleIssue[];
}

export class HoursScheduleError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "HoursScheduleError";
  }
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: HOURS_TIME_ZONE,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function invalid(code: string, message: string): never {
  throw new HoursScheduleError(code, message);
}

function calendarTimestamp(date: string, time = "00:00"): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    invalid("invalid_local_time", "Gebruik een geldige datum (JJJJ-MM-DD) en tijd (UU:mm).");
  }
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(hour, minute, 0, 0);
  if (year < 1900 || value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) {
    invalid("invalid_local_time", "De opgegeven kalenderdatum bestaat niet of valt vóór 1900.");
  }
  return value.getTime();
}

function parseInstant(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/.test(value)) {
    invalid("invalid_instant", "Gebruik een ISO-tijdstip met expliciete tijdzone.");
  }
  calendarTimestamp(value.slice(0, 10));
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) invalid("invalid_instant", "Het tijdstip is ongeldig.");
  return parsed;
}

function localTimestamp(instant: number): number {
  const parts = Object.fromEntries(formatter.formatToParts(instant).map(({ type, value }) => [type, value]));
  return calendarTimestamp(`${parts.year}-${parts.month}-${parts.day}`, `${parts.hour}:${parts.minute}`);
}

/**
 * Uses the runtime's IANA timezone rules, not a hardcoded Dutch UTC offset.
 * Spring gaps are rejected, never silently shifted to a different local time.
 * Autumn overlaps default to rejection; `earlier`/`later` selects the matching UTC occurrence.
 */
export function resolveAmsterdamLocalTime(
  date: string,
  time: string,
  disambiguation: HoursTimeDisambiguation = "reject",
): string {
  if (!["reject", "earlier", "later"].includes(disambiguation)) {
    invalid("invalid_disambiguation", "Kies reject, earlier of later voor een dubbele lokale tijd.");
  }
  const wallTime = calendarTimestamp(date, time);
  const offsets = new Set<number>();
  // Observe both sides of any Dutch clock transition surrounding the local date.
  for (const hours of [-36, 0, 36]) {
    const probe = wallTime + hours * 60 * MINUTE;
    offsets.add(localTimestamp(probe) - probe);
  }
  const matches = [...offsets]
    .map((offset) => wallTime - offset)
    .filter((candidate) => localTimestamp(candidate) === wallTime)
    .sort((a, b) => a - b);
  if (!matches.length) invalid("nonexistent_local_time", `${date} ${time} bestaat niet in ${HOURS_TIME_ZONE} door de klokverzetting.`);
  if (matches.length > 1 && disambiguation === "reject") {
    invalid("ambiguous_local_time", `${date} ${time} komt tweemaal voor; kies expliciet de eerste of tweede keer.`);
  }
  return new Date(disambiguation === "later" ? matches[matches.length - 1] : matches[0]).toISOString();
}

function weekMoment(weekStart: string, moment: HoursWeekTime): string {
  if (moment.kind !== "week_time" || !Number.isInteger(moment.weekOffset) || Math.abs(moment.weekOffset) > 52
    || !Number.isInteger(moment.weekday) || moment.weekday < 1 || moment.weekday > 7) {
    invalid("invalid_week_moment", "Een weekmoment vereist een weekverschuiving van -52 t/m 52 en weekdag 1 t/m 7.");
  }
  const date = new Date(calendarTimestamp(weekStart) + (moment.weekOffset * 7 + moment.weekday - 1) * DAY)
    .toISOString().slice(0, 10);
  return resolveAmsterdamLocalTime(date, moment.time, moment.disambiguation);
}

function isTask(type: HoursMailType): boolean {
  return type === "submission_deadline" || type === "approval_deadline";
}

function validRuleParty(rule: HoursMailRule): boolean {
  switch (rule.mailType) {
    case "hours_request": case "submission_reminder": return rule.party === "customer";
    case "approval_request": case "approval_reminder": return rule.party === "employee";
    case "submission_deadline": case "approval_deadline": return rule.party === "internal";
    case "correction_query": return ["customer", "employee", "internal"].includes(rule.party);
    default: return false;
  }
}

function actionKey(input: HoursScheduleInput, rule: HoursMailRule, recipientId: string): string {
  // Exclude scheduledAt, template/version and asOf: replanning cannot resend a completed event.
  // There is at most one deadline task per responsible recipient/customer week/deadline.
  return "hours:v1:" + [input.organizationId, input.companyId, input.weekStart, rule.party, recipientId, rule.mailType,
    isTask(rule.mailType) ? "deadline" : rule.id].map(encodeURIComponent).join(":");
}

function decision(action: HoursPlannedAction, status: HoursPlannedAction["status"], reason: HoursActionReason): void {
  action.status = status;
  action.reason = reason;
}

function evaluateAction(
  action: HoursPlannedAction,
  input: HoursScheduleInput,
  now: number,
  submissionDeadline: number,
  approvalDeadline: number,
): void {
  const existing = input.existingActions?.find((item) => item.dedupKey === action.dedupKey);
  if (existing) {
    if (existing.status === "uncertain") decision(action, "requires_review", "delivery_uncertain");
    else if (existing.status === "in_progress") decision(action, "waiting", "in_progress");
    else decision(action, "skipped", "already_completed");
    return;
  }
  const state = input.recipientStates?.find((item) => item.party === action.party && item.recipientId === action.recipientId);
  if (action.mailType === "correction_query") {
    const approval = input.correctionApprovals?.find((item) => item.ruleId === action.ruleId && item.recipientId === action.recipientId);
    if (!approval?.contentHash?.trim() || !approval.sourceRevision?.trim()
      || approval.contentHash !== approval.approvedContentHash || approval.sourceRevision !== approval.approvedSourceRevision) {
      decision(action, "requires_review", "correction_approval_required");
    }
    return;
  }
  if (!state) {
    decision(action, "waiting", "missing_state");
    return;
  }
  if (action.mailType === "hours_request" || action.mailType === "submission_reminder" || action.mailType === "submission_deadline") {
    if (state.submissionComplete === true) decision(action, "skipped", "already_submitted");
    else if (state.submissionComplete !== false) decision(action, "waiting", "missing_state");
    else if (!isTask(action.mailType) && Math.max(now, parseInstant(action.scheduledAt)) >= submissionDeadline) {
      decision(action, "requires_review", "deadline_passed");
    }
    return;
  }
  if (action.mailType === "approval_deadline") {
    if (state.approvalComplete === true) decision(action, "skipped", "already_approved");
    else if (state.approvalComplete !== false) decision(action, "waiting", "missing_state");
    return;
  }
  if (!state.hours) {
    decision(action, "waiting", "hours_unavailable");
    return;
  }
  let availableAt: number;
  try {
    if (!state.hours.revision?.trim()) invalid("invalid_hours_state", "De urenrevisie ontbreekt.");
    availableAt = parseInstant(state.hours.availableAt);
  } catch {
    decision(action, "requires_review", "invalid_hours_state");
    return;
  }
  if (availableAt > now) {
    decision(action, "waiting", "hours_unavailable");
    return;
  }
  if (state.hours.approvedRevision === state.hours.revision) {
    decision(action, "skipped", "already_approved");
    return;
  }
  const scheduledAt = parseInstant(action.scheduledAt);
  if (Math.max(now, scheduledAt) >= approvalDeadline) {
    decision(action, "requires_review", "deadline_passed");
    return;
  }
  if (action.mailType === "approval_request" && now > scheduledAt
    && approvalDeadline - now < input.config.lateApproval.minimumWindowMinutes * MINUTE) {
    decision(action, "requires_review", "insufficient_approval_window");
    return;
  }
  // A missed reminder is not silently converted into the employee's first approval request.
  if (availableAt > scheduledAt) {
    if (action.mailType !== "approval_request" || input.config.lateApproval.mode === "require_review") {
      decision(action, "requires_review", "late_approval_requires_review");
      return;
    }
    if (approvalDeadline - Math.max(availableAt, now) < input.config.lateApproval.minimumWindowMinutes * MINUTE) {
      decision(action, "requires_review", "insufficient_approval_window");
      return;
    }
    action.effectiveAt = new Date(availableAt).toISOString();
    action.status = availableAt <= now ? "due" : "planned";
  }
}

/**
 * Resolve a persisted customer-week configuration and evaluate current eligibility.
 * Missing state never counts as completion; this function cannot approve hours or send mail.
 * Invalid input identity/clock/week throws. Invalid configuration is returned as visible issues.
 */
export function previewHoursSchedule(input: HoursScheduleInput): HoursSchedulePreview {
  if (!input.organizationId?.trim() || !input.companyId?.trim()) invalid("missing_scope", "Organisatie en opdrachtgever zijn verplicht.");
  const week = calendarTimestamp(input.weekStart);
  if (new Date(week).getUTCDay() !== 1) invalid("invalid_week_start", "De werkweek moet op een maandag beginnen.");
  const now = parseInstant(input.asOf);
  const result: HoursSchedulePreview = {
    timezone: HOURS_TIME_ZONE, weekStart: input.weekStart,
    submissionDeadlineAt: null, approvalDeadlineAt: null,
    actions: [], disabledRuleIds: [], issues: [],
  };
  const addIssue = (scope: string, error: unknown) => {
    result.issues.push({ scope, code: error instanceof HoursScheduleError ? error.code : "invalid_configuration",
      message: error instanceof Error ? error.message : "De planning is ongeldig." });
  };
  if (!input.config || typeof input.config !== "object" || Array.isArray(input.config)) {
    addIssue("config", new HoursScheduleError("invalid_configuration", "De vastgelegde weekplanning ontbreekt of is ongeldig."));
    return result;
  }
  const runtimeRules: unknown = input.config.rules;
  if (!Array.isArray(runtimeRules) || runtimeRules.some((rule) => !rule || typeof rule !== "object"
    || Array.isArray(rule) || typeof rule.id !== "string" || !rule.id.trim() || typeof rule.enabled !== "boolean")) {
    addIssue("rules", new HoursScheduleError("invalid_configuration", "De berichtregels moeten een lijst met geldige IDs en expliciete aan/uit-instellingen zijn."));
    return result;
  }
  if (input.config.timezone !== HOURS_TIME_ZONE) {
    addIssue("timezone", new HoursScheduleError("unsupported_timezone", "De urenplanning gebruikt Europe/Amsterdam."));
    return result;
  }
  for (const deadline of ["submission", "approval"] as const) {
    try {
      result[`${deadline}DeadlineAt`] = weekMoment(input.weekStart, input.config[`${deadline}Deadline`]);
    } catch (error) { addIssue(`${deadline}Deadline`, error); }
  }
  if (!result.submissionDeadlineAt || !result.approvalDeadlineAt) return result;
  const submissionDeadline = parseInstant(result.submissionDeadlineAt);
  const approvalDeadline = parseInstant(result.approvalDeadlineAt);
  if (approvalDeadline <= submissionDeadline) {
    addIssue("approvalDeadline", new HoursScheduleError("invalid_deadline_order", "De akkoorddeadline moet na de aanleverdeadline liggen."));
    return result;
  }
  if (!["require_review", "send_if_window"].includes(input.config.lateApproval?.mode)
    || !Number.isSafeInteger(input.config.lateApproval.minimumWindowMinutes) || input.config.lateApproval.minimumWindowMinutes <= 0) {
    addIssue("lateApproval", new HoursScheduleError("invalid_late_policy", "Kies een regel voor late aanlevering en een positief akkoordvenster in minuten."));
    return result;
  }
  const ruleIds = new Set<string>();
  const duplicateRuleIds = new Set<string>();
  for (const rule of input.config.rules) {
    if (ruleIds.has(rule.id)) duplicateRuleIds.add(rule.id);
    ruleIds.add(rule.id);
  }
  const stateKeys = input.recipientStates?.map((state) => JSON.stringify([state.party, state.recipientId])) ?? [];
  const correctionKeys = input.correctionApprovals?.map((approval) => JSON.stringify([approval.ruleId, approval.recipientId])) ?? [];
  const existingKeys = input.existingActions?.map((action) => action.dedupKey) ?? [];
  if ([stateKeys, correctionKeys, existingKeys].some((keys) => new Set(keys).size !== keys.length)) {
    addIssue("state", new HoursScheduleError("duplicate_state", "De actuele toestand bevat meerdere waarden voor dezelfde ontvanger of actie."));
    return result;
  }
  const plannedKeys = new Set<string>();
  for (const rule of input.config.rules) {
    if (!rule.enabled) { result.disabledRuleIds.push(rule.id); continue; }
    try {
      if (!rule.id?.trim() || duplicateRuleIds.has(rule.id)) invalid("invalid_rule_id", "Elke berichtregel vereist een unieke, vaste ID.");
      if (!validRuleParty(rule)) invalid("invalid_rule_party", "Deze berichtsoort hoort niet bij de ingestelde partij.");
      if (!rule.recipientIds.length || rule.recipientIds.some((id) => !id?.trim())
        || new Set(rule.recipientIds).size !== rule.recipientIds.length) {
        invalid("invalid_recipients", "Kies ten minste één ontvanger zonder lege of dubbele ontvangers.");
      }
      if (!isTask(rule.mailType) && (!rule.templateId?.trim() || !rule.language || !["nl", "en", "pl"].includes(rule.language))) {
        invalid("missing_template", "Kies een template en taal voor deze mail.");
      }
      if (rule.party === "customer" && rule.language === "pl") invalid("invalid_language", "Klantmails ondersteunen Nederlands en Engels.");
      let scheduledAt: string;
      if (rule.at.kind === "week_time") scheduledAt = weekMoment(input.weekStart, rule.at);
      else if (rule.at.kind === "deadline_offset" && ["submission", "approval"].includes(rule.at.deadline)
        && Number.isSafeInteger(rule.at.offsetMinutes) && Math.abs(rule.at.offsetMinutes) <= 527_040) {
        const deadline = rule.at.deadline === "submission" ? submissionDeadline : approvalDeadline;
        scheduledAt = new Date(deadline + rule.at.offsetMinutes * MINUTE).toISOString();
      } else invalid("invalid_moment", "Kies een geldig weekmoment of een verschuiving ten opzichte van een deadline.");
      if (isTask(rule.mailType) && parseInstant(scheduledAt) !== (rule.mailType === "submission_deadline" ? submissionDeadline : approvalDeadline)) {
        invalid("invalid_deadline_task", "Een deadlinetaak hoort exact op de betreffende deadline.");
      }
      for (const recipientId of rule.recipientIds) {
        const dedupKey = actionKey(input, rule, recipientId);
        if (plannedKeys.has(dedupKey)) {
          addIssue(rule.id, new HoursScheduleError("duplicate_event", "Deze ontvanger heeft al dezelfde deadlinetaak in deze werkweek."));
          continue;
        }
        plannedKeys.add(dedupKey);
        const action: HoursPlannedAction = {
          dedupKey, ruleId: rule.id, mailType: rule.mailType, party: rule.party, recipientId,
          channel: isTask(rule.mailType) ? "task" : "email", scheduledAt, effectiveAt: scheduledAt,
          status: parseInstant(scheduledAt) <= now ? "due" : "planned", reason: null,
          approvalRequired: rule.mailType === "correction_query", requiresRecheck: true,
          templateId: rule.templateId, language: rule.language,
        };
        evaluateAction(action, input, now, submissionDeadline, approvalDeadline);
        result.actions.push(action);
      }
    } catch (error) { addIssue(rule.id, error); }
  }
  result.actions.sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.dedupKey.localeCompare(b.dedupKey));
  return result;
}
