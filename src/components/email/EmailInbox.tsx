import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMicrosoftApi } from '@/hooks/useMicrosoftApi';
import { useMicrosoftConfig } from '@/hooks/useMicrosoftConfig';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Mail, MailOpen, Search, RefreshCw, Loader2, Paperclip, ChevronLeft, ChevronRight,
  Reply, ReplyAll, Forward, Trash2, Archive, MailPlus, Inbox, Send as SendIcon, FileText, Star, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import EmailCompose from './EmailCompose';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { nl } from 'date-fns/locale';

interface EmailMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  body?: { content: string; contentType: string };
  from?: { emailAddress: { name: string; address: string } };
  toRecipients?: { emailAddress: { name: string; address: string } }[];
  ccRecipients?: { emailAddress: { name: string; address: string } }[];
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  importance: string;
  flag?: { flagStatus: string };
}

type FolderKey = 'inbox' | 'sentitems' | 'drafts' | 'deleteditems' | 'archive';

const folders: { key: FolderKey; label: string; icon: any }[] = [
  { key: 'inbox', label: 'Postvak IN', icon: Inbox },
  { key: 'sentitems', label: 'Verzonden', icon: SendIcon },
  { key: 'drafts', label: 'Concepten', icon: FileText },
  { key: 'archive', label: 'Archief', icon: Archive },
  { key: 'deleteditems', label: 'Verwijderd', icon: Trash2 },
];

function formatEmailDate(dateStr: string) {
  const date = parseISO(dateStr);
  if (isToday(date)) return format(date, 'HH:mm');
  if (isYesterday(date)) return 'Gisteren';
  return format(date, 'd MMM', { locale: nl });
}

function senderName(msg: EmailMessage) {
  return msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || 'Onbekend';
}

