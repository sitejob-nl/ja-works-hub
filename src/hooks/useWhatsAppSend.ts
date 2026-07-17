import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface SendMessageParams {
  to: string;
  type: string;
  text?: { body: string; preview_url?: boolean };
  template?: { name: string; language: string; components?: any[] };
  image?: { link: string; caption?: string };
  video?: { link: string; caption?: string };
  audio?: { link: string };
  document?: { link: string; caption?: string; filename?: string };
  reaction?: { message_id: string; emoji: string };
  candidate_id?: string;
  context?: { message_id: string };
}

export function useWhatsAppSend(orgId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: SendMessageParams) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Niet ingelogd');

      const response = await supabase.functions.invoke('whatsapp-send', {
        body: params,
      });

      if (response.error) {
        // supabase.functions.invoke geeft bij een non-2xx een generieke melding; de echte
        // reden (bv. Meta 24-uurs venster / re-engagement 131047) staat in de response-body.
        let msg = response.error.message ?? 'Versturen mislukt';
        const ctx: any = (response.error as any).context;
        if (ctx && typeof ctx.clone === 'function') {
          try {
            const parsed = await ctx.clone().json();
            if (parsed?.error) msg = typeof parsed.error === 'string' ? parsed.error : (parsed.error.message ?? msg);
          } catch {
            // body niet leesbaar — generieke melding aanhouden
          }
        }
        throw new Error(msg);
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-conversations', orgId] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-messages', orgId] });
    },
    onError: (error: Error) => {
      toast.error(error.message ?? 'Bericht versturen mislukt');
    },
  });
}
