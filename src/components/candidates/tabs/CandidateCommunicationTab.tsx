import { useEffect, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { useOutlookAccounts, useOutlookInvoke } from '@/hooks/useOutlookAccounts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Mail,
  MessageSquare,
  Paperclip,
  Phone,
  Plus,
  RefreshCw,
  Sparkles,
  StickyNote,
} from 'lucide-react';
import { format, isValid, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { unwrap, unwrapList } from '@/lib/db';
import { qk } from '@/lib/query-keys';
import { sanitizeHtml } from '@/lib/sanitize-html';
import {
  buildOutlookParticipantSearch,
  mergeCandidateHistory,
  type CandidateCommunicationRecord,
  type CandidateHistoryItem,
  type CandidateOutlookMessage,
} from '@/lib/candidate-email-history';
import type { Database } from '@/integrations/supabase/types';

type Channel = Database['public']['Enums']['communication_channel'];

type OutlookMessage = {
  id: string;
  subject: string;
  preview: string;
  from?: { name: string | null; address: string | null };
  to?: Array<{ name: string | null; address: string | null }>;
  cc?: Array<{ name: string | null; address: string | null }>;
  received_at: string | null;
  sent_at?: string | null;
  has_attachments: boolean;
};

type OutlookListResponse = {
  messages: OutlookMessage[];
  next_link: string | null;
};

type OutlookDetailResponse = {
  message: OutlookMessage & { body_html?: string; body_type?: string };
};

type OutlookTarget = {
  accountId: string;
  mailboxLabel: string;
  mailboxEmail: string | null;
  page: number;
  nextLink: string | null;
};

const PAGE_SIZE = 50;

const channelIcons: Record<Channel, typeof Mail> = {
  whatsapp: MessageSquare,
  email: Mail,
  voip: Phone,
  notitie: StickyNote,
  sms: MessageSquare,
};

const channelLabels: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  voip: 'Telefoongesprek',
  notitie: 'Notitie',
  sms: 'SMS',
};

function formatCommunicationDate(value: string | null) {
  if (!value) return '';
  const parsed = parseISO(value);
  return isValid(parsed) ? format(parsed, 'dd-MM-yyyy HH:mm') : '';
}

function plainText(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function mailboxLabel(account: { label: string; name: string | null; email: string | null }) {
  return account.name || account.email || account.label;
}

function MessageBody({ body }: { body: string }) {
  if (!containsHtml(body)) {
    return <p className="whitespace-pre-wrap text-sm" data-no-translate="true">{body}</p>;
  }

  return (
    <div
      className="prose prose-sm max-w-none dark:prose-invert [&_img]:max-w-full [&_a]:break-all"
      data-no-translate="true"
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(body) }}
    />
  );
}

