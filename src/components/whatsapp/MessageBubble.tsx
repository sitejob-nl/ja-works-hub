// src/components/whatsapp/MessageBubble.tsx
import { format, parseISO } from 'date-fns';
import { Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MediaMessage } from './MediaMessage';
import type { WhatsAppMessage } from '@/hooks/useWhatsAppMessages';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface MessageBubbleProps {
  message: WhatsAppMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound';
  const isMedia = message.messageType && message.messageType !== 'text' && message.messageType !== 'reaction';
  const isFailed = message.whatsappStatus === 'failed';
  const time = format(parseISO(message.sentAt), 'HH:mm');

  return (
    <div className={cn('flex mb-1', isOutbound ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-lg px-3 py-2 shadow-sm',
          isOutbound
            ? isFailed
              ? 'bg-destructive/10 border border-destructive/30'
              : 'bg-primary text-primary-foreground'
            : 'bg-card border'
        )}
      >
        {isMedia ? (
          <MediaMessage
            type={message.messageType!}
            body={message.body ?? ''}
            mediaId={message.mediaId}
          />
        ) : (
          <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p>
        )}

        <div
          className={cn(
            'flex items-center justify-end gap-1 mt-1',
            isOutbound ? 'text-primary-foreground/70' : 'text-muted-foreground'
          )}
        >
          <span className="text-[10px]">{time}</span>
          {isOutbound && <StatusIcon status={message.whatsappStatus} />}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string | null }) {
  switch (status) {
    case 'read':
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger><CheckCheck className="h-3 w-3 text-blue-400" /></TooltipTrigger>
            <TooltipContent>Gelezen</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case 'delivered':
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger><CheckCheck className="h-3 w-3" /></TooltipTrigger>
            <TooltipContent>Afgeleverd</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case 'sent':
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger><Check className="h-3 w-3" /></TooltipTrigger>
            <TooltipContent>Verstuurd</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case 'failed':
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger><AlertCircle className="h-3 w-3 text-destructive" /></TooltipTrigger>
            <TooltipContent>Mislukt</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    default:
      return <Clock className="h-3 w-3" />;
  }
}
