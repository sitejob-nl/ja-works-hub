import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useWhatsAppRealtime(orgId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!orgId) return;

    const channel = supabase
      .channel(`whatsapp-${orgId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'communications',
          filter: `organization_id=eq.${orgId}`,
        },
        (payload) => {
          const record = payload.new as any;
          if (record?.channel !== 'whatsapp') return;
          queryClient.invalidateQueries({ queryKey: ['whatsapp-conversations', orgId] });
          queryClient.invalidateQueries({ queryKey: ['whatsapp-messages', orgId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, queryClient]);
}