const CandidateCommunicationTab = ({
  candidateId,
  candidateEmail,
}: {
  candidateId: string;
  candidateEmail?: string | null;
}) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const callOutlook = useOutlookInvoke();
  const outlook = useOutlookAccounts('mail_read');
  const participantSearch = buildOutlookParticipantSearch(candidateEmail);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ channel: 'notitie' as Channel, subject: '', body: '' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedTranscription, setExpandedTranscription] = useState<string | null>(null);
  const [outlookPageCount, setOutlookPageCount] = useState(1);

  useEffect(() => {
    setOutlookPageCount(1);
    setExpandedId(null);
  }, [candidateId, participantSearch]);

  const { data: comms = [], isLoading: commsLoading } = useQuery({
    queryKey: qk.communications.forCandidate(orgId, candidateId),
    queryFn: () => unwrapList(
      supabase
        .from('communications')
        .select('*, profiles:sent_by(full_name)')
        .eq('candidate_id', candidateId)
        .order('sent_at', { ascending: false }),
    ),
  });

  const normalizedCandidateEmail = candidateEmail?.trim().toLowerCase() ?? '';
  const outlookTargets: OutlookTarget[] = participantSearch
    ? outlook.usableAccounts.flatMap((account) => (
      Array.from({ length: outlookPageCount }, (_, page) => {
        const previousPage = page - 1;
        const nextLink = page === 0 ? null : qc.getQueryData<OutlookListResponse>(
          qk.communications.candidateOutlookPage(
            orgId,
            candidateId,
            account.account_id,
            normalizedCandidateEmail,
            previousPage,
          ),
        )?.next_link ?? null;

        return {
          accountId: account.account_id,
          mailboxLabel: mailboxLabel(account),
          mailboxEmail: account.email,
          page,
          nextLink,
        };
      })
    ))
    : [];

  const outlookQueries = useQueries({
    queries: outlookTargets.map((target) => ({
      queryKey: qk.communications.candidateOutlookPage(
        orgId,
        candidateId,
        target.accountId,
        normalizedCandidateEmail,
        target.page,
      ),
      queryFn: () => callOutlook<OutlookListResponse>('outlook-mail', {
        action: 'list',
        account_id: target.accountId,
        ...(target.nextLink
          ? { next_link: target.nextLink }
          : { search: participantSearch, top: PAGE_SIZE }),
      }),
      enabled: Boolean(participantSearch && (target.page === 0 || target.nextLink)),
      staleTime: 30_000,
      retry: 1,
    })),
  });

  const outlookMessages: CandidateOutlookMessage[] = outlookQueries.flatMap((query, index) => {
    const target = outlookTargets[index];
    const response = query.data as OutlookListResponse | undefined;
    return (response?.messages ?? []).map((message) => ({
      ...message,
      account_id: target.accountId,
      mailbox_label: target.mailboxLabel,
      mailbox_email: target.mailboxEmail,
    }));
  });

  const history = mergeCandidateHistory(
    comms as CandidateCommunicationRecord[],
    outlookMessages,
    candidateEmail,
  );
  const expandedItem = history.find((item) => item.id === expandedId) ?? null;
  const expandedOutlook = expandedItem?.outlook ?? null;

  const { data: outlookDetail, isLoading: outlookDetailLoading, isError: outlookDetailError } = useQuery({
    queryKey: qk.communications.candidateOutlookDetail(
      orgId,
      expandedOutlook?.account_id ?? 'none',
      expandedOutlook?.id ?? 'none',
    ),
    queryFn: async () => {
      const response = await callOutlook<OutlookDetailResponse>('outlook-mail', {
        action: 'detail',
        account_id: expandedOutlook!.account_id,
        message_id: expandedOutlook!.id,
      });
      return response.message;
    },
    enabled: Boolean(expandedOutlook),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const add = useMutation({
    mutationFn: async () => {
      await unwrap(supabase.from('communications').insert({
        candidate_id: candidateId,
        organization_id: orgId,
        channel: form.channel,
        subject: form.subject || null,
        body: form.body || null,
        sent_by: user?.id,
      }));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.communications.forCandidate(orgId, candidateId) });
      setAdding(false);
      setForm({ channel: 'notitie', subject: '', body: '' });
      toast.success('Communicatie toegevoegd');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const outlookLoading = outlook.isLoading || outlookQueries.some((query) => query.isLoading);
  const outlookFetching = outlook.isFetching || outlookQueries.some((query) => query.isFetching);
  const failedAccountIds = new Set(
    outlookQueries.flatMap((query, index) => query.isError ? [outlookTargets[index].accountId] : []),
  );
  const hasOlderOutlookMail = outlook.usableAccounts.some((account) => {
    const index = outlookTargets.findIndex((target) => (
      target.accountId === account.account_id && target.page === outlookPageCount - 1
    ));
    return index >= 0 && Boolean((outlookQueries[index].data as OutlookListResponse | undefined)?.next_link);
  });

  const refreshOutlook = () => {
    outlook.refetch();
    outlookQueries.forEach((query) => query.refetch());
  };

  const renderExpandedBody = (item: CandidateHistoryItem) => {
    if (item.source === 'outlook' && outlookDetailLoading) {
      return <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Bericht laden...</div>;
    }

    const body = item.source === 'outlook' ? outlookDetail?.body_html || item.body : item.body;
    return (
      <>
        {body && <MessageBody body={body} />}
        {item.source === 'outlook' && outlookDetailError && (
          <p className="text-xs text-destructive">Het volledige bericht kon niet worden geladen; de Outlook-preview wordt getoond.</p>
        )}
      </>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-medium">Communicatie en e-mailhistorie</h3>
          {participantSearch ? (
            <p className="text-sm text-muted-foreground">
              Outlook-historie met <span data-no-translate="true">{candidateEmail}</span> uit alle mailboxen waarvoor je leesrecht hebt.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Voeg een geldig e-mailadres toe om de Outlook-historie van deze kandidaat te zien.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {participantSearch && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={refreshOutlook}
              disabled={outlookFetching}
              aria-label="E-mailhistorie vernieuwen"
              title="E-mailhistorie vernieuwen"
            >
              <RefreshCw className={`h-4 w-4 ${outlookFetching ? 'animate-spin' : ''}`} />
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setAdding(true)} className="gap-1">
            <Plus className="h-3.5 w-3.5" />Nieuwe notitie
          </Button>
        </div>
      </div>

      {participantSearch && !outlook.isLoading && outlook.usableAccounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">
            <span data-no-translate="true">{outlook.usableAccounts.length}</span>&nbsp;
            {outlook.usableAccounts.length === 1 ? 'toegankelijke mailbox' : 'toegankelijke mailboxen'}
          </Badge>
          {outlook.usableAccounts.map((account) => (
            <Badge key={account.account_id} variant="outline" data-no-translate="true">
              {mailboxLabel(account)}
            </Badge>
          ))}
        </div>
      )}

      {participantSearch && !outlook.isLoading && outlook.usableAccounts.length === 0 && (
        <Alert>
          <Mail className="h-4 w-4" />
          <AlertDescription>
            Geen leesbare Outlook-mailbox gekoppeld. Alleen vastgelegde dossiercommunicatie wordt getoond.
          </AlertDescription>
        </Alert>
      )}

      {failedAccountIds.size > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Niet alle toegankelijke mailboxen konden worden geladen. Vernieuw de historie of controleer de Outlook-koppeling.
          </AlertDescription>
        </Alert>
      )}

      {adding && (
        <div className="bg-card rounded-lg border p-4 space-y-3">
          <div>
            <Label>Kanaal</Label>
            <Select value={form.channel} onValueChange={(value) => setForm((current) => ({ ...current, channel: value as Channel }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(channelLabels) as Channel[]).map((channel) => (
                  <SelectItem key={channel} value={channel}>{channelLabels[channel]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Onderwerp</Label>
            <Input value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} />
          </div>
          <div>
            <Label>Bericht</Label>
            <Textarea value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} rows={3} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Annuleren</Button>
            <Button size="sm" onClick={() => add.mutate()} disabled={add.isPending}>
              {add.isPending ? 'Opslaan...' : 'Opslaan'}
            </Button>
          </div>
        </div>
      )}

      {(commsLoading || outlookLoading) && history.length === 0 ? (
        <div className="space-y-3">
          {[0, 1, 2].map((key) => <Skeleton key={key} className="h-24 w-full" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((item) => {
            const communication = item.communication;
            const channel = item.channel as Channel;
            const Icon = channelIcons[channel] ?? MessageSquare;
            const isExpanded = expandedId === item.id;
            const hasDetails = Boolean(
              item.body ||
              item.source === 'outlook' ||
              communication?.call_summary ||
              communication?.transcription,
            );

            return (
              <div key={item.id} className="bg-card rounded-lg border p-4 flex gap-3">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-sm font-medium break-words" data-no-translate="true">
                          {item.subject || channelLabels[channel] || 'Communicatie'}
                        </p>
                        {item.channel === 'email' && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {item.direction === 'inbound' ? 'Inkomend' : 'Uitgaand'}
                          </Badge>
                        )}
                        {item.mailbox_label && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0" data-no-translate="true">
                            {item.mailbox_label}
                          </Badge>
                        )}
                        {item.has_attachments && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" aria-label="Bijlage" />}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-xs text-muted-foreground" data-no-translate="true">
                        {formatCommunicationDate(item.occurred_at)}
                      </span>
                      {hasDetails && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setExpandedId(isExpanded ? null : item.id)}
                          aria-label={isExpanded ? 'Bericht inklappen' : 'Bericht uitklappen'}
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </div>
                  </div>

                  {item.channel === 'email' && (item.from || item.to.length > 0) && (
                    <div className="space-y-0.5 text-xs text-muted-foreground">
                      {item.from && <p><span>Van:</span> <span data-no-translate="true">{item.from}</span></p>}
                      {item.to.length > 0 && <p><span>Aan:</span> <span data-no-translate="true">{item.to.join(', ')}</span></p>}
                      {item.cc.length > 0 && <p><span data-no-translate="true">CC:</span> <span data-no-translate="true">{item.cc.join(', ')}</span></p>}
                    </div>
                  )}

                  {!isExpanded && item.body && (
                    <p className="text-sm text-muted-foreground line-clamp-2" data-no-translate="true">{plainText(item.body)}</p>
                  )}

                  {isExpanded && (
                    <div className="rounded-md bg-muted/30 p-3 space-y-3 overflow-x-auto">
                      {renderExpandedBody(item)}
                    </div>
                  )}

                  {communication?.channel === 'voip' && communication.call_duration_seconds != null && (
                    <p className="text-xs text-muted-foreground">
                      Gespreksduur: {Math.floor(Number(communication.call_duration_seconds) / 60)}:{String(Number(communication.call_duration_seconds) % 60).padStart(2, '0')}
                    </p>
                  )}
                  {communication?.channel === 'voip' && communication.call_summary && (
                    <div className="p-2 bg-muted/50 rounded text-sm">
                      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1">
                        <Sparkles className="h-3 w-3" /> AI-samenvatting
                      </p>
                      <p className="text-sm" data-no-translate="true">{String(communication.call_summary)}</p>
                    </div>
                  )}
                  {communication?.channel === 'voip' && communication.transcription && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setExpandedTranscription(expandedTranscription === communication.id ? null : communication.id)}
                        className="text-xs hover:underline flex items-center gap-1"
                      >
                        {expandedTranscription === communication.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {expandedTranscription === communication.id ? 'Transcriptie verbergen' : 'Transcriptie tonen'}
                      </button>
                      {expandedTranscription === communication.id && (
                        <pre className="mt-2 p-3 bg-muted/50 rounded text-xs whitespace-pre-wrap font-sans max-h-64 overflow-y-auto" data-no-translate="true">
                          {String(communication.transcription)}
                        </pre>
                      )}
                    </div>
                  )}
                  {communication?.profiles?.full_name && (
                    <p className="text-xs text-muted-foreground">
                      Door: <span data-no-translate="true">{communication.profiles.full_name}</span>
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {history.length === 0 && !adding && (
            <p className="text-center text-muted-foreground py-8">Nog geen communicatie of e-mailhistorie gevonden</p>
          )}
        </div>
      )}

      {hasOlderOutlookMail && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOutlookPageCount((count) => count + 1)}
            disabled={outlookFetching}
          >
            {outlookFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ChevronDown className="mr-2 h-4 w-4" />}
            Oudere e-mails laden
          </Button>
        </div>
      )}
    </div>
  );
};

export default CandidateCommunicationTab;
