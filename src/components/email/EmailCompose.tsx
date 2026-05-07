import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMicrosoftApi } from '@/hooks/useMicrosoftApi';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Send, Loader2, X, Paperclip } from 'lucide-react';
import { buildEmailHtmlWithSignature } from '@/lib/email-signature';
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
}

const EmailCompose = ({ open, onOpenChange, replyTo, defaultTo, defaultSubject }: EmailComposeProps) => {
  const { callApi } = useMicrosoftApi();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const senderName = profile?.full_name?.trim() || '';

  const isReply = !!replyTo;
  const isForward = replyTo?.mode === 'forward';

  const [to, setTo] = useState(defaultTo || (isReply && !isForward ? replyTo.from : '') || '');
  const [cc, setCc] = useState(replyTo?.mode === 'replyAll' ? (replyTo.toAll || []).join(', ') : '');
  const [subject, setSubject] = useState(
    defaultSubject ||
    (isForward ? `Fwd: ${replyTo?.subject || ''}` : '') ||
    (isReply ? `Re: ${replyTo?.subject || ''}` : '')
  );
  const [body, setBody] = useState('');
  const [showCc, setShowCc] = useState(!!cc);

  const sendMutation = useMutation({
    mutationFn: async () => {
      const toRecipients = to.split(/[,;]/).map(e => e.trim()).filter(Boolean).map(email => ({
        emailAddress: { address: email },
      }));
      const ccRecipients = cc.split(/[,;]/).map(e => e.trim()).filter(Boolean).map(email => ({
        emailAddress: { address: email },
      }));

      if (toRecipients.length === 0) throw new Error('Vul minimaal één ontvanger in');

      const htmlBody = buildEmailHtmlWithSignature(body, senderName);

      if (isReply && replyTo?.messageId) {
        const endpoint = isForward
          ? `me/messages/${replyTo.messageId}/forward`
          : replyTo.mode === 'replyAll'
            ? `me/messages/${replyTo.messageId}/replyAll`
            : `me/messages/${replyTo.messageId}/reply`;

        return callApi({
          endpoint,
          method: 'POST',
          payload: {
            message: {
              toRecipients: isForward ? toRecipients : undefined,
              ccRecipients: ccRecipients.length > 0 ? ccRecipients : undefined,
            },
            comment: htmlBody,
          },
        });
      }

      return callApi({
        endpoint: 'me/sendMail',
        method: 'POST',
        payload: {
          message: {
            subject,
            body: { contentType: 'HTML', content: htmlBody },
            toRecipients,
            ...(ccRecipients.length > 0 ? { ccRecipients } : {}),
          },
        },
      });
    },
    onSuccess: () => {
      toast.success('E-mail verzonden');
      queryClient.invalidateQueries({ queryKey: ['microsoft-emails'] });
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
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {isForward ? 'Doorsturen' : isReply ? 'Beantwoorden' : 'Nieuw bericht'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 flex-1 overflow-y-auto">
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

          <Textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Typ je bericht..."
            rows={10}
            className="resize-none"
          />

          <p className="text-xs text-muted-foreground">
            Onderaan wordt automatisch toegevoegd:{' '}
            <span className="font-medium">Met vriendelijke groet, {senderName || 'Het JA Werkt team'}</span>
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
