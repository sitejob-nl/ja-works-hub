// src/components/whatsapp/ConversationItem.tsx
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { nl } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { User, Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Conversation } from '@/hooks/useWhatsAppConversations';

interface ConversationItemProps {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
}

export function ConversationItem({ conversation, isSelected, onClick }: ConversationItemProps) {
  const { candidateName, phone, lastMessage, lastMessageAt, lastDirection, unreadCount, whatsappStatus } = conversation;

  const timeLabel = formatConversationTime(lastMessageAt);
  const displayName = candidateName || phone;
  const hasUnread = unreadCount > 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-muted/50 transition-colors border-b',
        isSelected && 'bg-muted'
      )}
    >
      <div className="flex-shrink-0 h-10 w-10 rounded-full bg-muted flex items-center justify-center">
        <User className="h-5 w-5 text-muted-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={cn('text-sm truncate', hasUnread && 'font-semibold')}>
            {displayName}
          </span>
          <span className={cn('text-[10px] flex-shrink-0', hasUnread ? 'text-stat-blue font-semibold' : 'text-muted-foreground')}>
            {timeLabel}
          </span>
        </div>

        <div className="flex items-center justify-between mt-0.5">
          <div className="flex items-center gap-1 min-w-0">
            {lastDirection === 'outbound' && (
              <StatusMiniIcon status={whatsappStatus} />
            )}
            <span className={cn('text-xs truncate', hasUnread ? 'text-foreground' : 'text-muted-foreground')}>
              {lastMessage}
            </span>
          </div>
          {hasUnread && (
            <Badge variant="default" className="h-5 min-w-[20px] flex items-center justify-center text-[10px] px-1.5 ml-1 flex-shrink-0">
              {unreadCount}
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}

function StatusMiniIcon({ status }: { status: string | null }) {
  switch (status) {
    case 'read':
      return <CheckCheck className="h-3 w-3 text-blue-400 flex-shrink-0" />;
    case 'delivered':
      return <CheckCheck className="h-3 w-3 text-muted-foreground flex-shrink-0" />;
    case 'sent':
      return <Check className="h-3 w-3 text-muted-foreground flex-shrink-0" />;
    case 'failed':
      return <AlertCircle className="h-3 w-3 text-destructive flex-shrink-0" />;
    default:
      return <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" />;
  }
}

function formatConversationTime(dateStr: string): string {
  try {
    const date = parseISO(dateStr);
    if (isToday(date)) return format(date, 'HH:mm');
    if (isYesterday(date)) return 'Gisteren';
    return format(date, 'dd-MM', { locale: nl });
  } catch {
    return '';
  }
}
