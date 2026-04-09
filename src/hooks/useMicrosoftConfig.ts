import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';

export function useMicrosoftConfig() {
  const orgId = useOrganizationId();

  const { data: config, isLoading } = useQuery({
    queryKey: ['microsoft-config', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('microsoft_config' as any)
        .select('*')
        .eq('organization_id', orgId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  return {
    config,
    isConnected: !!(config?.is_active && config?.microsoft_email),
    microsoftEmail: config?.microsoft_email || null,
    isLoading,
  };
}
