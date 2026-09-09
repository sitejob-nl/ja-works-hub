import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { buildPublicUrl, type PublicDomain } from '@/lib/public-url';

/**
 * The verified primary domain of one organization. Split out from the context
 * variant so a component that already holds an organization id can use it
 * without `useOrganizationId`, which throws outside an AuthProvider.
 */
export function usePrimaryDomainForOrg(orgId: string | undefined) {
  return useQuery({
    queryKey: ['organization-primary-domain', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('organization_domains')
        .select('organization_id, domain, domain_type, primary_hostname, is_primary, status')
        .eq('organization_id', orgId)
        .eq('is_primary', true)
        .eq('status', 'verified')
        .is('removed_at', null)
        .maybeSingle();
      if (error) throw error;
      return data as PublicDomain | null;
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });
}

export function usePrimaryDomain() {
  return usePrimaryDomainForOrg(useOrganizationId());
}

export function usePublicUrlForOrg(orgId: string | undefined) {
  const primaryDomain = usePrimaryDomainForOrg(orgId);

  return useMemo(() => ({
    primaryDomain: primaryDomain.data ?? null,
    isLoading: primaryDomain.isLoading,
    buildUrl: (path: string) => buildPublicUrl(path, primaryDomain.data ?? null, window.location.origin),
  }), [primaryDomain.data, primaryDomain.isLoading]);
}

export function usePublicUrl() {
  return usePublicUrlForOrg(useOrganizationId());
}
