import { describe, expect, it } from "vitest";
import {
  HOURS_TIME_ZONE, HoursScheduleError, previewHoursSchedule, resolveAmsterdamLocalTime,
  type HoursMailRule, type HoursScheduleConfig, type HoursScheduleInput, type HoursWeekTime,
} from "../../supabase/functions/_shared/hours-schedule";

const time = (weekday: HoursWeekTime["weekday"], value: string, weekOffset = 1): HoursWeekTime => ({
  kind: "week_time", weekday, time: value, weekOffset,
});
const customerRequest: HoursMailRule = {
  id: "customer-week-request", enabled: true, mailType: "hours_request", party: "customer",
  recipientIds: ["contact-a"], at: time(5, "09:00", 0), templateId: "request-v1", language: "nl",
};
const employeeRequest: HoursMailRule = {
  id: "employee-approval-request", enabled: true, mailType: "approval_request", party: "employee",
  recipientIds: ["employee-a"], at: time(1, "13:00"), templateId: "approval-v1", language: "pl",
};
const reminder: HoursMailRule = {
  id: "employee-reminder", enabled: true, mailType: "approval_reminder", party: "employee",
  recipientIds: ["employee-a"], at: { kind: "deadline_offset", deadline: "approval", offsetMinutes: -60 },
  templateId: "reminder-v1", language: "en",
};
const submissionTask: HoursMailRule = {
  id: "submission-escalation", enabled: true, mailType: "submission_deadline", party: "internal",
  recipientIds: ["case-owner-a"], at: { kind: "deadline_offset", deadline: "submission", offsetMinutes: 0 },
};
const approvalTask: HoursMailRule = {
  id: "approval-escalation", enabled: true, mailType: "approval_deadline", party: "internal",
  recipientIds: ["case-owner-a"], at: { kind: "deadline_offset", deadline: "approval", offsetMinutes: 0 },
};
const correction: HoursMailRule = {
  id: "correction-request", enabled: true, mailType: "correction_query", party: "customer",
  recipientIds: ["contact-a"], at: time(5, "09:00", 0), templateId: "correction-v1", language: "nl",
};

function input(overrides: Partial<HoursScheduleInput> = {}, config: Partial<HoursScheduleConfig> = {}): HoursScheduleInput {
  return {
    organizationId: "org-a", companyId: "company-a", weekStart: "2026-09-07", asOf: "2026-09-11T07:00:00Z",
    config: {
      timezone: HOURS_TIME_ZONE,
      submissionDeadline: time(1, "12:00"), approvalDeadline: time(2, "12:00"),
      lateApproval: { mode: "require_review", minimumWindowMinutes: 60 },
      rules: [customerRequest, employeeRequest, reminder, submissionTask, approvalTask],
      ...config,
    },
    recipientStates: [
      { party: "customer", recipientId: "contact-a", submissionComplete: false },
      { party: "employee", recipientId: "employee-a", hours: {
        availableAt: "2026-09-10T10:00:00Z", revision: "hours-r1", approvedRevision: null,
      } },
      { party: "internal", recipientId: "case-owner-a", submissionComplete: false, approvalComplete: false },
    ],
    ...overrides,
  };
}

