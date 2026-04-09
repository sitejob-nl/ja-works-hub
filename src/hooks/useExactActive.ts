import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from './useOrganizationId';

/** Returns true if the organization has an active Exact Online connection */
export function useExactActive() {
  const orgId = useOrganizationId();

  const { data } = useQuery({
    queryKey: ['exact-config-active', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('exact_config')
        .select('is_active')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .maybeSingle();
      return !!data;
    },
    staleTime: 60_000,
  });

  return data ?? false;
}
