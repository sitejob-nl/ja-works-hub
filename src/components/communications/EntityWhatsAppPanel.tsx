import { useEffect, useMemo, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useWhatsAppMessages } from '@/hooks/useWhatsAppMessages';
import { useWhatsAppRealtime } from '@/hooks/useWhatsAppRealtime';
import { useWhatsAppSend } from '@/hooks/useWhatsAppSend';
import { getErrorMessage } from '@/lib/error-message';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChatThread } from '@/components/whatsapp/ChatThread';
import { TemplatePicker } from '@/components/whatsapp/TemplatePicker';
import type { InteractivePayload } from '@/components/whatsapp/InteractiveMessageBuilder';
import type { CommunicationRecipient } from './types';

type Props = {
  recipients: CommunicationRecipient[];
  candidateId?: string | null;
  companyId?: string | null;
};

type SendContext = {
  candidate_id?: string;
  company_id?: string;
  company_contact_id?: string;
};

export function EntityWhatsAppPanel({ recipients, candidateId, companyId }: Props) {
  const orgId = useOrganizationId();
  const availableRecipients = useMemo(
    () => recipients.filter((recipient) => Boolean(recipient.phone?.trim())),
    [recipients],
  );
  const [selectedId, setSelectedId] = useState(availableRecipients[0]?.id ?? '');
  const [showTemplates, setShowTemplates] = useState(false);
  const selected = availableRecipients.find((recipient) => recipient.id === selectedId) ?? availableRecipients[0] ?? null;
  const phone = selected?.phone?.trim() ?? null;

  useEffect(() => {
    if (!availableRecipients.some((recipient) => recipient.id === selectedId)) {
      setSelectedId(availableRecipients[0]?.id ?? '');
    }
  }, [availableRecipients, selectedId]);

  useWhatsAppRealtime(orgId);
  const { data: messages = [], isLoading } = useWhatsAppMessages(orgId, phone);
  const sendMutation = useWhatsAppSend(orgId);

  const sendContext: SendContext = {
    candidate_id: candidateId || undefined,
    company_id: companyId || undefined,
    company_contact_id: selected?.companyContactId || undefined,
  };

  const handleSendText = (text: string) => {
    if (!phone) return;
    sendMutation.mutate({
      to: phone,
      type: 'text',
      text: { body: text },
      ...sendContext,
    });
  };

  const handleSendMedia = async (file: File, type: string) => {
    if (!phone) return;
    try {
      const extension = file.name.split('.').pop() || 'bin';
      const path = `${orgId}/whatsapp/${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(path, file, { upsert: false });
      if (uploadError) throw uploadError;

      const { data, error: signedUrlError } = await supabase.storage
        .from('documents')
        .createSignedUrl(path, 60 * 60);
      if (signedUrlError || !data?.signedUrl) throw signedUrlError ?? new Error('Kon media-link niet maken');

      const mediaType = type as 'image' | 'video' | 'audio' | 'document';
      sendMutation.mutate({
        to: phone,
        type: mediaType,
        [mediaType]: mediaType === 'audio'
          ? { link: data.signedUrl }
          : { link: data.signedUrl, caption: file.name },
        ...sendContext,
      });
    } catch (error) {
      toast.error(getErrorMessage(error, 'Media uploaden mislukt'));
    }
  };

  const handleSendTemplate = (template: { name: string; language: string; components?: any[] }) => {
    if (!phone) return;
    sendMutation.mutate({
      to: phone,
      type: 'template',
      template,
      ...sendContext,
    });
  };

  const handleSendInteractive = (payload: InteractivePayload) => {
    if (!phone) return;
    const interactive: Record<string, unknown> = {
      type: payload.type === 'button' ? 'button' : 'list',
      body: { text: payload.body },
      ...(payload.footer ? { footer: { text: payload.footer } } : {}),
      action: payload.type === 'button'
        ? {
            buttons: (payload.buttons ?? []).map((button) => ({
              type: 'reply',
              reply: { id: button.id, title: button.title },
            })),
          }
        : { button: payload.button_text, sections: payload.sections },
    };

    sendMutation.mutate({
      to: phone,
      type: 'interactive',
      interactive,
      ...sendContext,
    });
  };

  if (availableRecipients.length === 0) {
    return (
      <Alert>
        <MessageSquare className="h-4 w-4" />
        <AlertDescription>Voeg een telefoonnummer toe om vanuit dit dossier te WhatsAppen.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {availableRecipients.length > 1 && (
        <div className="max-w-md space-y-1.5">
          <Label>Gesprek met</Label>
          <Select value={selected?.id} onValueChange={setSelectedId}>
            <SelectTrigger><SelectValue placeholder="Kies een ontvanger" /></SelectTrigger>
            <SelectContent>
              {availableRecipients.map((recipient) => (
                <SelectItem key={recipient.id} value={recipient.id}>
                  {recipient.label} · {recipient.phone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="h-[620px] max-h-[70vh] min-h-[440px] overflow-hidden rounded-lg border bg-card">
        <ChatThread
          phone={phone}
          candidateName={selected?.label ?? null}
          candidateId={candidateId ?? null}
          messages={messages}
          isLoading={isLoading}
          isSending={sendMutation.isPending}
          showBackButton={false}
          showContactButton={false}
          onBack={() => undefined}
          onToggleContact={() => undefined}
          onSendText={handleSendText}
          onSendMedia={handleSendMedia}
          onOpenTemplates={() => setShowTemplates(true)}
          onSendInteractive={handleSendInteractive}
        />
      </div>

      <TemplatePicker
        open={showTemplates}
        onOpenChange={setShowTemplates}
        orgId={orgId}
        candidateId={candidateId}
        candidateName={selected?.label ?? null}
        onSend={handleSendTemplate}
        isSending={sendMutation.isPending}
      />
    </div>
  );
}
