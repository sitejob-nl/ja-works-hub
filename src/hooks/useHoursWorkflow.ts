import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hoursWorkflowRpc } from '@/lib/hours-workflow-api';
import { qk } from '@/lib/query-keys';
import { hoursWeekSchema, hoursWeekListSchema } from '@/lib/hours-workflow';

export interface HoursActor { organizationId: string; userId: string; zone: 'internal' | 'portal' }

// RPC results are validated at the boundary; all mutations enforce actor and revision in PostgreSQL.
export function useHoursWeeks(actor: HoursActor, weekStart?: string) {
  return useQuery({
    queryKey: qk.hoursWorkflow.list(actor.organizationId, actor.userId, actor.zone, weekStart ?? ''),
    queryFn: async () => hoursWeekListSchema.parse(await hoursWorkflowRpc('hours_list_weeks', { p_week_start: weekStart ?? null })),
    enabled: !!actor.organizationId && !!actor.userId,
  });
}

export function useHoursWeek(actor: HoursActor, weekId?: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.hoursWorkflow.week(actor.organizationId, actor.userId, actor.zone, weekId ?? ''),
    queryFn: async () => hoursWeekSchema.parse(await hoursWorkflowRpc('hours_get_week', { p_week_id: weekId! })),
    enabled: !!actor.organizationId && !!actor.userId && !!weekId,
  });
  const mutation = useMutation({
    mutationFn: async (action: {
      type: 'save'; dayId: string; expectedRevisionId: string | null; minutes: number | null; noHoursReason: string | null; notes: string | null;
    } | {
      type: 'respond'; dayId: string; expectedRevisionId: string; response: 'confirmed' | 'disputed'; comment: string | null;
    } | {
      type: 'confirmAll'; revisions: { dayId: string; expectedRevisionId: string }[]; comment: string | null;
    } | {
      type: 'review'; dayId: string; expectedRevisionId: string; status: 'checked' | 'blocked'; comment: string | null;
    }) => {
      const result = action.type === 'save'
        ? await hoursWorkflowRpc('hours_save_day', {
          p_day_id: action.dayId, p_expected_revision_id: action.expectedRevisionId,
          p_minutes: action.minutes, p_no_hours_reason: action.noHoursReason, p_note: action.notes,
        })
        : action.type === 'respond' ? await hoursWorkflowRpc('hours_confirm_day', {
          p_day_id: action.dayId, p_expected_revision_id: action.expectedRevisionId,
          p_decision: action.response, p_note: action.comment,
        }) : action.type === 'review' ? await hoursWorkflowRpc('hours_review_day', {
          p_day_id: action.dayId, p_expected_revision_id: action.expectedRevisionId,
          p_status: action.status, p_note: action.comment,
        }) : await hoursWorkflowRpc('hours_confirm_days', {
          p_week_id: weekId!, p_revisions: action.revisions.map(revision => ({ day_id: revision.dayId, revision_id: revision.expectedRevisionId })), p_note: action.comment,
        });
      return hoursWeekSchema.parse(result);
    },
    onSuccess: async (data) => {
      qc.setQueryData(qk.hoursWorkflow.week(actor.organizationId, actor.userId, actor.zone, data.id), data);
      await qc.invalidateQueries({ queryKey: qk.hoursWorkflow.all(actor.organizationId) });
    },
  });
  return { ...query, mutation };
}