const EmailInbox = () => {
  const { callApi } = useMicrosoftApi();
  const { isConnected } = useMicrosoftConfig();
  const [activeFolder, setActiveFolder] = useState<FolderKey>('inbox');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyData, setReplyData] = useState<any>(null);
  const [page, setPage] = useState(0);
  const pageSize = 25;

  // Fetch messages
  const { data: messagesData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['microsoft-emails', activeFolder, searchQuery, page],
    queryFn: async () => {
      if (searchQuery) {
        return callApi({
          endpoint: `me/messages?$search="${searchQuery}"&$top=${pageSize}&$skip=${page * pageSize}&$select=id,subject,bodyPreview,from,toRecipients,receivedDateTime,isRead,hasAttachments,importance,flag&$orderby=receivedDateTime desc`,
        });
      }
      return callApi({
        endpoint: `me/mailFolders/${activeFolder}/messages?$top=${pageSize}&$skip=${page * pageSize}&$select=id,subject,bodyPreview,from,toRecipients,receivedDateTime,isRead,hasAttachments,importance,flag&$orderby=receivedDateTime desc`,
      });
    },
    enabled: isConnected,
    refetchInterval: 30_000,
  });

  const messages: EmailMessage[] = messagesData?.value || [];
  const hasNextPage = !!messagesData?.['@odata.nextLink'];

  // Fetch selected message detail
  const { data: selectedMessage, isLoading: loadingDetail } = useQuery({
    queryKey: ['microsoft-email-detail', selectedId],
    queryFn: () => callApi({
      endpoint: `me/messages/${selectedId}?$select=id,subject,body,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,importance,attachments`,
    }),
    enabled: !!selectedId && isConnected,
  });

  // Mark as read
  const markAsRead = async (msgId: string) => {
    try {
      await callApi({ endpoint: `me/messages/${msgId}`, method: 'PATCH', payload: { isRead: true } });
    } catch { /* silent */ }
  };

  const handleSelectMessage = (msg: EmailMessage) => {
    setSelectedId(msg.id);
    if (!msg.isRead) markAsRead(msg.id);
  };

  const handleReply = (mode: 'reply' | 'replyAll' | 'forward') => {
    if (!selectedMessage) return;
    setReplyData({
      messageId: selectedMessage.id,
      subject: selectedMessage.subject,
      from: selectedMessage.from?.emailAddress?.address,
      toAll: selectedMessage.toRecipients?.map((r: any) => r.emailAddress.address),
      body: selectedMessage.body?.content,
      mode,
    });
    setComposeOpen(true);
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    try {
      await callApi({ endpoint: `me/messages/${selectedId}`, method: 'DELETE' });
      setSelectedId(null);
      refetch();
    } catch { /* silent */ }
  };

  const handleArchive = async () => {
    if (!selectedId) return;
    try {
      await callApi({ endpoint: `me/messages/${selectedId}/move`, method: 'POST', payload: { destinationId: 'archive' } });
      setSelectedId(null);
      refetch();
    } catch { /* silent */ }
  };

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-muted-foreground">
        <AlertCircle className="h-12 w-12" />
        <p className="text-lg">Microsoft 365 is nog niet gekoppeld</p>
        <p className="text-sm">Ga naar Instellingen om je Microsoft account te koppelen</p>
        <Button variant="outline" onClick={() => window.location.href = '/instellingen'}>
          Naar Instellingen
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] border rounded-lg overflow-hidden bg-background">
      {/* Folders sidebar */}
      <div className="w-48 border-r bg-muted/30 flex-shrink-0 hidden md:flex flex-col">
        <div className="p-2">
          <Button onClick={() => { setReplyData(null); setComposeOpen(true); }} className="w-full gap-2" size="sm">
            <MailPlus className="h-4 w-4" /> Nieuw bericht
          </Button>
        </div>
        <nav className="flex-1 px-2 space-y-0.5">
          {folders.map(f => (
            <button
              key={f.key}
              onClick={() => { setActiveFolder(f.key); setSelectedId(null); setPage(0); }}
              className={cn(
                'flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-sm transition-colors',
                activeFolder === f.key ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted'
              )}
            >
              <f.icon className="h-4 w-4" />
              {f.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Message list */}
      <div className={cn('flex flex-col border-r', selectedId ? 'hidden md:flex w-80' : 'flex-1 md:w-80')}>
        <div className="p-2 border-b flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setPage(0); }}
              placeholder="Zoeken..."
              className="pl-9 h-9"
            />
          </div>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          </Button>
          {/* Mobile: compose button */}
          <Button variant="ghost" size="icon" className="h-9 w-9 md:hidden" onClick={() => { setReplyData(null); setComposeOpen(true); }}>
            <MailPlus className="h-4 w-4" />
          </Button>
        </div>

        {/* Mobile: folder selector */}
        <div className="md:hidden flex gap-1 p-2 border-b overflow-x-auto">
          {folders.map(f => (
            <Button
              key={f.key}
              variant={activeFolder === f.key ? 'default' : 'ghost'}
              size="sm"
              className="text-xs shrink-0"
              onClick={() => { setActiveFolder(f.key); setSelectedId(null); setPage(0); }}
            >
              {f.label}
            </Button>
          ))}
        </div>

        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="p-3 space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
              Geen berichten
            </div>
          ) : (
            <div>
              {messages.map(msg => (
                <button
                  key={msg.id}
                  onClick={() => handleSelectMessage(msg)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 border-b hover:bg-muted/50 transition-colors',
                    selectedId === msg.id && 'bg-primary/5',
                    !msg.isRead && 'bg-blue-50/50 dark:bg-blue-950/20'
                  )}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn('text-sm truncate flex-1', !msg.isRead && 'font-semibold')}>
                      {senderName(msg)}
                    </span>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {formatEmailDate(msg.receivedDateTime)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {!msg.isRead && <div className="h-2 w-2 rounded-full bg-primary shrink-0" />}
                    <p className={cn('text-sm truncate', !msg.isRead ? 'font-medium' : 'text-muted-foreground')}>
                      {msg.subject || '(Geen onderwerp)'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <p className="text-xs text-muted-foreground truncate flex-1">{msg.bodyPreview}</p>
                    {msg.hasAttachments && <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />}
                    {msg.importance === 'high' && <Star className="h-3 w-3 text-orange-500 shrink-0" />}
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Pagination */}
        {messages.length > 0 && (
          <div className="border-t px-3 py-2 flex items-center justify-between">
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Vorige
            </Button>
            <span className="text-xs text-muted-foreground">Pagina {page + 1}</span>
            <Button variant="ghost" size="sm" disabled={messages.length < pageSize && !hasNextPage} onClick={() => setPage(p => p + 1)}>
              Volgende <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </div>

      {/* Message detail */}
      <div className={cn('flex-1 flex flex-col', !selectedId && 'hidden md:flex')}>
        {!selectedId ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MailOpen className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Selecteer een bericht</p>
            </div>
          </div>
        ) : loadingDetail ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : selectedMessage ? (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-1 px-3 py-2 border-b">
              <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={() => setSelectedId(null)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="gap-1" onClick={() => handleReply('reply')}>
                <Reply className="h-4 w-4" /> Beantwoorden
              </Button>
              <Button variant="ghost" size="sm" className="gap-1" onClick={() => handleReply('replyAll')}>
                <ReplyAll className="h-4 w-4" /> Allen
              </Button>
              <Button variant="ghost" size="sm" className="gap-1" onClick={() => handleReply('forward')}>
                <Forward className="h-4 w-4" /> Doorsturen
              </Button>
              <div className="flex-1" />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleArchive}>
                <Archive className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={handleDelete}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {/* Header */}
            <div className="px-4 py-3 border-b space-y-2">
              <h2 className="text-lg font-semibold">{selectedMessage.subject || '(Geen onderwerp)'}</h2>
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-sm font-medium text-primary">
                    {(selectedMessage.from?.emailAddress?.name || '?').charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {selectedMessage.from?.emailAddress?.name}
                    <span className="text-muted-foreground font-normal ml-2 text-xs">
                      &lt;{selectedMessage.from?.emailAddress?.address}&gt;
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Aan: {selectedMessage.toRecipients?.map((r: any) => r.emailAddress.name || r.emailAddress.address).join(', ')}
                  </p>
                  {selectedMessage.ccRecipients?.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      CC: {selectedMessage.ccRecipients.map((r: any) => r.emailAddress.name || r.emailAddress.address).join(', ')}
                    </p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {selectedMessage.receivedDateTime && format(parseISO(selectedMessage.receivedDateTime), 'd MMM yyyy HH:mm', { locale: nl })}
                </span>
              </div>

              {/* Attachments */}
              {selectedMessage.attachments?.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {selectedMessage.attachments
                    .filter((a: any) => !a.isInline)
                    .map((att: any) => (
                      <Badge key={att.id} variant="secondary" className="gap-1 text-xs">
                        <Paperclip className="h-3 w-3" /> {att.name}
                        {att.size && <span className="text-muted-foreground">({Math.round(att.size / 1024)}KB)</span>}
                      </Badge>
                    ))}
                </div>
              )}
            </div>

            {/* Body */}
            <ScrollArea className="flex-1 px-4 py-3">
              {selectedMessage.body?.contentType === 'html' ? (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{ __html: selectedMessage.body.content }}
                />
              ) : (
                <pre className="text-sm whitespace-pre-wrap font-sans">{selectedMessage.body?.content}</pre>
              )}
            </ScrollArea>
          </>
        ) : null}
      </div>

      {/* Compose dialog */}
      <EmailCompose
        open={composeOpen}
        onOpenChange={setComposeOpen}
        replyTo={replyData}
      />
    </div>
  );
};

export default EmailInbox;
