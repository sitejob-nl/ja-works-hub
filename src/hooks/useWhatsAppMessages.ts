import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface WhatsAppMessage {
  id: string;
  body: string | null;
  direction: string;
  sentAt: string;
  sentBy: string | null;
  whatsappMessageId: string | null;
  whatsappStatus: string | null;
  messageType: string | null;
  mediaId: string | null;
  candidateId: string | null;
}

export function useWhatsAppMessages(orgId: string, phone: string | null) {
  return useQuery({
    queryKey: ['whatsapp-messages', orgId, phone],
    queryFn: async (): Promise<WhatsAppMessage[]> => {
      if (!phone) return [];

      // Build phone variants for matching
      const cleanPhone = phone.replace(/[\s+.-]/g, '');
      const phoneVariants = [
        phone,
        `+${cleanPhone}`,
        cleanPhone,
        `0${cleanPhone.substring(2)}`, // +316... → 06...
      ];

      // Match messages by phone in subject
      const { data, error } = await supabase
        .from('communications')
        .select('*')
        .eq('organization_id', orgId)
        .eq('channel', 'whatsapp')
        .or(phoneVariants.map((p) => `subject.ilike.%${p}%`).join(','))
        .order('sent_at', { ascending: true })
        .limit(200);

      if (error) throw error;

      return (data ?? []).map((msg) => ({
        id: msg.id,
        body: msg.body,
        direction: msg.direction,
        sentAt: msg.sent_at,
        sentBy: msg.sent_by,
        whatsappMessageId: msg.whatsapp_message_id,
        whatsappStatus: msg.whatsapp_status,
        messageType: (msg as any).message_type ?? 'text',
        mediaId: (msg as any).media_id ?? null,
        candidateId: msg.candidate_id,
      }));
    },
    enabled: !!orgId && !!phone,
  });
}