function expectError(code: string, action: () => unknown): void {
  try {
    action();
    expect.fail(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(HoursScheduleError);
    expect((error as HoursScheduleError).code).toBe(code);
  }
}

describe("Dutch hours schedule timezone", () => {
  it("uses Dutch local time in winter and summer, independently of the host timezone", () => {
    expect(resolveAmsterdamLocalTime("2026-01-05", "09:00")).toBe("2026-01-05T08:00:00.000Z");
    expect(resolveAmsterdamLocalTime("2026-07-06", "09:00")).toBe("2026-07-06T07:00:00.000Z");
    expect(resolveAmsterdamLocalTime("2026-09-08", "00:00")).toBe("2026-09-07T22:00:00.000Z");
  });

  it.each(["reject", "earlier", "later"] as const)("blocks a nonexistent spring time even with %s disambiguation", (policy) => {
    expectError("nonexistent_local_time", () => resolveAmsterdamLocalTime("2026-03-29", "02:30", policy));
  });

  it("requires an explicit choice for the repeated autumn hour", () => {
    expectError("ambiguous_local_time", () => resolveAmsterdamLocalTime("2026-10-25", "02:30"));
    expect(resolveAmsterdamLocalTime("2026-10-25", "02:30", "earlier")).toBe("2026-10-25T00:30:00.000Z");
    expect(resolveAmsterdamLocalTime("2026-10-25", "02:30", "later")).toBe("2026-10-25T01:30:00.000Z");
  });

  it.each([
    ["2026-02-29", "09:00"], ["2026-04-31", "09:00"], ["2026-00-10", "09:00"],
    ["2026-09-08", "24:00"], ["2026-09-08", "8:30"], ["2026-09-08", "09:60"],
  ])("rejects invalid or normalized local date/time %s %s", (date, hour) => {
    expectError("invalid_local_time", () => resolveAmsterdamLocalTime(date, hour));
  });

  it("resolves an elapsed deadline offset across the spring jump without a fixed UTC offset", () => {
    const preview = previewHoursSchedule(input({ weekStart: "2026-03-23", asOf: "2026-03-27T00:00:00Z" }, {
      submissionDeadline: time(6, "12:00", 0), approvalDeadline: time(7, "03:30", 0), rules: [reminder],
    }));
    expect(preview.issues).toEqual([]);
    expect(preview.approvalDeadlineAt).toBe("2026-03-29T01:30:00.000Z");
    // One real hour before 03:30 CEST is 01:30 CET, not nonexistent 02:30.
    expect(preview.actions[0].scheduledAt).toBe("2026-03-29T00:30:00.000Z");
  });

  it("keeps an explicitly selected repeated deadline occurrence", () => {
    const preview = previewHoursSchedule(input({ weekStart: "2026-10-19", asOf: "2026-10-23T00:00:00Z" }, {
      submissionDeadline: time(6, "12:00", 0),
      approvalDeadline: { ...time(7, "02:30", 0), disambiguation: "later" }, rules: [reminder],
    }));
    expect(preview.approvalDeadlineAt).toBe("2026-10-25T01:30:00.000Z");
    expect(preview.actions[0].scheduledAt).toBe("2026-10-25T00:30:00.000Z");
  });

  it("reports an invalid deadline visibly and plans no dependent events", () => {
    const preview = previewHoursSchedule(input({ weekStart: "2026-03-23" }, {
      submissionDeadline: time(7, "02:30", 0), approvalDeadline: time(1, "12:00", 1),
    }));
    expect(preview.issues).toMatchObject([{ scope: "submissionDeadline", code: "nonexistent_local_time" }]);
    expect(preview.actions).toEqual([]);
  });
});

describe("hours schedule per customer and working week", () => {
  it("keeps two parties' deadlines and email moments separate", () => {
    const a = previewHoursSchedule(input());
    const b = previewHoursSchedule(input({ companyId: "company-b" }, {
      submissionDeadline: time(2, "14:00"), approvalDeadline: time(4, "17:00"),
      rules: [{ ...customerRequest, at: time(6, "10:30", 0) }, reminder],
    }));
    expect(a.issues).toEqual([]);
    expect(b.issues).toEqual([]);
    expect(a.submissionDeadlineAt).toBe("2026-09-14T10:00:00.000Z");
    expect(a.approvalDeadlineAt).toBe("2026-09-15T10:00:00.000Z");
    expect(b.submissionDeadlineAt).toBe("2026-09-15T12:00:00.000Z");
    expect(b.approvalDeadlineAt).toBe("2026-09-17T15:00:00.000Z");
    expect(a.actions.find((action) => action.mailType === "hours_request")).toMatchObject({
      scheduledAt: "2026-09-11T07:00:00.000Z", status: "due", language: "nl",
    });
    expect(b.actions.find((action) => action.mailType === "hours_request").scheduledAt).toBe("2026-09-12T08:30:00.000Z");
    expect(b.actions.find((action) => action.mailType === "approval_reminder").scheduledAt).toBe("2026-09-17T14:00:00.000Z");
    expect(a.actions[0].dedupKey).not.toBe(b.actions[0].dedupKey);
  });

  it("uses the supplied workweek across an ISO week-year boundary", () => {
    const preview = previewHoursSchedule(input({ weekStart: "2026-12-28", asOf: "2027-01-01T00:00:00Z" }));
    expect(preview.submissionDeadlineAt).toBe("2027-01-04T11:00:00.000Z");
    expect(preview.approvalDeadlineAt).toBe("2027-01-05T11:00:00.000Z");
    expect(preview.actions.find((action) => action.mailType === "hours_request").scheduledAt).toBe("2027-01-01T08:00:00.000Z");
  });

  it("supports a request in the week before the working week", () => {
    const preview = previewHoursSchedule(input({}, { rules: [{ ...customerRequest, at: time(5, "09:00", -1) }] }));
    expect(preview.actions[0].scheduledAt).toBe("2026-09-04T07:00:00.000Z");
  });

  it("omits disabled mail types, including incomplete settings that are not active", () => {
    const preview = previewHoursSchedule(input({}, {
      rules: [{ ...customerRequest, enabled: false, recipientIds: [], at: time(1, "invalid") }, employeeRequest],
    }));
    expect(preview.issues).toEqual([]);
    expect(preview.disabledRuleIds).toEqual([customerRequest.id]);
    expect(preview.actions.map((action) => action.mailType)).toEqual(["approval_request"]);
  });

  it("reports missing recipients or templates instead of treating the email as sent", () => {
    const preview = previewHoursSchedule(input({}, { rules: [
      { ...customerRequest, recipientIds: [] }, { ...employeeRequest, templateId: "" },
    ] }));
    expect(preview.actions).toEqual([]);
    expect(preview.issues.map((issue) => issue.code)).toEqual(["invalid_recipients", "missing_template"]);
  });

  it("refuses reversed deadlines, unsupported timezones and invalid week anchors", () => {
    const reversed = previewHoursSchedule(input({}, { approvalDeadline: time(1, "11:00") }));
    expect(reversed.issues[0].code).toBe("invalid_deadline_order");
    expect(reversed.actions).toEqual([]);
    const wrongZone = previewHoursSchedule(input({}, { timezone: "UTC" as typeof HOURS_TIME_ZONE }));
    expect(wrongZone.issues[0].code).toBe("unsupported_timezone");
    expectError("invalid_week_start", () => previewHoursSchedule(input({ weekStart: "2026-09-08" })));
    expectError("invalid_instant", () => previewHoursSchedule(input({ asOf: "2026-09-08T10:00:00" })));
  });

  it.each([
    ["missing", undefined], ["null", null], ["string", "invalid"], ["array", []], ["boolean", false],
  ])("returns a visible issue and no actions for a %s runtime configuration", (_, config) => {
    const preview = previewHoursSchedule(input({ config: config as unknown as HoursScheduleConfig }));
    expect(preview.issues).toMatchObject([{ scope: "config", code: "invalid_configuration" }]);
    expect(preview.actions).toEqual([]);
  });

  it.each([
    ["missing", undefined], ["null", null], ["object", {}], ["string", "invalid"],
    ["null entry", [null]], ["missing entry", [undefined]], ["string entry", ["invalid"]],
    ["missing rule ID", [{ enabled: true }]], ["missing enabled flag", [{ id: "request" }]],
    ["nonboolean enabled flag", [{ ...customerRequest, enabled: "false" }]],
  ])("fails closed with visible issues for %s runtime rules", (_, rules) => {
    const preview = previewHoursSchedule(input({}, { rules: rules as unknown as HoursScheduleConfig["rules"] }));
    expect(preview.issues).toMatchObject([{ scope: "rules", code: "invalid_configuration" }]);
    expect(preview.actions).toEqual([]);
  });

  it("only creates internal deadline tasks at their own deadline", () => {
    const preview = previewHoursSchedule(input({ asOf: "2026-09-15T10:00:00Z" }, { rules: [submissionTask, approvalTask] }));
    expect(preview.actions).toHaveLength(2);
    expect(preview.actions.every((action) => action.channel === "task" && action.status === "due")).toBe(true);
    const earlyTask = previewHoursSchedule(input({}, { rules: [
      { ...submissionTask, at: { kind: "deadline_offset", deadline: "submission", offsetMinutes: -1 } },
    ] }));
    expect(earlyTask.actions).toEqual([]);
    expect(earlyTask.issues[0].code).toBe("invalid_deadline_task");
  });
});

describe("hours mail eligibility and late delivery", () => {
  it("suppresses reminders for completed submissions and approval on the current revision", () => {
    const preview = previewHoursSchedule(input({
      recipientStates: [
        { party: "customer", recipientId: "contact-a", submissionComplete: true },
        { party: "employee", recipientId: "employee-a", hours: {
          availableAt: "2026-09-10T10:00:00Z", revision: "hours-r2", approvedRevision: "hours-r2",
        } },
        { party: "internal", recipientId: "case-owner-a", submissionComplete: true, approvalComplete: true },
      ],
    }));
    expect(preview.actions.every((action) => action.status === "skipped")).toBe(true);
  });

  it("does not count a previous revision or no response as employee approval", () => {
    const preview = previewHoursSchedule(input({
      asOf: "2026-09-14T12:00:00Z", recipientStates: [{ party: "employee", recipientId: "employee-a",
        approvalComplete: true, // An aggregate flag cannot override a newer employee revision.
        hours: { availableAt: "2026-09-11T10:00:00Z", revision: "hours-r2", approvedRevision: "hours-r1" },
      }],
    }, { rules: [employeeRequest] }));
    expect(preview.actions[0]).toMatchObject({ status: "due", reason: null, requiresRecheck: true });
  });

  it("waits for an actual state snapshot and hours instead of assuming availability", () => {
    const missing = previewHoursSchedule(input({ recipientStates: [] }, { rules: [employeeRequest] }));
    expect(missing.actions[0]).toMatchObject({ status: "waiting", reason: "missing_state" });
    const noHours = previewHoursSchedule(input({ recipientStates: [{ party: "employee", recipientId: "employee-a" }] }, { rules: [employeeRequest] }));
    expect(noHours.actions[0]).toMatchObject({ status: "waiting", reason: "hours_unavailable" });
  });

  it("does not treat a future availability timestamp as real received hours", () => {
    const preview = previewHoursSchedule(input({ recipientStates: [{ party: "employee", recipientId: "employee-a", hours: {
      availableAt: "2026-09-14T12:00:00Z", revision: "r1", approvedRevision: "r1",
    } }] }, { rules: [employeeRequest] }));
    expect(preview.actions[0]).toMatchObject({ status: "waiting", reason: "hours_unavailable" });
  });

  it("makes late submission visible without silently extending the approval deadline", () => {
    const preview = previewHoursSchedule(input({ asOf: "2026-09-14T14:00:00Z", recipientStates: [
      { party: "employee", recipientId: "employee-a", hours: {
        availableAt: "2026-09-14T13:00:00Z", revision: "hours-r1", approvedRevision: null,
      } },
    ] }, { rules: [employeeRequest] }));
    expect(preview.actions[0]).toMatchObject({ status: "requires_review", reason: "late_approval_requires_review" });
    expect(preview.approvalDeadlineAt).toBe("2026-09-15T10:00:00.000Z");
  });

  it("permits a late request only with an explicit sufficient remaining approval window", () => {
    const late = input({ asOf: "2026-09-14T14:00:00Z", recipientStates: [
      { party: "employee", recipientId: "employee-a", hours: {
        availableAt: "2026-09-14T13:00:00Z", revision: "hours-r1", approvedRevision: null,
      } },
    ] }, { rules: [employeeRequest], lateApproval: { mode: "send_if_window", minimumWindowMinutes: 120 } });
    const preview = previewHoursSchedule(late);
    expect(preview.actions[0]).toMatchObject({ status: "due", reason: null,
      scheduledAt: "2026-09-14T11:00:00.000Z", effectiveAt: "2026-09-14T13:00:00.000Z" });
    // A scheduler outage may consume the remaining window even if hours arrived much earlier.
    const delayed = previewHoursSchedule({ ...late, asOf: "2026-09-15T09:00:00Z" });
    expect(delayed.actions[0]).toMatchObject({ status: "requires_review", reason: "insufficient_approval_window" });
    expect(delayed.approvalDeadlineAt).toBe(preview.approvalDeadlineAt);
  });

  it("accepts exactly the configured minimum window but not one second less", () => {
    const late = input({ asOf: "2026-09-15T09:00:00Z", recipientStates: [
      { party: "employee", recipientId: "employee-a", hours: {
        availableAt: "2026-09-15T08:00:00Z", revision: "r1", approvedRevision: null,
      } },
    ] }, { rules: [employeeRequest], lateApproval: { mode: "send_if_window", minimumWindowMinutes: 60 } });
    expect(previewHoursSchedule(late).actions[0].status).toBe("due");
    expect(previewHoursSchedule({ ...late, asOf: "2026-09-15T09:00:01Z" }).actions[0].reason).toBe("insufficient_approval_window");
  });

  it("also checks the remaining window after a long scheduler delay when hours arrived on time", () => {
    const delayed = previewHoursSchedule(input({ asOf: "2026-09-15T09:45:00Z" }, { rules: [employeeRequest] }));
    expect(delayed.actions[0]).toMatchObject({ status: "requires_review", reason: "insufficient_approval_window" });
  });

  it("blocks stale mail after the deadline and still creates the responsible person's open task", () => {
    const preview = previewHoursSchedule(input({ asOf: "2026-09-15T10:00:00Z" }));
    expect(preview.actions.filter((action) => action.channel === "email").every((action) => action.reason === "deadline_passed")).toBe(true);
    expect(preview.actions.filter((action) => action.channel === "task").every((action) => action.status === "due")).toBe(true);
  });

  it("never converts a missed reminder into a first approval request", () => {
    const preview = previewHoursSchedule(input({ asOf: "2026-09-15T09:05:00Z", recipientStates: [
      { party: "employee", recipientId: "employee-a", hours: {
        availableAt: "2026-09-15T09:01:00Z", revision: "r1", approvedRevision: null,
      } },
    ] }, { rules: [reminder], lateApproval: { mode: "send_if_window", minimumWindowMinutes: 15 } }));
    expect(preview.actions[0]).toMatchObject({ status: "requires_review", reason: "late_approval_requires_review" });
  });

  it("does not choose an arbitrary state when the caller provides conflicting snapshots", () => {
    const preview = previewHoursSchedule(input({ recipientStates: [
      { party: "customer", recipientId: "contact-a", submissionComplete: false },
      { party: "customer", recipientId: "contact-a", submissionComplete: true },
    ] }));
    expect(preview.actions).toEqual([]);
    expect(preview.issues[0].code).toBe("duplicate_state");
  });
});

describe("hours planning idempotency and correction approval", () => {
  it("keeps keys stable across reruns, time/template changes and late rescheduling", () => {
    const original = previewHoursSchedule(input({}, { rules: [employeeRequest] })).actions[0];
    const rescheduled = previewHoursSchedule(input({ asOf: "2026-09-14T15:00:00Z" }, {
      rules: [{ ...employeeRequest, at: time(1, "15:00"), templateId: "approval-v2" }],
    })).actions[0];
    expect(rescheduled.scheduledAt).not.toBe(original.scheduledAt);
    expect(rescheduled.dedupKey).toBe(original.dedupKey);
    const completed = previewHoursSchedule(input({
      existingActions: [{ dedupKey: original.dedupKey, status: "completed" }],
    }, { rules: [{ ...employeeRequest, at: time(1, "15:00") }] }));
    expect(completed.actions[0]).toMatchObject({ status: "skipped", reason: "already_completed" });
  });

  it.each([
    ["provider_accepted", "skipped", "already_completed"],
    ["uncertain", "requires_review", "delivery_uncertain"],
    ["in_progress", "waiting", "in_progress"],
  ] as const)("does not duplicate a %s action", (existingStatus, status, reason) => {
    const first = previewHoursSchedule(input({}, { rules: [customerRequest] })).actions[0];
    const preview = previewHoursSchedule(input({ existingActions: [{ dedupKey: first.dedupKey, status: existingStatus }] }, { rules: [customerRequest] }));
    expect(preview.actions[0]).toMatchObject({ status, reason });
  });

  it("separates organizations, customers, recipients, weeks and distinct reminders", () => {
    const key = (value: HoursScheduleInput) => previewHoursSchedule(value).actions[0].dedupKey;
    const base = input({}, { rules: [customerRequest] });
    const keys = [
      key(base), key({ ...base, organizationId: "org-b" }), key({ ...base, companyId: "company-b" }),
      key({ ...base, weekStart: "2026-09-14" }),
      key(input({}, { rules: [{ ...customerRequest, recipientIds: ["contact-b"] }] })),
      key(input({}, { rules: [{ ...customerRequest, id: "another-event" }] })),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("creates at most one deadline task even when duplicate rules have different IDs", () => {
    const preview = previewHoursSchedule(input({}, { rules: [submissionTask, { ...submissionTask, id: "duplicate-task" }] }));
    expect(preview.actions).toHaveLength(1);
    expect(preview.issues[0].code).toBe("duplicate_event");
  });

  it("rejects duplicate logical mail rule IDs instead of silently choosing one", () => {
    const preview = previewHoursSchedule(input({}, { rules: [customerRequest, { ...customerRequest, at: time(6, "09:00", 0) }] }));
    expect(preview.actions).toEqual([]);
    expect(preview.issues.every((issue) => issue.code === "invalid_rule_id")).toBe(true);
  });

  it("keeps a correction draft approval-required even when its configured time is due", () => {
    const preview = previewHoursSchedule(input({}, { rules: [correction] }));
    expect(preview.actions[0]).toMatchObject({ status: "requires_review", reason: "correction_approval_required", approvalRequired: true });
  });

  it("ties explicit correction approval to both content and source revision", () => {
    const approved = input({ correctionApprovals: [{
      ruleId: correction.id, recipientId: "contact-a", contentHash: "hash-a", sourceRevision: "r1",
      approvedContentHash: "hash-a", approvedSourceRevision: "r1",
    }] }, { rules: [correction] });
    expect(previewHoursSchedule(approved).actions[0]).toMatchObject({ status: "due", approvalRequired: true });
    for (const change of [{ contentHash: "hash-b" }, { sourceRevision: "r2" }]) {
      const changed = { ...approved, correctionApprovals: [{ ...approved.correctionApprovals[0], ...change }] };
      expect(previewHoursSchedule(changed).actions[0]).toMatchObject({ status: "requires_review", reason: "correction_approval_required" });
    }
  });

  it("does not mutate the persisted schedule or the authoritative state snapshot", () => {
    const value = input();
    const before = JSON.stringify(value);
    const first = previewHoursSchedule(value);
    expect(previewHoursSchedule(value)).toEqual(first);
    expect(JSON.stringify(value)).toBe(before);
  });
});
