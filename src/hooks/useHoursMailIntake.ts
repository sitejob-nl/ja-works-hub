import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  hoursRunMailIntake, hoursWorkflowRpc, parseMailOverview, type HoursMailOverview,
} from '@/lib/hours-workflow-api';
import { qk } from '@/lib/query-keys';

/**
 * The office side of the durable mail intake: which folders are followed, and
 * what came in that the intake refused to place.
 *
 * Everything a run does happens on the server. This hook never touches a
 * mailbox: it reads a projection and asks the edge function to do one pass.
 */
export function useHoursMailIntake(organizationId: string, enabled = true) {
  return useQuery({
    queryKey: qk.hoursWorkflow.mailIntake(organizationId),
    enabled: Boolean(organizationId) && enabled,
    queryFn: async (): Promise<HoursMailOverview> =>
      parseMailOverview(await hoursWorkflowRpc('hours_mail_overview', {})),
  });
}

export interface FollowFolderInput {
  mailAccountId: string; folderId: string; folderLabel: string; enabled: boolean;
}

export function useHoursMailActions(organizationId: string) {
  const qc = useQueryClient();
  const store = (data: HoursMailOverview) => {
    qc.setQueryData(qk.hoursWorkflow.mailIntake(organizationId), data);
  };

  const follow = useMutation({
    mutationFn: async (input: FollowFolderInput) => parseMailOverview(
      await hoursWorkflowRpc('hours_mail_set_folder', {
        p_mail_account_id: input.mailAccountId, p_folder_id: input.folderId,
        p_folder_label: input.folderLabel, p_enabled: input.enabled,
      })),
    onSuccess: store,
  });

  const dismiss = useMutation({
    mutationFn: async (input: { messageId: string; note: string | null }) => parseMailOverview(
      await hoursWorkflowRpc('hours_mail_dismiss_message',
        { p_message_id: input.messageId, p_note: input.note })),
    onSuccess: store,
  });

  const assign = useMutation({
    mutationFn: async (input: { messageId: string; weekId: string; note: string | null }) => parseMailOverview(
      await hoursWorkflowRpc('hours_mail_assign_message',
        { p_message_id: input.messageId, p_week_id: input.weekId, p_note: input.note })),
    onSuccess: (data) => {
      store(data);
      // A hand-assigned message becomes a source on that week as soon as the
      // next pass runs, so anything showing that week has to be re-read.
      void qc.invalidateQueries({ queryKey: qk.hoursWorkflow.all(organizationId) });
    },
  });

  const run = useMutation({
    mutationFn: hoursRunMailIntake,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.hoursWorkflow.all(organizationId) }); },
  });

  return { follow, dismiss, assign, run };
}
