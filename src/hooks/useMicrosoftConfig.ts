import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useMicrosoftConfig() {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

  const { data: config, isLoading } = useQuery({
    queryKey: ['microsoft-config', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('microsoft_config' as any)
        .select('*')
        .eq('organization_id', orgId!)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: !!orgId,
  });

  return {
    config,
    isConnected: !!(config?.is_active && config?.microsoft_email),
    microsoftEmail: config?.microsoft_email || null,
    isLoading,
  };
}
