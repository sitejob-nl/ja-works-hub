import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { nl } from 'date-fns/locale';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  Search, Send, Loader2, Check, CheckCheck, Clock,
  AlertCircle, User, MessageSquare, Phone, ArrowLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';

interface Conversation {
  phone: string;
  candidateId: string | null;
  candidateName: string | null;
  lastMessage: string;
  lastAt: string;
  lastDirection: string;
  lastStatus: string | null;
  unread: number;
}

const formatTime = (d: string) => {
  try {
    const date = parseISO(d);
    if (isToday(date)) return format(date, 'HH:mm');
    if (isYesterday(date)) return 'Gisteren';
    return format(date, 'dd MMM', { locale: nl });
  } catch { return ''; }
};

const formatFullTime = (d: string) => {
  try { return format(parseISO(d), 'HH:mm', { locale: nl }); }
  catch { return ''; }
};

const formatDateLabel = (d: string) => {
  try {
    const date = parseISO(d);
    if (isToday(date)) return 'Vandaag';
    if (isYesterday(date)) return 'Gisteren';
    return format(date, 'EEEE d MMMM yyyy', { locale: nl });
  } catch { return ''; }
};

const StatusIcon = ({ status }: { status: string | null }) => {
  switch (status) {
    case 'read': return <CheckCheck className="h-3.5 w-3.5 text-blue-500" />;
    case 'delivered': return <CheckCheck className="h-3.5 w-3.5 text-muted-foreground" />;
    case 'sent': return <Check className="h-3.5 w-3.5 text-muted-foreground" />;
    case 'failed': return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
    default: return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
};

// Extract phone from subject like "WhatsApp van 316xxx" or "WhatsApp naar 316xxx"
const extractPhone = (subject: string | null): string | null => {
  if (!subject) return null;
  const match = subject.match(/(van|naar)\s+(\+?\d[\d\s]+)/i);
  return match ? match[2].replace(/\s/g, '') : null;
};

const WhatsAppPage = () => {
  const organizationId = useOrganizationId();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch all WhatsApp communications
  const { data: allMessages, isLoading } = useQuery({
    queryKey: ['whatsapp-messages', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('communications')
        .select(`
          id, direction, body, subject, sent_at, whatsapp_message_id, whatsapp_status,
          candidate_id, candidates!communications_candidate_id_fkey(id, first_name, last_name, phone)
        `)
        .eq('organization_id', organizationId)
        .eq('channel', 'whatsapp')
        .order('sent_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 10000,
  });

  // Build conversations from messages
  const conversations: Conversation[] = (() => {
    if (!allMessages) return [];
    const map = new Map<string, Conversation>();

    for (const msg of allMessages) {
      // Determine phone key
      let phone = (msg as any).candidates?.phone || extractPhone(msg.subject);
      if (!phone) continue;
      phone = phone.replace(/[\s\-\+]/g, '');

      const existing = map.get(phone);
      const candidate = (msg as any).candidates;

      if (!existing || msg.sent_at > existing.lastAt) {
        map.set(phone, {
          phone,
          candidateId: candidate?.id || existing?.candidateId || null,
          candidateName: candidate ? `${candidate.first_name} ${candidate.last_name}` : existing?.candidateName || null,
          lastMessage: msg.body || '',
          lastAt: msg.sent_at,
          lastDirection: msg.direction,
          lastStatus: msg.whatsapp_status,
          unread: (existing?.unread || 0) + (msg.direction === 'inbound' ? 1 : 0),
        });
      } else {
        // Just update unread count
        if (msg.direction === 'inbound') {
          existing.unread++;
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  })();

  const filteredConversations = conversations.filter(c => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (c.candidateName?.toLowerCase().includes(s) || c.phone.includes(s));
  });

  // Messages for selected conversation
  const selectedMessages = allMessages?.filter(msg => {
    if (!selectedPhone) return false;
    const candidate = (msg as any).candidates;
    const phone = candidate?.phone?.replace(/[\s\-\+]/g, '') || extractPhone(msg.subject)?.replace(/[\s\-\+]/g, '');
    return phone === selectedPhone;
  }) || [];

  // Group messages by date
  const groupedMessages: { date: string; messages: typeof selectedMessages }[] = [];
  let currentDate = '';
  for (const msg of selectedMessages) {
    const dateStr = msg.sent_at.substring(0, 10);
    if (dateStr !== currentDate) {
      currentDate = dateStr;
      groupedMessages.push({ date: msg.sent_at, messages: [] });
    }
    groupedMessages[groupedMessages.length - 1].messages.push(msg);
  }

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedMessages.length, selectedPhone]);

  // Select first conversation if none selected
  useEffect(() => {
    if (!selectedPhone && conversations.length > 0) {
      setSelectedPhone(conversations[0].phone);
    }
  }, [conversations.length]);

  const selectedConversation = conversations.find(c => c.phone === selectedPhone);

  const handleSend = async () => {
    if (!message.trim() || !selectedPhone) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-send', {
        body: {
          to: selectedPhone,
          message: message.trim(),
          candidate_id: selectedConversation?.candidateId || undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['whatsapp-messages'] });
    } catch (err: any) {
      toast.error('Versturen mislukt: ' + (err.message || 'Onbekende fout'));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">WhatsApp</h1>
        <p className="text-muted-foreground text-sm">Gesprekken met kandidaten</p>
      </div>

      <div className="flex flex-1 min-h-0 border rounded-lg overflow-hidden bg-card">
        {/* Left: Conversation list */}
        <div className="w-80 border-r flex flex-col shrink-0">
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Zoek gesprek..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            {filteredConversations.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-40" />
                Geen gesprekken gevonden
              </div>
            ) : (
              filteredConversations.map(conv => (
                <button
                  key={conv.phone}
                  onClick={() => setSelectedPhone(conv.phone)}
                  className={cn(
                    'w-full text-left px-3 py-3 border-b border-border/50 hover:bg-muted/50 transition-colors',
                    selectedPhone === conv.phone && 'bg-muted'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                      <User className="h-5 w-5 text-green-700 dark:text-green-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-sm text-foreground truncate">
                          {conv.candidateName || conv.phone}
                        </p>
                        <span className="text-xs text-muted-foreground shrink-0 ml-2">
                          {formatTime(conv.lastAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        {conv.lastDirection === 'outbound' && (
                          <StatusIcon status={conv.lastStatus} />
                        )}
                        <p className="text-xs text-muted-foreground truncate">
                          {conv.lastMessage}
                        </p>
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </ScrollArea>
        </div>

        {/* Right: Chat thread */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedPhone ? (
            <>
              {/* Chat header */}
              <div className="h-14 border-b flex items-center justify-between px-4 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <User className="h-4 w-4 text-green-700 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="font-medium text-sm text-foreground">
                      {selectedConversation?.candidateName || selectedPhone}
                    </p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      +{selectedPhone}
                    </div>
                  </div>
                </div>
                {selectedConversation?.candidateId && (
                  <Link to={`/kandidaten/${selectedConversation.candidateId}`}>
                    <Badge variant="outline" className="text-xs cursor-pointer hover:bg-muted">
                      Profiel bekijken
                    </Badge>
                  </Link>
                )}
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-1 max-w-3xl mx-auto">
                  {groupedMessages.map((group, gi) => (
                    <div key={gi}>
                      <div className="flex justify-center my-4">
                        <span className="text-xs bg-muted text-muted-foreground px-3 py-1 rounded-full">
                          {formatDateLabel(group.date)}
                        </span>
                      </div>
                      {group.messages.map(msg => (
                        <div
                          key={msg.id}
                          className={cn(
                            'flex mb-1',
                            msg.direction === 'outbound' ? 'justify-end' : 'justify-start'
                          )}
                        >
                          <div
                            className={cn(
                              'max-w-[75%] rounded-lg px-3 py-2 text-sm',
                              msg.direction === 'outbound'
                                ? 'bg-green-600 text-white rounded-br-sm'
                                : 'bg-muted text-foreground rounded-bl-sm'
                            )}
                          >
                            <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                            <div className={cn(
                              'flex items-center gap-1 justify-end mt-1',
                              msg.direction === 'outbound' ? 'text-green-200' : 'text-muted-foreground'
                            )}>
                              <span className="text-[10px]">{formatFullTime(msg.sent_at)}</span>
                              {msg.direction === 'outbound' && (
                                <StatusIcon status={msg.whatsapp_status} />
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Input */}
              <div className="border-t p-3 shrink-0">
                <div className="flex items-center gap-2 max-w-3xl mx-auto">
                  <Input
                    placeholder="Typ een bericht..."
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={sending}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleSend}
                    disabled={!message.trim() || sending}
                    size="icon"
                    className="bg-green-600 hover:bg-green-700 shrink-0"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center space-y-2">
                <MessageSquare className="h-12 w-12 mx-auto opacity-30" />
                <p>Selecteer een gesprek</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WhatsAppPage;
