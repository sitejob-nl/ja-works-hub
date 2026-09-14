import { z } from 'zod';
import type {
  HoursClassificationView, HoursDayBasisView, HoursMatrixOptionsView, HoursWeekView,
} from '@/components/hours-workflow/types';
import { hoursSourceInputSchema, type HoursSourceInput } from '@/components/hours-workflow/hours-day-source';
import { formatAiCreditEuro } from '@/lib/ai-credits';
import { describeSourceReferences, sourceOriginLabel } from '@/lib/hours-sources';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const hoursClassificationSchema = z.object({
  id: uuid, revision_id: uuid, status: z.enum(['classified', 'blocked', 'no_hours']),
  matrix_version_id: uuid.nullable(), matrix_name: z.string().nullable(), matrix_scope: z.enum(['client', 'cao']).nullable(),
  engine_version: z.string(), created_at: z.string(), basis_pinned: z.boolean(),
  // A migration goes live before the frontend that reads it, so a field this
  // release adds must not make an older answer unreadable.
  basis_version: z.number().int().nullable().default(null),
  allocations: z.array(z.object({ categoryCode: z.string(), factor: z.string(), minutes: z.number().int().min(0).max(1440), ruleId: z.string(), sourceCategory: z.string().optional() }).strict()),
  issues: z.array(z.object({ code: z.string(), message: z.string(), field: z.string().optional(), expectedMinutes: z.number().int().optional(), actualMinutes: z.number().int().optional() }).strict()),
});
const revisionSchema = z.object({
  id: uuid, revision_number: z.number().int().positive(), minutes: z.number().int().nonnegative(),
  no_hours_reason: z.string().nullable(), note: z.string().nullable(),
  source_references: z.array(z.unknown()), created_at: z.string(),
  source_input: hoursSourceInputSchema.nullable().optional(), classification: hoursClassificationSchema.nullable().optional(),
});
const basisEntrySchema = z.object({
  basis_version: z.number().int().nonnegative(), matrix_id: uuid, matrix_version_id: uuid,
  matrix_name: z.string(), scope: z.enum(['client', 'cao']), reason: z.string().nullable(),
  revision_id: uuid, created_by: uuid, created_at: z.string(),
});
export const hoursDayBasisSchema = z.object({
  basis_version: z.number().int().nonnegative(), matrix_id: uuid, matrix_version_id: uuid,
  matrix_name: z.string(), scope: z.enum(['client', 'cao']), entries: z.array(basisEntrySchema),
});
export const hoursMatrixOptionsSchema = z.object({
  day_id: uuid, work_date: date, released: z.boolean(), can_manage: z.boolean(),
  basis: hoursDayBasisSchema.nullable(),
  options: z.array(z.object({
    matrix_id: uuid, matrix_version_id: uuid, matrix_name: z.string(), scope: z.enum(['client', 'cao']),
    valid_from: date, valid_until: date.nullable(), is_current: z.boolean(),
  })),
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
      classification: hoursClassificationSchema.nullable().optional(),
      history: z.array(revisionSchema).optional(),
      previous_classifications: z.array(hoursClassificationSchema).default([]),
      matrix_basis: hoursDayBasisSchema.nullable().default(null),
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

/**
 * An outcome recorded for another day version says nothing about this one.
 * A week assembled without the parser, or read from a database that predates
 * this release, simply has no earlier outcomes rather than failing to render.
 */
function ownClassifications(
  values: z.infer<typeof hoursClassificationSchema>[] | undefined, revisionId: string | undefined,
): HoursClassificationView[] {
  return revisionId && Array.isArray(values)
    ? values.filter(value => value.revision_id === revisionId).map(toHoursClassificationView)
    : [];
}

/** Never treat a response to an older revision as approval of the current hours. */
export function toHoursWeekView(week: HoursWeek): HoursWeekView {
  const mapRevision = (revision: z.infer<typeof revisionSchema>) => {
    const [origin] = describeSourceReferences(revision.source_references);
    return {
    id: revision.id, version: revision.revision_number, minutes: revision.minutes,
    noHoursReason: revision.no_hours_reason, notes: revision.note,
    sourceLabel: sourceOriginLabel(origin), sourceReference: origin?.reference ?? undefined,
    createdAt: revision.created_at,
    sourceInput: revision.source_input as HoursSourceInput | null | undefined,
    classification: revision.classification?.revision_id === revision.id ? toHoursClassificationView(revision.classification) : null,
    };
  };
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
        classification: day.classification && day.current_revision && day.classification.revision_id === day.current_revision.id ? toHoursClassificationView(day.classification) : null,
        previousClassifications: ownClassifications(day.previous_classifications, day.current_revision?.id),
        matrixBasis: day.matrix_basis ? toHoursDayBasisView(day.matrix_basis) : null,
        history: day.history?.filter(revision => revision.id !== day.current_revision?.id).map(mapRevision),
        confirmation: day.confirmation && day.current_revision && day.confirmation.revision_id === day.current_revision.id ? {
          revisionId: day.confirmation.revision_id, status: day.confirmation.decision, comment: day.confirmation.note,
        } : null,
        review: day.review && day.current_revision && day.review.revision_id === day.current_revision.id ? {
          revisionId: day.review.revision_id, status: day.review.status, comment: day.review.note,
        } : null,
      })),
    })),
  };
}

