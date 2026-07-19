import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unwrapList } from '@/lib/db';
import { INTERNAL_ASSIGNEE_ROLES, type AssigneeProfile } from '@/lib/match-assignee';

/**
 * Actieve interne collega's van de organisatie — de enige kandidaten om
 * accountmanager van een match te zijn. Portaalrollen worden uitgefilterd.
 */
export const useMatchAssignees = (orgId?: string | null, enabled = true) =>
  useQuery({
    queryKey: ['match-assignees', orgId],
    enabled: Boolean(orgId) && enabled,
    queryFn: async (): Promise<AssigneeProfile[]> =>
      unwrapList(
        supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .eq('organization_id', orgId!)
          .eq('is_active', true)
          .in('role', INTERNAL_ASSIGNEE_ROLES)
          .order('full_name'),
      ),
  });
