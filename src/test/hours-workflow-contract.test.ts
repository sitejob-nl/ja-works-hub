import { describe, expect, it } from 'vitest';
import { hoursWeekSchema, toHoursWeekView, hoursWorkflowError } from '@/lib/hours-workflow';
import { qk } from '@/lib/query-keys';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const revision = { id: id(5), revision_number: 2, minutes: 510, no_hours_reason: null, note: '8:30 gecorrigeerd', source_references: [], created_at: '2026-09-08T08:00:00Z' };
const input = {
  id: id(1), company_id: id(2), company_name: 'Test opdrachtgever', week_start: '2026-09-07',
  submission_deadline_at: '2026-09-14T08:00:00Z', confirmation_deadline_at: '2026-09-15T08:00:00Z',
  settings_snapshot: { enabled: true }, workflow_enabled: true, can_manage: true, can_confirm: false, release_available: false,
  members: [{ id: id(3), placement_id: id(6), candidate_id: id(7), candidate_name: 'Test medewerker', start_date: '2026-09-07', end_date: '2026-09-13', days: [{
    id: id(4), work_date: '2026-09-07', current_revision: revision,
    confirmation: { id: id(8), revision_id: id(9), decision: 'confirmed', note: null, created_at: '2026-09-08T07:00:00Z' },
    review: { id: id(10), revision_id: id(9), status: 'checked', note: null, created_at: '2026-09-08T07:00:00Z' },
  }] }],
};

describe('hours workflow boundary', () => {
  it('never transfers an old approval or review to corrected hours', () => {
    const day = toHoursWeekView(hoursWeekSchema.parse(input)).employees[0].days[0];
    expect(day.revision.minutes).toBe(510);
    expect(day.confirmation).toBeNull();
    expect(day.review).toBeNull();
  });
  it('keeps approval of the exact revision', () => {
    const data = structuredClone(input);
    data.members[0].days[0].confirmation.revision_id = revision.id;
    const day = toHoursWeekView(hoursWeekSchema.parse(data)).employees[0].days[0];
    expect(day.confirmation.status).toBe('confirmed');
  });
  it('uses the current workflow switch even when private settings are hidden in the portal', () => {
    expect(toHoursWeekView(hoursWeekSchema.parse({ ...input, settings_snapshot: {} })).enabled).toBe(true);
    expect(toHoursWeekView(hoursWeekSchema.parse({ ...input, workflow_enabled: false })).enabled).toBe(false);
  });
  it('does not present the current revision as an earlier version', () => {
    const data = hoursWeekSchema.parse(input);
    data.members[0].days[0].history = [revision, { ...revision, id: id(11), revision_number: 1, minutes: 570 }];
    const history = toHoursWeekView(data).employees[0].days[0].history;
    expect(history).toHaveLength(1);
    expect(history[0].minutes).toBe(570);
  });
  it('keeps an unreceived day distinct from an explicit no-hours day', () => {
    const data = hoursWeekSchema.parse(input);
    data.members[0].days[0].current_revision = null;
    expect(toHoursWeekView(data).employees[0].days[0].revision).toBeNull();
    data.members[0].days[0].current_revision = { ...revision, minutes: 0, no_hours_reason: 'Niet ingepland' };
    expect(toHoursWeekView(data).employees[0].days[0].revision).toMatchObject({ minutes: 0, noHoursReason: 'Niet ingepland' });
  });
  it('rejects missing permissions, fractional minutes and unimplemented release permission', () => {
    expect(hoursWeekSchema.safeParse({ ...input, can_manage: undefined }).success).toBe(false);
    expect(hoursWeekSchema.safeParse({ ...input, release_available: true }).success).toBe(false);
    const data = structuredClone(input);
    data.members[0].days[0].current_revision.minutes = 533.4;
    expect(hoursWeekSchema.safeParse(data).success).toBe(false);
  });
  it('isolates caches by organization, signed-in user and auth zone', () => {
    const base = qk.hoursWorkflow.week('org-a', 'person-a', 'portal', 'week-a');
    expect(base).not.toEqual(qk.hoursWorkflow.week('org-b', 'person-a', 'portal', 'week-a'));
    expect(base).not.toEqual(qk.hoursWorkflow.week('org-a', 'person-b', 'portal', 'week-a'));
    expect(base).not.toEqual(qk.hoursWorkflow.week('org-a', 'person-a', 'internal', 'week-a'));
  });
  it('shows a reload action after an optimistic version conflict', () => {
    expect(hoursWorkflowError({ code: '40001', message: 'internal debug' })).toContain('Ververs de week');
  });
});
