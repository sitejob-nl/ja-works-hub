import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { useOrganizationId } from '@/hooks/useOrganizationId';

/**
 * Tenant-scoped query helper. Resolves the current `orgId` once and hands it to BOTH the
 * key factory and the fetcher, so a component structurally cannot issue a tenant query
 * without scoping it. Pairs with `qk.*` (src/lib/query-keys.ts).
 *
 * Example:
 *   const { data: pools = [] } = useOrgQuery(
 *     (orgId) => qk.talentpools.forCandidateAdd(orgId),
 *     (orgId) => unwrapList(
 *       supabase.from('talentpools').select('id, name, color').eq('organization_id', orgId).order('name'),
 *     ),
 *     { enabled: addOpen },
 *   );
 *
 * Authorization is still enforced by RLS; this only guarantees consistent client-side scoping.
 */
export function useOrgQuery<T>(
  keyFor: (orgId: string) => readonly unknown[],
  queryFn: (orgId: string) => Promise<T>,
  options?: Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, 'queryKey' | 'queryFn'>,
) {
  const orgId = useOrganizationId();
  return useQuery({
    queryKey: keyFor(orgId),
    queryFn: () => queryFn(orgId),
    ...options,
  });
}
