import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Conversation {
  phone: string;
  candidateId: string | null;
  candidateName: string | null;
  lastMessage: string;
  lastMessageAt: string;
  lastDirection: string;
  unreadCount: number;
  whatsappStatus: string | null;
}

export function useWhatsAppConversations(orgId: string) {
  return useQuery({
    queryKey: ['whatsapp-conversations', orgId],
    queryFn: async (): Promise<Conversation[]> => {
      // Get all WhatsApp communications grouped by phone
      const { data: messages, error } = await supabase
        .from('communications')
        .select(`
          id, subject, body, direction, sent_at, candidate_id,
          whatsapp_status, whatsapp_message_id, message_type,
          candidates!communications_candidate_id_fkey(id, first_name, last_name)
        `)
        .eq('organization_id', orgId)
        .eq('channel', 'whatsapp')
        .order('sent_at', { ascending: false });

      if (error) throw error;
      if (!messages?.length) return [];

      // Group by phone (extracted from subject)
      const convMap = new Map<string, Conversation>();

      for (const msg of messages) {
        const phone = extractPhone(msg.subject ?? '');
        if (!phone) continue;

        if (!convMap.has(phone)) {
          const candidate = msg.candidates as any;
          convMap.set(phone, {
            phone,
            candidateId: msg.candidate_id,
            candidateName: candidate
              ? `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim()
              : null,
            lastMessage: msg.body ?? '',
            lastMessageAt: msg.sent_at,
            lastDirection: msg.direction,
            unreadCount: 0,
            whatsappStatus: msg.whatsapp_status,
          });
        }

        const conv = convMap.get(phone)!;
        if (msg.direction === 'inbound' && !msg.whatsapp_status?.includes('read')) {
          conv.unreadCount++;
        }
      }

      return Array.from(convMap.values()).sort(
        (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
      );
    },
    enabled: !!orgId,
  });
}

function extractPhone(subject: string): string | null {
  // "WhatsApp van/naar +316xxxxxxxx" or "WhatsApp van Name (phone)"
  const match = subject.match(/[\+]?\d[\d\s\-]{8,}/);
  if (!match) return null;
  return match[0].replace(/[\s\-]/g, '');
}
