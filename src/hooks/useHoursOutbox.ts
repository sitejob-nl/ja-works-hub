import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hoursOutboxRpc } from '@/lib/hours-outbox-api';
import { qk } from '@/lib/query-keys';
import {
  parseMailProfile, parseOutboxOverview, type HoursMailProfile, type HoursMailRuleView,
  type HoursOutboxOverview,
} from '@/lib/hours-outbox';
import { hoursWorkflowFailure } from '@/lib/hours-workflow';

/**
 * The office side of the outgoing hours mail.
 *
 * Nothing here sends anything. The screen configures who gets which message and
 * when, and approves a draft; the unattended run is the only thing that talks to
 * a mailbox, and it re-checks every one of these decisions server-side.
 */

export function useHoursOutbox(organizationId: string, weekId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.hoursWorkflow.outbox(organizationId, weekId ?? 'alle'),
    enabled: Boolean(organizationId) && enabled,
    queryFn: async (): Promise<HoursOutboxOverview> => {
      try {
        return parseOutboxOverview(await hoursOutboxRpc('hours_outbox_overview', {
          p_week_id: weekId ?? null, p_company_id: null, p_limit: 100,
        }));
      } catch (error) { throw hoursWorkflowFailure(error); }
    },
  });
}

export function useHoursMailProfile(organizationId: string, companyId?: string) {
  return useQuery({
    queryKey: qk.hoursWorkflow.mailProfile(organizationId, companyId ?? ''),
    enabled: Boolean(organizationId) && Boolean(companyId),
    queryFn: async (): Promise<HoursMailProfile> => {
      try {
        return parseMailProfile(await hoursOutboxRpc('hours_get_mail_profile',
          { p_company_id: companyId! }));
      } catch (error) { throw hoursWorkflowFailure(error); }
    },
  });
}

export interface SaveMailProfileInput {
  companyId: string; expectedVersion: number; rules: HoursMailRuleView[];
  lateApprovalMode: 'require_review' | 'send_if_window'; lateApprovalWindowMinutes: number;
}

export interface SaveMailTemplateInput {
  templateId: string; language: 'nl' | 'en' | 'pl'; subject: string; body: string;
}

export function useHoursOutboxActions(organizationId: string, weekId?: string) {
  const qc = useQueryClient();
  const storeOverview = (data: HoursOutboxOverview) => {
    qc.setQueryData(qk.hoursWorkflow.outbox(organizationId, weekId ?? 'alle'), data);
    // Another week's list may hold the same message, so nothing stale survives.
    void qc.invalidateQueries({ queryKey: qk.hoursWorkflow.all(organizationId) });
  };

  const saveProfile = useMutation({
    mutationFn: async (input: SaveMailProfileInput) => {
      try {
        return parseMailProfile(await hoursOutboxRpc('hours_save_mail_profile', {
          p_company_id: input.companyId, p_expected_version: input.expectedVersion,
          p_rules: input.rules, p_late_approval_mode: input.lateApprovalMode,
          p_late_approval_window_minutes: input.lateApprovalWindowMinutes,
        }));
      } catch (error) { throw hoursWorkflowFailure(error); }
    },
    onSuccess: (data, input) => {
      qc.setQueryData(qk.hoursWorkflow.mailProfile(organizationId, input.companyId), data);
    },
  });

  const saveTemplate = useMutation({
    mutationFn: async (input: SaveMailTemplateInput) => {
      try {
        await hoursOutboxRpc('hours_save_mail_template', {
          p_template_id: input.templateId, p_language: input.language,
          p_subject: input.subject, p_body: input.body,
        });
      } catch (error) { throw hoursWorkflowFailure(error); }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.hoursWorkflow.all(organizationId) });
    },
  });

  const approve = useMutation({
    // Exactly the words and the hours the approver had in front of them; the
    // server turns anything else into a conflict rather than an approval.
    mutationFn: async (input: { id: string; contentHash: string; sourceRevision: string }) => {
      try {
        return parseOutboxOverview(await hoursOutboxRpc('hours_approve_outbox_message', {
          p_id: input.id, p_expected_content_hash: input.contentHash,
          p_expected_source_revision: input.sourceRevision,
        }));
      } catch (error) { throw hoursWorkflowFailure(error); }
    },
    onSuccess: storeOverview,
  });

  const withdraw = useMutation({
    mutationFn: async (input: { id: string; note: string | null }) => {
      try {
        return parseOutboxOverview(await hoursOutboxRpc('hours_withdraw_outbox_message',
          { p_id: input.id, p_note: input.note }));
      } catch (error) { throw hoursWorkflowFailure(error); }
    },
    onSuccess: storeOverview,
  });

  return { saveProfile, saveTemplate, approve, withdraw };
}
