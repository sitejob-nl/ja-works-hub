import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOutlookAccounts, useOutlookInvoke } from '@/hooks/useOutlookAccounts';
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
import { sanitizeHtml } from '@/lib/sanitize-html';
import { toast } from 'sonner';

interface EmailMessage {
  id: string;
  subject: string;
  preview: string;
  body_html?: string;
  body_type?: string;
  from?: { name: string | null; address: string | null };
  to?: { name: string | null; address: string | null }[];
  cc?: { name: string | null; address: string | null }[];
  received_at: string | null;
  sent_at?: string | null;
  is_read: boolean;
  has_attachments: boolean;
  importance: string;
  attachments?: { id: string; name: string; size: number; is_inline: boolean }[];
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
  return msg.from?.name || msg.from?.address || 'Onbekend';
}

const EmailInbox = ({ selectedAccount }: { selectedAccount?: string }) => {
  const callOutlook = useOutlookInvoke();
  const { accounts } = useOutlookAccounts('mail_read');
  const activeAccount = accounts.find((account) => account.account_id === selectedAccount);
  const canRead = Boolean(
    selectedAccount &&
      activeAccount?.microsoft_access_ok &&
      activeAccount?.capabilities.mail_read &&
      activeAccount?.ja_grants.mail_read,
  );
  const canSend = Boolean(
    selectedAccount &&
      activeAccount?.microsoft_access_ok &&
      activeAccount?.capabilities.mail_send &&
      activeAccount?.ja_grants.mail_send,
  );
  const canDelete = Boolean(
    selectedAccount &&
      activeAccount?.microsoft_access_ok &&
      activeAccount?.capabilities.mail_delete &&
      activeAccount?.ja_grants.mail_delete,
  );
  const [activeFolder, setActiveFolder] = useState<FolderKey>('inbox');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyData, setReplyData] = useState<any>(null);
  const [page, setPage] = useState(0);
  const pageSize = 25;

  useEffect(() => {
    setSelectedId(null);
    setPage(0);
  }, [selectedAccount]);

  // Fetch messages
  const { data: messagesData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['outlook-emails', activeFolder, searchQuery, page, selectedAccount],
    queryFn: async () => {
      return callOutlook<{ messages: EmailMessage[]; next_link: string | null }>('outlook-mail', {
        action: 'list',
        account_id: selectedAccount,
        folder_id: activeFolder,
        search: searchQuery || undefined,
        top: pageSize,
        skip: page * pageSize,
      });
    },
    enabled: canRead,
    refetchInterval: 30_000,
  });

  const messages: EmailMessage[] = messagesData?.messages || [];
  const hasNextPage = !!messagesData?.next_link;

  // Fetch selected message detail
  const { data: selectedMessage, isLoading: loadingDetail } = useQuery({
    queryKey: ['outlook-email-detail', selectedId, selectedAccount],
    queryFn: async () => {
      const data = await callOutlook<{ message: EmailMessage }>('outlook-mail', {
        action: 'detail',
        account_id: selectedAccount,
        message_id: selectedId,
      });
      return data.message;
    },
    enabled: !!selectedId && canRead,
  });

  // Mark as read
  const markAsRead = async (msgId: string) => {
    try {
      await callOutlook('outlook-mail', { action: 'mark_read', account_id: selectedAccount, message_id: msgId });
    } catch { /* silent */ }
  };

  const handleSelectMessage = (msg: EmailMessage) => {
    setSelectedId(msg.id);
    if (!msg.is_read) markAsRead(msg.id);
  };

  const handleReply = (mode: 'reply' | 'replyAll' | 'forward') => {
    if (!selectedMessage) return;
    if (!canSend) {
      toast.error('Je hebt geen verzendrecht voor deze mailbox');
      return;
    }
    setReplyData({
      messageId: selectedMessage.id,
      subject: selectedMessage.subject,
      from: selectedMessage.from?.address,
      toAll: selectedMessage.to?.map((r: any) => r.address),
      body: selectedMessage.body_html,
      mode,
    });
    setComposeOpen(true);
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (!canDelete) {
      toast.error('Je hebt geen verwijderrecht voor deze mailbox');
      return;
    }
    try {
      await callOutlook('outlook-mail', { action: 'delete', account_id: selectedAccount, message_id: selectedId });
      setSelectedId(null);
      refetch();
    } catch { /* silent */ }
  };

  const handleArchive = async () => {
    if (!selectedId) return;
    if (!canDelete) {
      toast.error('Je hebt geen verwijderrecht voor deze mailbox');
      return;
    }
    try {
      await callOutlook('outlook-mail', { action: 'move', account_id: selectedAccount, message_id: selectedId, destination_id: 'archive' });
      setSelectedId(null);
      refetch();
    } catch { /* silent */ }
  };

  if (!canRead) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-muted-foreground">
        <AlertCircle className="h-12 w-12" />
        <p className="text-lg">Geen leesbare Outlook mailbox geselecteerd</p>
        <p className="text-sm">{activeAccount?.status_reason || 'Ga naar Instellingen om Outlook accounts en rechten te beheren'}</p>
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
          <Button
            onClick={() => { setReplyData(null); setComposeOpen(true); }}
            className="w-full gap-2"
            size="sm"
            disabled={!canSend}
            title={canSend ? 'Nieuw bericht' : 'Geen verzendrecht voor deze mailbox'}
          >
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
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 md:hidden"
            onClick={() => { setReplyData(null); setComposeOpen(true); }}
            disabled={!canSend}
            title={canSend ? 'Nieuw bericht' : 'Geen verzendrecht voor deze mailbox'}
          >
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
                    !msg.is_read && 'bg-blue-50/50 dark:bg-blue-950/20'
                  )}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn('text-sm truncate flex-1', !msg.is_read && 'font-semibold')}>
                      {senderName(msg)}
                    </span>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {msg.received_at ? formatEmailDate(msg.received_at) : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {!msg.is_read && <div className="h-2 w-2 rounded-full bg-primary shrink-0" />}
                    <p className={cn('text-sm truncate', !msg.is_read ? 'font-medium' : 'text-muted-foreground')}>
                      {msg.subject || '(Geen onderwerp)'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <p className="text-xs text-muted-foreground truncate flex-1">{msg.preview}</p>
                    {msg.has_attachments && <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />}
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
              <Button variant="ghost" size="sm" className="gap-1" onClick={() => handleReply('reply')} disabled={!canSend}>
                <Reply className="h-4 w-4" /> Beantwoorden
              </Button>
              <Button variant="ghost" size="sm" className="gap-1" onClick={() => handleReply('replyAll')} disabled={!canSend}>
                <ReplyAll className="h-4 w-4" /> Allen
              </Button>
              <Button variant="ghost" size="sm" className="gap-1" onClick={() => handleReply('forward')} disabled={!canSend}>
                <Forward className="h-4 w-4" /> Doorsturen
              </Button>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleArchive}
                disabled={!canDelete}
                title={canDelete ? 'Archiveren' : 'Geen verwijderrecht voor deze mailbox'}
              >
                <Archive className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={handleDelete}
                disabled={!canDelete}
                title={canDelete ? 'Verwijderen' : 'Geen verwijderrecht voor deze mailbox'}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {/* Header */}
            <div className="px-4 py-3 border-b space-y-2">
              <h2 className="text-lg font-semibold">{selectedMessage.subject || '(Geen onderwerp)'}</h2>
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-sm font-medium text-primary">
                    {(selectedMessage.from?.name || '?').charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {selectedMessage.from?.name}
                    <span className="text-muted-foreground font-normal ml-2 text-xs">
                      &lt;{selectedMessage.from?.address}&gt;
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Aan: {selectedMessage.to?.map((r: any) => r.name || r.address).join(', ')}
                  </p>
                  {(selectedMessage.cc?.length || 0) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      CC: {selectedMessage.cc?.map((r: any) => r.name || r.address).join(', ')}
                    </p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {selectedMessage.received_at && format(parseISO(selectedMessage.received_at), 'd MMM yyyy HH:mm', { locale: nl })}
                </span>
              </div>

              {/* Attachments */}
              {(selectedMessage.attachments?.length || 0) > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {selectedMessage.attachments
                    .filter((a: any) => !a.is_inline)
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
              {selectedMessage.body_type === 'html' ? (
                <div
                  className="prose prose-sm dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(selectedMessage.body_html || '') }}
                />
              ) : (
                <pre className="text-sm whitespace-pre-wrap font-sans">{selectedMessage.body_html}</pre>
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
        selectedAccount={selectedAccount}
      />
    </div>
  );
};

export default EmailInbox;
