import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { feedbackApi } from '@/lib/feedback-api';
import { qk } from '@/lib/query-keys';
import { toFriendlyError } from '@/lib/errorMessages';
import { toast } from 'sonner';
import { INTERNAL_FEEDBACK_ROLES, type MyFeedbackReport } from '../../supabase/functions/_shared/feedback-contract';

export function useFeedbackNotifications(open: boolean) {
  const { user, role, profile } = useAuth();
  const qc = useQueryClient();
  const scope = `${profile?.organization_id ?? ''}:${user?.id ?? ''}`;
  const enabled = !!user && INTERNAL_FEEDBACK_ROLES.some(r => r === role);
  const query = useQuery({
    queryKey: qk.feedback.notifications(scope), enabled,
    queryFn: () => feedbackApi<{ reports: MyFeedbackReport[] }>({ action: 'my-notifications' }),
    refetchInterval: 30000,
  });
  const { refetch } = query;
  useEffect(() => { if (open && enabled) void refetch(); }, [open, enabled, refetch]);
  const acknowledge = useMutation({
    mutationFn: ({ id, revision, dismiss }: { id: string; revision: number; dismiss: boolean }) =>
      feedbackApi({ action: 'acknowledge', id, revision, dismiss }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.feedback.all(scope) }),
    onError: error => toast.error(toFriendlyError(error)),
  });
  return { ...query, reports: enabled ? query.data?.reports ?? [] : [], acknowledge: acknowledge.mutate };
}
