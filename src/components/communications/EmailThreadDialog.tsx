import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, isValid, parseISO } from 'date-fns';
import { AlertCircle, Loader2, Mail, Paperclip } from 'lucide-react';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useOutlookInvoke } from '@/hooks/useOutlookAccounts';
import { qk } from '@/lib/query-keys';
import { sanitizeHtml } from '@/lib/sanitize-html';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { CandidateHistoryItem } from '@/lib/candidate-email-history';

type ThreadMessage = {
  id: string;
  subject?: string | null;
  from?: { name?: string | null; address?: string | null } | null;
  to?: Array<{ name?: string | null; address?: string | null }>;
  cc?: Array<{ name?: string | null; address?: string | null }>;
  received_at?: string | null;
  sent_at?: string | null;
  body_html?: string | null;
  preview?: string | null;
  has_attachments?: boolean;
};

type ThreadResponse = {
  conversation_id: string | null;
  messages: ThreadMessage[];
  truncated?: boolean;
};

type Props = {
  item: CandidateHistoryItem | null;
  targetEmails: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function dateLabel(value: string | null | undefined) {
  if (!value) return '';
  const parsed = parseISO(value);
  return isValid(parsed) ? format(parsed, 'dd-MM-yyyy HH:mm') : '';
}

function addresses(values: ThreadMessage['to'] | ThreadMessage['cc']) {
  return (values ?? []).map((recipient) => recipient.address).filter(Boolean).join(', ');
}

function containsHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function EmailBody({ html, title }: { html: string; title: string }) {
  const safeHtml = useMemo(() => sanitizeHtml(html), [html]);
  const document = useMemo(() => `<!doctype html>
    <html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">
    <base target="_blank"><style>
      html,body{margin:0;padding:0;background:#fff;color:#1f2937;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      body{padding:18px;overflow-wrap:anywhere} img{max-width:100%;height:auto} table{max-width:100%}
      pre{white-space:pre-wrap} a{color:#0369a1}
    </style></head><body>${safeHtml}</body></html>`, [safeHtml]);

  if (!containsHtml(html)) {
    return <p className="whitespace-pre-wrap p-4 text-sm" data-no-translate="true">{html}</p>;
  }

  const frameHeight = Math.min(640, Math.max(240, Math.ceil(html.length / 180) * 24));
  return (
    <iframe
      title={title}
      srcDoc={document}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className="w-full border-0 bg-white"
      style={{ height: frameHeight }}
    />
  );
}

export function EmailThreadDialog({ item, targetEmails, open, onOpenChange }: Props) {
  const orgId = useOrganizationId();
  const callOutlook = useOutlookInvoke();
  const outlook = item?.outlook ?? null;

  const thread = useQuery({
    queryKey: qk.communications.entityOutlookThread(
      orgId,
      outlook?.account_id ?? 'none',
      outlook?.id ?? 'none',
    ),
    queryFn: () => callOutlook<ThreadResponse>('outlook-mail', {
      action: 'thread',
      account_id: outlook!.account_id,
      message_id: outlook!.id,
    }),
    enabled: Boolean(open && outlook),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const fallbackMessage: ThreadMessage | null = item ? {
    id: item.id,
    subject: item.subject,
    from: { address: item.from },
    to: item.to.map((address) => ({ address })),
    cc: item.cc.map((address) => ({ address })),
    sent_at: item.occurred_at,
    body_html: item.body,
    preview: item.body,
    has_attachments: item.has_attachments,
  } : null;
  const messages = thread.data?.messages?.length
    ? thread.data.messages
    : fallbackMessage ? [fallbackMessage] : [];
  const normalizedTargets = new Set(targetEmails.map((email) => email.toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-6xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5 pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <Mail className="h-5 w-5 text-muted-foreground" />
            <DialogTitle className="break-words" data-no-translate="true">
              {item?.subject || 'E-mail'}
            </DialogTitle>
            <Badge variant="secondary">
              {messages.length} {messages.length === 1 ? 'bericht' : 'berichten'}
            </Badge>
          </div>
          <DialogDescription>
            Volledige e-mailthread uit {item?.mailbox_label || 'Outlook'}, chronologisch van oud naar nieuw.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 bg-muted/20">
          <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
            {thread.isLoading && outlook && (
              <div className="flex items-center justify-center gap-2 rounded-lg border bg-card py-16 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />Volledige thread laden...
              </div>
            )}

            {thread.isError && outlook && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  De volledige thread kon niet worden geladen. Het geselecteerde bericht wordt als fallback getoond.
                </AlertDescription>
              </Alert>
            )}

            {thread.data?.truncated && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>Deze thread bevat meer dan 200 berichten; de eerste 200 worden getoond.</AlertDescription>
              </Alert>
            )}

            {!thread.isLoading && messages.map((message, index) => {
              const from = message.from?.address ?? '';
              const inbound = normalizedTargets.has(from.toLowerCase());
              const body = message.body_html || message.preview || '';
              return (
                <article key={message.id} className="overflow-hidden rounded-lg border bg-card shadow-sm">
                  <header className="space-y-2 border-b bg-muted/20 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium" data-no-translate="true">
                            {message.from?.name || from || 'Onbekende afzender'}
                          </p>
                          <Badge variant="outline">{inbound ? 'Inkomend' : 'Uitgaand'}</Badge>
                          {message.has_attachments && <Paperclip className="h-4 w-4 text-muted-foreground" aria-label="Bijlage" />}
                        </div>
                        {from && <p className="text-xs text-muted-foreground" data-no-translate="true">{from}</p>}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground" data-no-translate="true">
                        {dateLabel(message.sent_at || message.received_at)}
                      </span>
                    </div>
                    <div className="space-y-0.5 text-xs text-muted-foreground">
                      {addresses(message.to) && <p>Aan: <span data-no-translate="true">{addresses(message.to)}</span></p>}
                      {addresses(message.cc) && <p><span data-no-translate="true">CC:</span> <span data-no-translate="true">{addresses(message.cc)}</span></p>}
                    </div>
                  </header>
                  <EmailBody html={body || 'Dit bericht heeft geen leesbare inhoud.'} title={`E-mail ${index + 1}`} />
                </article>
              );
            })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
