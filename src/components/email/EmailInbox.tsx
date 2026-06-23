import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutlookAccounts, useOutlookInvoke } from '@/hooks/useOutlookAccounts';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Mail, MailOpen, Search, RefreshCw, Loader2, Paperclip, ChevronLeft, ChevronRight,
  Reply, ReplyAll, Forward, Trash2, Archive, MailPlus, Inbox, Send as SendIcon, FileText, Star, AlertCircle,
  Brain, ClipboardList,
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
type TriageLabel = 'CV' | 'Klantvraag' | 'Partner' | 'Ruis' | 'Review';

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

function plainText(value?: string) {
  return (value ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyEmailMessage(msg: EmailMessage) {
  const attachmentNames = (msg.attachments ?? [])
    .filter((attachment) => !attachment.is_inline)
    .map((attachment) => attachment.name)
    .join(' ');
  const content = [
    msg.subject,
    msg.preview,
    plainText(msg.body_html),
    attachmentNames,
    msg.from?.address,
  ].join(' ').toLowerCase();

  const has = (pattern: RegExp) => pattern.test(content);
  let label: TriageLabel = 'Review';
  let priority: 'high' | 'medium' | 'low' = 'medium';
  let category = 'email triage';
  let reasoning = 'Geen harde match gevonden; recruiterreview nodig.';

  if (has(/\b(cv|resume|curriculum|sollicitatie|solliciteren|application|motivatiebrief)\b/i)) {
    label = 'CV';
    priority = 'high';
    category = 'cv intake';
    reasoning = 'Bericht bevat CV/sollicitatie-signalen of relevante bijlage.';
  } else if (has(/\b(vacature|opdracht|aanvraag|planning|tarief|uren|factuur|plaatsing|kandidaat nodig)\b/i)) {
    label = 'Klantvraag';
    priority = 'high';
    category = 'klantvraag';
    reasoning = 'Bericht lijkt een klantvraag over vacature, planning, tarief, uren of factuur.';
  } else if (has(/\b(bureau|agency|partner|leverancier|recruiter|samenwerking)\b/i)) {
    label = 'Partner';
    priority = 'medium';
    category = 'partner';
    reasoning = 'Bericht lijkt afkomstig van of bedoeld voor een externe partner.';
  } else if (has(/\b(unsubscribe|uitschrijven|nieuwsbrief|noreply|no-reply|marketing|webinar|advertentie)\b/i)) {
    label = 'Ruis';
    priority = 'low';
    category = 'ruis';
    reasoning = 'Bericht bevat nieuwsbrief-, marketing- of no-reply-signalen.';
  }

  return { label, priority, category, reasoning };
}

const triageBadgeClass: Record<TriageLabel, string> = {
  CV: 'bg-stat-green/10 text-stat-green border-0',
  Klantvraag: 'bg-orange-100 text-orange-700 border-0',
  Partner: 'bg-blue-100 text-blue-700 border-0',
  Ruis: 'bg-muted text-muted-foreground border-0',
  Review: 'bg-yellow-100 text-yellow-700 border-0',
};

const EmailInbox = ({ selectedAccount }: { selectedAccount?: string }) => {
  const callOutlook = useOutlookInvoke();
  const organizationId = useOrganizationId();
  const { user } = useAuth();
  const queryClient = useQueryClient();
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
  const triage = selectedMessage ? classifyEmailMessage(selectedMessage) : null;

  const triageMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMessage || !triage) throw new Error('Geen bericht geselecteerd');
      const sender = selectedMessage.from?.address?.trim().toLowerCase() ?? '';
      const previewText = plainText(selectedMessage.preview || selectedMessage.body_html).slice(0, 1200);
      let candidateId: string | null = null;
      let companyId: string | null = null;
      let companyContactId: string | null = null;

      if (sender) {
        const { data: candidate } = await supabase
          .from('candidates')
          .select('id')
          .eq('organization_id', organizationId)
          .eq('email', sender)
          .limit(1)
          .maybeSingle();
        candidateId = candidate?.id ?? null;

        if (!candidateId) {
          const { data: contact } = await supabase
            .from('company_contacts')
            .select('id, company_id')
            .eq('organization_id', organizationId)
            .eq('email', sender)
            .limit(1)
            .maybeSingle();
          companyContactId = contact?.id ?? null;
          companyId = contact?.company_id ?? null;
        }

        if (!candidateId && !companyId) {
          const { data: company } = await supabase
            .from('companies')
            .select('id')
            .eq('organization_id', organizationId)
            .or(`email.eq.${sender},invoice_email.eq.${sender}`)
            .limit(1)
            .maybeSingle();
          companyId = company?.id ?? null;
        }
      }

      const { data: existingCommunication } = await supabase
        .from('communications')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('email_message_id', selectedMessage.id)
        .maybeSingle();

      if (!existingCommunication) {
        const { error: communicationError } = await supabase.from('communications').insert({
          organization_id: organizationId,
          candidate_id: candidateId,
          company_id: companyId,
          company_contact_id: companyContactId,
          channel: 'email',
          direction: 'inbound',
          subject: selectedMessage.subject || '(Geen onderwerp)',
          body: previewText || null,
          email_from: sender || null,
          email_to: selectedMessage.to?.map((recipient) => recipient.address).filter(Boolean) ?? null,
          email_cc: selectedMessage.cc?.map((recipient) => recipient.address).filter(Boolean) ?? null,
          email_message_id: selectedMessage.id,
          email_attachments: selectedMessage.attachments?.map((attachment) => ({
            name: attachment.name,
            size: attachment.size,
            is_inline: attachment.is_inline,
          })) ?? null,
          sent_at: selectedMessage.received_at ?? new Date().toISOString(),
          sent_by: user?.id ?? null,
          message_type: `ai_triage_${triage.label.toLowerCase()}`,
        } as any);
        if (communicationError) throw communicationError;
      }

      // Rol-routing: een geconfigureerde eigenaar per triage-categorie (Instellingen →
      // Mail-triage routering). Niet ingesteld → val terug op de triërende gebruiker.
      let assignedTo: string | null = user?.id ?? null;
      const { data: orgRow } = await supabase.from('organizations').select('settings').eq('id', organizationId).single();
      const routing = (orgRow?.settings as any)?.triage_routing;
      const routedTo = routing && typeof routing === 'object' ? routing[triage.label] : null;
      if (typeof routedTo === 'string' && routedTo) assignedTo = routedTo;

      const { error: taskError } = await supabase.from('recruiter_tasks' as any).insert({
        organization_id: organizationId,
        assigned_to: assignedTo,
        title: `${triage.label}: ${selectedMessage.subject || '(Geen onderwerp)'}`,
        description: [
          `Afzender: ${sender || 'onbekend'}`,
          `Classificatie: ${triage.label}`,
          `Reden: ${triage.reasoning}`,
          previewText ? `Preview: ${previewText}` : null,
        ].filter(Boolean).join('\n'),
        priority: triage.priority,
        category: triage.category,
        related_entity_type: candidateId ? 'kandidaat' : companyId ? 'opdrachtgever' : null,
        related_entity_id: candidateId ?? companyId,
        ai_generated: true,
        ai_reasoning: triage.reasoning,
        status: 'open',
      });
      if (taskError) throw taskError;

      return { label: triage.label };
    },
    onSuccess: ({ label }) => {
      queryClient.invalidateQueries({ queryKey: ['communications'] });
      queryClient.invalidateQueries({ queryKey: ['tasks-overview'] });
      queryClient.invalidateQueries({ queryKey: ['recruiter-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['open-task-count'] });
      toast.success(`Triagetaak aangemaakt (${label})`);
    },
    onError: (error: any) => toast.error(error.message ?? 'Triagetaak kon niet worden aangemaakt'),
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
    const consentBlocked = /consent|AADSTS65001|toestemming/i.test(activeAccount?.status_reason || '');
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-muted-foreground">
        <AlertCircle className="h-12 w-12" />
        <p className="text-lg">{consentBlocked ? 'Microsoft toestemming nodig' : 'Geen leesbare Outlook mailbox geselecteerd'}</p>
        <p className="max-w-xl text-center text-sm">
          {activeAccount?.status_reason || 'Ga naar Instellingen om Outlook accounts en rechten te beheren'}
        </p>
        <Button variant="outline" onClick={() => window.location.href = '/instellingen'}>
          {consentBlocked ? 'Outlook toestemming herstellen' : 'Naar Instellingen'}
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
                activeFolder === f.key ? 'bg-primary/10 text-stat-blue font-medium' : 'text-muted-foreground hover:bg-muted'
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
                  <span className="text-sm font-medium text-stat-blue">
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

              {triage && (
                <div className="mt-3 flex flex-col gap-3 rounded-md border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <Brain className="mt-0.5 h-4 w-4 text-stat-blue" />
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">AI triage</span>
                        <Badge variant="secondary" className={triageBadgeClass[triage.label]}>
                          {triage.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{triage.reasoning}</p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => triageMutation.mutate()}
                    disabled={triageMutation.isPending}
                  >
                    {triageMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Aanmaken...
                      </>
                    ) : (
                      <>
                        <ClipboardList className="mr-2 h-4 w-4" />
                        Maak triagetaak
                      </>
                    )}
                  </Button>
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
