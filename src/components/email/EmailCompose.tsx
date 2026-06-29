import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOutlookAccounts, useOutlookInvoke } from '@/hooks/useOutlookAccounts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Send, Loader2, X, Paperclip } from 'lucide-react';
import { plaintextToHtml } from '@/lib/email-signature';
import { sanitizeHtml } from '@/lib/sanitize-html';

interface EmailComposeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  replyTo?: {
    messageId: string;
    subject: string;
    from: string;
    toAll?: string[];
    body?: string;
    mode: 'reply' | 'replyAll' | 'forward';
  };
  defaultTo?: string;
  defaultSubject?: string;
  selectedAccount?: string;
}

const EmailCompose = ({ open, onOpenChange, replyTo, defaultTo, defaultSubject, selectedAccount }: EmailComposeProps) => {
  const callOutlook = useOutlookInvoke();
  const queryClient = useQueryClient();
  const { usableAccounts, defaultAccountId } = useOutlookAccounts('mail_send');

  const isReply = !!replyTo;
  const isForward = replyTo?.mode === 'forward';

  // Afzender-mailbox: kies tussen je persoonlijke mailbox en de bedrijfsmailbox.
  const [fromAccount, setFromAccount] = useState<string | undefined>(selectedAccount || defaultAccountId);
  useEffect(() => {
    if (!fromAccount && (selectedAccount || defaultAccountId)) {
      setFromAccount(selectedAccount || defaultAccountId);
    }
  }, [selectedAccount, defaultAccountId]); // eslint-disable-line react-hooks/exhaustive-deps

  const personalAccounts = usableAccounts.filter((a) => a.scope === 'personal');
  const orgAccounts = usableAccounts.filter((a) => a.scope === 'organization');

  const [to, setTo] = useState(defaultTo || (isReply && !isForward ? replyTo.from : '') || '');
  const [cc, setCc] = useState(replyTo?.mode === 'replyAll' ? (replyTo.toAll || []).join(', ') : '');
  const [subject, setSubject] = useState(
    defaultSubject ||
    (isForward ? `Fwd: ${replyTo?.subject || ''}` : '') ||
    (isReply ? `Re: ${replyTo?.subject || ''}` : '')
  );
  const [body, setBody] = useState('');
  const [showCc, setShowCc] = useState(!!cc);
  const previewHtml = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#334155;font-size:14px;line-height:1.6;padding:20px;">${
    plaintextToHtml(body.trimEnd()) || '<span style="color:#94a3b8;">Nog geen berichttekst.</span>'
  }<p style="margin-top:20px;color:#94a3b8;font-size:12px;">De ingestelde Outlook-handtekening wordt bij verzenden toegevoegd.</p></div>`;

  const sendMutation = useMutation({
    mutationFn: async () => {
      const toRecipients = to.split(/[,;]/).map(e => e.trim()).filter(Boolean);
      const ccRecipients = cc.split(/[,;]/).map(e => e.trim()).filter(Boolean);

      if (toRecipients.length === 0) throw new Error('Vul minimaal één ontvanger in');

      const htmlBody = plaintextToHtml(body.trimEnd());

      return callOutlook('outlook-send-mail', {
        account_id: fromAccount || selectedAccount,
        to: toRecipients,
        cc: ccRecipients,
        subject,
        html: htmlBody,
      });
    },
    onSuccess: () => {
      toast.success('E-mail verzonden');
      queryClient.invalidateQueries({ queryKey: ['outlook-emails'] });
      onOpenChange(false);
      setTo(''); setCc(''); setSubject(''); setBody('');
    },
    onError: (err: Error) => {
      if (err.message !== 'REAUTH_REQUIRED') {
        toast.error('Verzenden mislukt: ' + err.message);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {isForward ? 'Doorsturen' : isReply ? 'Beantwoorden' : 'Nieuw bericht'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 flex-1 overflow-y-auto">
          {usableAccounts.length > 1 && (
            <div className="flex items-center gap-2">
              <Label className="w-12 text-right text-muted-foreground text-sm">Van</Label>
              <Select value={fromAccount} onValueChange={setFromAccount}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Kies afzender-mailbox" />
                </SelectTrigger>
                <SelectContent>
                  {personalAccounts.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Persoonlijk</SelectLabel>
                      {personalAccounts.map((a) => (
                        <SelectItem key={a.account_id} value={a.account_id}>
                          {a.label || a.email || 'Persoonlijke mailbox'}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {orgAccounts.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Bedrijf</SelectLabel>
                      {orgAccounts.map((a) => (
                        <SelectItem key={a.account_id} value={a.account_id}>
                          {a.label || a.email || 'Bedrijfsmailbox'}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label className="w-12 text-right text-muted-foreground text-sm">Aan</Label>
              <Input
                value={to}
                onChange={e => setTo(e.target.value)}
                placeholder="email@voorbeeld.nl, ..."
                className="flex-1"
              />
              {!showCc && (
                <Button variant="ghost" size="sm" onClick={() => setShowCc(true)} className="text-xs">
                  CC
                </Button>
              )}
            </div>
            {showCc && (
              <div className="flex items-center gap-2">
                <Label className="w-12 text-right text-muted-foreground text-sm">CC</Label>
                <Input
                  value={cc}
                  onChange={e => setCc(e.target.value)}
                  placeholder="cc@voorbeeld.nl, ..."
                  className="flex-1"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Label className="w-12 text-right text-muted-foreground text-sm">Onderwerp</Label>
            <Input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Onderwerp"
              className="flex-1"
              disabled={isReply && !isForward}
            />
          </div>

          {replyTo?.body && (
            <div className="border rounded-md p-3 bg-muted/50 text-sm text-muted-foreground max-h-32 overflow-y-auto">
              <p className="text-xs font-medium mb-1">Origineel bericht van {replyTo.from}:</p>
              <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(replyTo.body) }} className="prose prose-sm max-w-none" />
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Bericht</Label>
              <Textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Typ je bericht..."
                rows={12}
                className="resize-none"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Preview</Label>
              <iframe
                title="email-compose-preview"
                srcDoc={previewHtml}
                sandbox=""
                className="h-[302px] w-full rounded-md border bg-white"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            De ingestelde Outlook-handtekening van de afzender wordt automatisch toegevoegd bij verzenden.
          </p>
        </div>

        <div className="flex justify-between items-center pt-3 border-t">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending} className="gap-2">
            {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Verzenden
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EmailCompose;
