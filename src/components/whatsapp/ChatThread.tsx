// src/components/whatsapp/ChatThread.tsx
import { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';
import { ChatHeader } from './ChatHeader';
import { ChatInput } from './ChatInput';
import { MessageBubble } from './MessageBubble';
import { DateSeparator } from './DateSeparator';
import { ChatEmpty } from './ChatEmpty';
import type { WhatsAppMessage } from '@/hooks/useWhatsAppMessages';
import type { InteractivePayload } from './InteractiveMessageBuilder';

interface ChatThreadProps {
  phone: string | null;
  candidateName: string | null;
  candidateId: string | null;
  messages: WhatsAppMessage[];
  isLoading: boolean;
  isSending: boolean;
  showBackButton: boolean;
  onBack: () => void;
  onToggleContact: () => void;
  onSendText: (text: string) => void;
  onSendMedia: (file: File, type: string) => void;
  onOpenTemplates: () => void;
  onSendInteractive: (payload: InteractivePayload) => void;
}

export function ChatThread({
  phone,
  candidateName,
  candidateId,
  messages,
  isLoading,
  isSending,
  showBackButton,
  onBack,
  onToggleContact,
  onSendText,
  onSendMedia,
  onOpenTemplates,
  onSendInteractive,
}: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change or phone changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, phone]);

  if (!phone) {
    return (
      <div className="flex-1 flex flex-col min-w-0">
        <ChatEmpty />
      </div>
    );
  }

  // Group messages by date
  const groups: { date: string; msgs: WhatsAppMessage[] }[] = [];
  let currentDate = '';
  for (const msg of messages) {
    const dateStr = msg.sentAt.substring(0, 10);
    if (dateStr !== currentDate) {
      currentDate = dateStr;
      groups.push({ date: msg.sentAt, msgs: [] });
    }
    groups[groups.length - 1].msgs.push(msg);
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      <ChatHeader
        candidateName={candidateName}
        phone={phone}
        candidateId={candidateId}
        showBackButton={showBackButton}
        onBack={onBack}
        onToggleContact={onToggleContact}
      />

      <ScrollArea className="flex-1 px-4 py-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            Nog geen berichten. Stuur een bericht om het gesprek te starten.
          </div>
        ) : (
          <div className="space-y-0 max-w-3xl mx-auto">
            {groups.map((group, gi) => (
              <div key={gi}>
                <DateSeparator date={group.date} />
                {group.msgs.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>

      <ChatInput
        onSendText={onSendText}
        onSendMedia={onSendMedia}
        onOpenTemplates={onOpenTemplates}
        onSendInteractive={onSendInteractive}
        isSending={isSending}
      />
    </div>
  );
}
