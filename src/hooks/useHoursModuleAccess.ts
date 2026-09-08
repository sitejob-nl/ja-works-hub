import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { unwrap } from '@/lib/db';
import { qk } from '@/lib/query-keys';

export const HOURS_WORKFLOW_MODULE = 'uren-workflow';

export interface HoursModuleActor {
  organizationId: string | null | undefined;
  userId: string | null | undefined;
  zone: 'internal' | 'portal';
  loading?: boolean;
}

const moduleAccessSchema = z.object({
  organization_id: z.string().uuid().nullable(),
  enabled: z.boolean(),
}).strict();

/** Separate opt-in: subscription plans and the legacy `uren` switch never grant access. */
export function useHoursModuleAccess(actor: HoursModuleActor) {
  const ready = !actor.loading && !!actor.organizationId && !!actor.userId;
  const authBoundary = useRef({ ready, revision: 0 });
  // Re-authentication for the same user must not resurrect a grant from before
  // the auth transition while its new server check is still in flight.
  if (authBoundary.current.ready && !ready) authBoundary.current.revision += 1;
  authBoundary.current.ready = ready;
  const query = useQuery({
    queryKey: qk.hoursModule.access(actor.organizationId ?? '', actor.userId ?? '', actor.zone, authBoundary.current.revision),
    queryFn: async () => {
      const data = moduleAccessSchema.parse(await unwrap(supabase.rpc('hours_get_module_access')));
      if (data.organization_id !== actor.organizationId) throw new Error('De toegangscontrole hoort niet bij je huidige organisatie.');
      return data;
    },
    enabled: ready,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    refetchInterval: 15_000,
  });

  return {
    // A cached grant must first be checked again on mount. A failed refresh revokes
    // the UI immediately; writes are independently gated by PostgreSQL.
    enabled: ready && query.isSuccess && query.isFetchedAfterMount && query.fetchStatus !== 'paused'
      && query.data?.organization_id === actor.organizationId && query.data?.enabled === true,
    isLoading: !!actor.loading || (ready && !query.isFetchedAfterMount && !query.isError),
    error: ready ? query.error : null,
    refetch: query.refetch,
  };
}

/** Only the active SaaS administrator can call this setter; the server verifies that role. */
export async function setHoursWorkflowEnabled(organizationId: string, enabled: boolean) {
  const data = moduleAccessSchema.parse(await unwrap(supabase.rpc('sa_set_hours_workflow_enabled', {
    p_organization_id: organizationId,
    p_enabled: enabled,
  })));
  if (data.organization_id !== organizationId || data.enabled !== enabled) {
    throw new Error('De wijziging kon niet worden bevestigd. Laad de modules opnieuw.');
  }
  return data;
}
