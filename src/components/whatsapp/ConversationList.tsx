// src/components/whatsapp/ConversationList.tsx
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Plus, Loader2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConversationItem } from './ConversationItem';
import type { Conversation } from '@/hooks/useWhatsAppConversations';

interface ConversationListProps {
  conversations: Conversation[];
  isLoading: boolean;
  selectedPhone: string | null;
  onSelect: (phone: string, candidateId: string | null) => void;
  onNewChat: () => void;
}

export function ConversationList({
  conversations,
  isLoading,
  selectedPhone,
  onSelect,
  onNewChat,
}: ConversationListProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'known' | 'unknown'>('all');

  const filtered = conversations.filter((conv) => {
    // Search filter
    if (search) {
      const q = search.toLowerCase();
      const matchName = conv.candidateName?.toLowerCase().includes(q);
      const matchPhone = conv.phone.includes(search.replace(/[\s\-]/g, ''));
      if (!matchName && !matchPhone) return false;
    }

    // Tab filter
    switch (filter) {
      case 'unread':
        return conv.unreadCount > 0;
      case 'known':
        return !!conv.candidateId;
      case 'unknown':
        return !conv.candidateId;
      default:
        return true;
    }
  });

  return (
    <div className="flex flex-col h-full border-r">
      {/* Header */}
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Zoeken..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <Button size="icon" variant="outline" className="h-9 w-9" onClick={onNewChat}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
          <TabsList className="w-full h-8">
            <TabsTrigger value="all" className="text-xs flex-1">Alle</TabsTrigger>
            <TabsTrigger value="unread" className="text-xs flex-1">Ongelezen</TabsTrigger>
            <TabsTrigger value="known" className="text-xs flex-1">Kandidaten</TabsTrigger>
            <TabsTrigger value="unknown" className="text-xs flex-1">Onbekend</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Conversation list */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            {search ? 'Geen resultaten' : 'Geen gesprekken'}
          </div>
        ) : (
          filtered.map((conv) => (
            <ConversationItem
              key={conv.phone}
              conversation={conv}
              isSelected={selectedPhone === conv.phone}
              onClick={() => onSelect(conv.phone, conv.candidateId)}
            />
          ))
        )}
      </ScrollArea>
    </div>
  );
}
