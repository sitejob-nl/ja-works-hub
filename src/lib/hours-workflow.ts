import { z } from 'zod';
import type { HoursWeekView } from '@/components/hours-workflow/types';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const revisionSchema = z.object({
  id: uuid, revision_number: z.number().int().positive(), minutes: z.number().int().nonnegative(),
  no_hours_reason: z.string().nullable(), note: z.string().nullable(),
  source_references: z.array(z.unknown()), created_at: z.string(),
});
export const hoursWeekSchema = z.object({
  id: uuid, company_id: uuid, company_name: z.string(), week_start: date,
  submission_deadline_at: z.string().nullable(), confirmation_deadline_at: z.string().nullable(),
  settings_snapshot: z.record(z.unknown()), workflow_enabled: z.boolean(), can_manage: z.boolean(), can_confirm: z.boolean(),
  release_available: z.literal(false),
  members: z.array(z.object({
    id: uuid, placement_id: uuid, candidate_id: uuid, candidate_name: z.string(),
    start_date: date, end_date: date,
    days: z.array(z.object({
      id: uuid, work_date: date, current_revision: revisionSchema.nullable(),
      history: z.array(revisionSchema).optional(),
      confirmation: z.object({ id: uuid, revision_id: uuid, decision: z.enum(['confirmed', 'disputed']), note: z.string().nullable(), created_at: z.string() }).nullable(),
      review: z.object({ id: uuid, revision_id: uuid, status: z.enum(['checked', 'blocked']), note: z.string().nullable(), created_at: z.string() }).nullable(),
    })),
  })),
});
export type HoursWeek = z.infer<typeof hoursWeekSchema>;
export const hoursWeekListSchema = z.object({
  can_manage: z.boolean(),
  weeks: z.array(z.object({
    id: uuid, company_id: uuid, company_name: z.string(), week_start: date,
    submission_deadline_at: z.string().nullable(), confirmation_deadline_at: z.string().nullable(),
    member_count: z.number().int().nonnegative(), day_count: z.number().int().nonnegative(),
    received_day_count: z.number().int().nonnegative(), confirmed_day_count: z.number().int().nonnegative(),
    blocked_day_count: z.number().int().nonnegative(),
  })),
});

/** Never treat a response to an older revision as approval of the current hours. */
export function toHoursWeekView(week: HoursWeek): HoursWeekView {
  const mapRevision = (revision: z.infer<typeof revisionSchema>) => ({
    id: revision.id, version: revision.revision_number, minutes: revision.minutes,
    noHoursReason: revision.no_hours_reason, notes: revision.note,
    sourceLabel: 'Handmatige invoer', createdAt: revision.created_at,
  });
  return {
    id: week.id, companyName: week.company_name, weekStart: week.week_start,
    submissionDeadline: week.submission_deadline_at, confirmationDeadline: week.confirmation_deadline_at,
    enabled: week.workflow_enabled,
    employees: week.members.map(member => ({
      id: member.id, candidateId: member.candidate_id, name: member.candidate_name,
      placementLabel: `${member.start_date} – ${member.end_date}`,
      days: member.days.map(day => ({
        id: day.id, workDate: day.work_date,
        revision: day.current_revision ? mapRevision(day.current_revision) : null,
        history: day.history?.filter(revision => revision.id !== day.current_revision?.id).map(mapRevision),
        confirmation: day.confirmation?.revision_id === day.current_revision?.id ? {
          revisionId: day.confirmation.revision_id, status: day.confirmation.decision, comment: day.confirmation.note,
        } : null,
        review: day.review?.revision_id === day.current_revision?.id ? {
          revisionId: day.review.revision_id, status: day.review.status, comment: day.review.note,
        } : null,
      })),
    })),
  };
}

export function hoursWorkflowError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code === '40001') return 'Deze uren zijn ondertussen gewijzigd. Ververs de week en controleer de nieuwe versie.';
  if (code === '42501') return 'Je hebt geen toegang tot deze uren of deze actie.';
  if (error instanceof z.ZodError) return 'Het urenoverzicht kon niet betrouwbaar worden gelezen. Ververs de pagina.';
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message);
  return 'De uren konden niet worden verwerkt. Probeer het opnieuw.';
}
