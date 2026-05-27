import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { buildPublicUrl, type PublicDomain } from '@/lib/public-url';

export function usePrimaryDomain() {
  const orgId = useOrganizationId();

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

export function usePublicUrl() {
  const primaryDomain = usePrimaryDomain();

  return useMemo(() => ({
    primaryDomain: primaryDomain.data ?? null,
    isLoading: primaryDomain.isLoading,
    buildUrl: (path: string) => buildPublicUrl(path, primaryDomain.data ?? null, window.location.origin),
  }), [primaryDomain.data, primaryDomain.isLoading]);
}
