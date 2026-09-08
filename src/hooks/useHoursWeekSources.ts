import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { hoursWorkflowRpc } from '@/lib/hours-workflow-api';
import { qk } from '@/lib/query-keys';
import {
  HOURS_SOURCE_BUCKET, hoursSourceDigest, hoursSourcePath, hoursSourceTypeError,
  parseWeekSources, type HoursSourceContentType, type HoursWeekSources,
} from '@/lib/hours-sources';
import type { HoursSourceInput } from '@/components/hours-workflow/hours-day-source';

export interface HoursSourceUploadResult { duplicate: boolean; sourceId: string }

export interface CreateProposalInput {
  sourceId: string; dayId: string; minutes: number;
  noHoursReason: string | null; note: string | null;
  sourceInput: HoursSourceInput | null; pageLabel: string | null;
}

/** Signed for minutes only; an original is never publicly reachable. */
const VIEW_TTL_SECONDS = 300;

export function useHoursWeekSources(organizationId: string, weekId: string | undefined, enabled: boolean) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.hoursWorkflow.sources(organizationId, weekId ?? ''),
    queryFn: async () => parseWeekSources(await hoursWorkflowRpc('hours_get_week_sources', { p_week_id: weekId! })),
    enabled: enabled && !!organizationId && !!weekId,
  });

  const store = (data: HoursWeekSources) => {
    qc.setQueryData(qk.hoursWorkflow.sources(organizationId, data.week_id), data);
  };

  const upload = useMutation({
    mutationFn: async (file: File): Promise<HoursSourceUploadResult> => {
      const rejection = hoursSourceTypeError(file);
      if (rejection) throw new Error(rejection);
      const bytes = await file.arrayBuffer();
      const digest = await hoursSourceDigest(bytes);
      const path = hoursSourcePath(organizationId, weekId!, digest, file.type as HoursSourceContentType);
      const { error } = await supabase.storage.from(HOURS_SOURCE_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      // The path is the digest, so an existing object already holds these bytes.
      if (error && !isAlreadyStored(error)) throw error;
      const result = await hoursWorkflowRpc('hours_add_week_source', {
        p_week_id: weekId!, p_content_hash: digest, p_file_name: file.name, p_content_type: file.type,
      }) as Record<string, unknown>;
      store(parseWeekSources(result));
      return { duplicate: result.duplicate === true, sourceId: String(result.source_id) };
    },
  });

  const createProposal = useMutation({
    mutationFn: async (input: CreateProposalInput) => parseWeekSources(await hoursWorkflowRpc('hours_create_source_proposal', {
      p_source_id: input.sourceId, p_day_id: input.dayId, p_minutes: input.minutes,
      p_no_hours_reason: input.noHoursReason, p_note: input.note,
      p_source_input: input.sourceInput, p_page_label: input.pageLabel,
    })),
    onSuccess: store,
  });

  const discardProposal = useMutation({
    mutationFn: async (input: { proposalId: string; note: string | null }) => parseWeekSources(
      await hoursWorkflowRpc('hours_discard_source_proposal', { p_proposal_id: input.proposalId, p_note: input.note })),
    onSuccess: store,
  });

  return { ...query, upload, createProposal, discardProposal };
}

/** Applying changes the week itself, so both caches are refreshed together. */
export function useApplyHoursProposal(organizationId: string, weekId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { proposalId: string; expectedRevisionId: string | null }) => {
      const result = await hoursWorkflowRpc('hours_apply_source_proposal', {
        p_proposal_id: input.proposalId, p_expected_revision_id: input.expectedRevisionId,
      }) as Record<string, unknown>;
      return {
        createdRevision: result.applied_created_revision === true,
        sources: parseWeekSources(result.sources),
      };
    },
    onSuccess: async result => {
      qc.setQueryData(qk.hoursWorkflow.sources(organizationId, result.sources.week_id), result.sources);
      await qc.invalidateQueries({ queryKey: qk.hoursWorkflow.all(organizationId) });
    },
  });
}

export async function hoursSourceViewUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(HOURS_SOURCE_BUCKET).createSignedUrl(path, VIEW_TTL_SECONDS);
  if (error || !data?.signedUrl) throw error ?? new Error('De bron kon niet worden geopend.');
  return data.signedUrl;
}

function isAlreadyStored(error: unknown): boolean {
  const value = error as { statusCode?: string | number; message?: string } | null;
  return String(value?.statusCode ?? '') === '409' || /already exists|duplicate/i.test(value?.message ?? '');
}