export function toHoursClassificationView(value: z.infer<typeof hoursClassificationSchema>): HoursClassificationView {
  return {
    id: value.id, revisionId: value.revision_id, status: value.status, matrixVersionId: value.matrix_version_id,
    matrixName: value.matrix_name, matrixScope: value.matrix_scope, engineVersion: value.engine_version,
    createdAt: value.created_at, basisPinned: value.basis_pinned, basisVersion: value.basis_version,
    allocations: value.allocations as HoursClassificationView['allocations'], issues: value.issues as HoursClassificationView['issues'],
  };
}

export function toHoursDayBasisView(value: z.infer<typeof hoursDayBasisSchema>): HoursDayBasisView {
  return {
    basisVersion: value.basis_version, matrixId: value.matrix_id, matrixVersionId: value.matrix_version_id,
    matrixName: value.matrix_name, scope: value.scope,
    entries: value.entries.map(entry => ({
      basisVersion: entry.basis_version, matrixId: entry.matrix_id, matrixVersionId: entry.matrix_version_id,
      matrixName: entry.matrix_name, scope: entry.scope, reason: entry.reason,
      revisionId: entry.revision_id, createdBy: entry.created_by, createdAt: entry.created_at,
    })),
  };
}

export function toHoursMatrixOptions(value: z.infer<typeof hoursMatrixOptionsSchema>): HoursMatrixOptionsView {
  return {
    dayId: value.day_id, workDate: value.work_date, released: value.released, canManage: value.can_manage,
    basis: value.basis ? toHoursDayBasisView(value.basis) : null,
    options: value.options.map(option => ({
      matrixId: option.matrix_id, matrixVersionId: option.matrix_version_id, matrixName: option.matrix_name,
      scope: option.scope, validFrom: option.valid_from, validUntil: option.valid_until, isCurrent: option.is_current,
    })),
  };
}

/**
 * The one shape a screen receives when the data layer refuses: the readable
 * message, with the server's code kept so a conflict is still recognised.
 */
export function hoursWorkflowFailure(error: unknown): Error & { code?: string } {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined;
  return Object.assign(new Error(hoursWorkflowError(error)), code ? { code } : {});
}

export function hoursWorkflowError(error: unknown): string {
  const value = (error ?? {}) as Record<string, unknown>;
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code === 'PT409' || code === '40001') return 'Deze uren zijn ondertussen gewijzigd. Ververs de week en controleer de nieuwe versie.';
  if (code === '42501') return 'Je hebt geen toegang tot deze uren of deze actie.';
  // A refusal from a paid route says so, with the id the office needs to find
  // that request back in the ledger. Most of these carry an id and no cost —
  // a held reservation, a budget refusal — and those are exactly the cases
  // where the id is the only thing to quote.
  if ((typeof value.requestId === 'string' || typeof value.costCents === 'number')
    && typeof value.message === 'string') {
    const parts = [
      typeof value.costCents === 'number' ? `kosten ${formatAiCreditEuro(value.costCents)}` : null,
      typeof value.requestId === 'string' ? `kenmerk ${value.requestId}` : null,
    ].filter(Boolean);
    return parts.length ? `${value.message} (${parts.join(', ')})` : value.message;
  }
  if (error instanceof z.ZodError) return 'Het urenoverzicht kon niet betrouwbaar worden gelezen. Ververs de pagina.';
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message);
  return 'De uren konden niet worden verwerkt. Probeer het opnieuw.';
}
