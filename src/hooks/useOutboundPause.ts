import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type OutboundPauseState = {
  email: boolean;
  whatsapp: boolean;
};

export const normalizeOutboundPause = (flag: unknown): OutboundPauseState => {
  if (flag === true) return { email: true, whatsapp: true };
  if (!flag || typeof flag !== 'object') return { email: false, whatsapp: false };
  return {
    email: Boolean((flag as any).email),
    whatsapp: Boolean((flag as any).whatsapp),
  };
};

export const useOutboundPause = (orgId?: string | null) =>
  useQuery({
    queryKey: ['outbound-paused', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('settings')
        .eq('id', orgId)
        .maybeSingle();
      if (error) throw error;
      return normalizeOutboundPause((data?.settings as any)?.outbound_paused);
    },
    enabled: !!orgId,
  });
