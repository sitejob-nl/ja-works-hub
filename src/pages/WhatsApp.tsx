import { useState } from 'react';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { MessageSquare, FileText, QrCode, BarChart3 } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWhatsAppRealtime } from '@/hooks/useWhatsAppRealtime';
import { useWhatsAppConversations } from '@/hooks/useWhatsAppConversations';
import { useWhatsAppMessages } from '@/hooks/useWhatsAppMessages';
import { useWhatsAppSend } from '@/hooks/useWhatsAppSend';

import { ConversationList } from '@/components/whatsapp/ConversationList';
import { ChatThread } from '@/components/whatsapp/ChatThread';
import { ContactPanel } from '@/components/whatsapp/ContactPanel';
import { TemplatePicker } from '@/components/whatsapp/TemplatePicker';
import { NewChatDialog } from '@/components/whatsapp/NewChatDialog';
import { TemplateManager } from '@/components/whatsapp/TemplateManager';
import { QRCodeManager } from '@/components/whatsapp/QRCodeManager';
import { WhatsAppAnalytics } from '@/components/whatsapp/WhatsAppAnalytics';
import type { InteractivePayload } from '@/components/whatsapp/InteractiveMessageBuilder';

const WhatsAppPage = () => {
  const orgId = useOrganizationId();
  const isMobile = useIsMobile();

  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [showContactPanel, setShowContactPanel] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);

  // Realtime updates
  useWhatsAppRealtime(orgId);

  // Data hooks
  const {
    data: conversations = [],
    isLoading: convsLoading,
  } = useWhatsAppConversations(orgId);

  const {
    data: messages = [],
    isLoading: msgsLoading,
  } = useWhatsAppMessages(orgId, selectedPhone);

  const sendMutation = useWhatsAppSend(orgId);

  // Derived state
  const selectedConversation = conversations.find((c) => c.phone === selectedPhone) ?? null;
  const candidateName = selectedConversation?.candidateName ?? null;

  // Handlers
  const handleSelectConversation = (phone: string, candidateId: string | null) => {
    setSelectedPhone(phone);
    setSelectedCandidateId(candidateId);
    if (isMobile) setShowContactPanel(false);
  };

  const handleStartNewChat = (phone: string, candidateId: string | null) => {
    setSelectedPhone(phone);
    setSelectedCandidateId(candidateId);
    setShowNewChat(false);
    // First message to a new contact requires a template (outside the 24h window)
    // Auto-open the template picker so the user can send the required template
    const existingConv = conversations.find((c) => c.phone === phone);
    if (!existingConv) {
      setShowTemplates(true);
    }
  };

  const handleBack = () => {
    setSelectedPhone(null);
    setSelectedCandidateId(null);
    setShowContactPanel(false);
  };

  const handleToggleContact = () => {
    setShowContactPanel((v) => !v);
  };

  const handleSendText = (text: string) => {
    if (!selectedPhone) return;
    sendMutation.mutate({
      to: selectedPhone,
      type: 'text',
      text: { body: text },
      candidate_id: selectedCandidateId ?? undefined,
    });
  };

  const handleSendMedia = async (file: File, type: string) => {
    if (!selectedPhone) return;
    try {
      // Upload to Supabase Storage first, then send link
      const ext = file.name.split('.').pop();
      const path = `whatsapp/${orgId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(path, file, { upsert: false });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      const mediaType = type as 'image' | 'video' | 'audio' | 'document';
      sendMutation.mutate({
        to: selectedPhone,
        type: mediaType,
        [mediaType]: mediaType === 'audio'
          ? { link: publicUrl }
          : { link: publicUrl, caption: file.name },
        candidate_id: selectedCandidateId ?? undefined,
      });
    } catch (err: any) {
      toast.error('Media upload mislukt: ' + (err.message ?? 'Onbekende fout'));
    }
  };

  const handleSendTemplate = (template: {
    name: string;
    language: string;
    components?: any[];
  }) => {
    if (!selectedPhone) return;
    sendMutation.mutate({
      to: selectedPhone,
      type: 'template',
      template,
      candidate_id: selectedCandidateId ?? undefined,
    });
  };

  const handleSendInteractive = (payload: InteractivePayload) => {
    if (!selectedPhone) return;

    const interactive: any = {
      type: payload.type === 'button' ? 'button' : 'list',
      body: { text: payload.body },
    };

    if (payload.footer) interactive.footer = { text: payload.footer };

    if (payload.type === 'button') {
      interactive.action = {
        buttons: payload.buttons?.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title },
        })),
      };
    } else {
      interactive.action = {
        button: payload.button_text,
        sections: payload.sections,
      };
    }

    sendMutation.mutate({
      to: selectedPhone,
      type: 'interactive',
      interactive,
      candidate_id: selectedCandidateId ?? undefined,
    });
  };

  // Panel visibility logic (mobile: one panel at a time)
  const showConvList = !isMobile || !selectedPhone;
  const showChat = !isMobile || !!selectedPhone;
  const showContact = showContactPanel && (!isMobile || !!selectedPhone);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Page header — only show when not in a mobile chat */}
      {(!isMobile || !selectedPhone) && (
        <div className="mb-4 shrink-0">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">WhatsApp</h1>
          <p className="text-sm text-muted-foreground">Gesprekken met kandidaten</p>
        </div>
      )}

      <Tabs defaultValue="gesprekken" className="flex flex-col flex-1 min-h-0">
        {/* Sticky tabs bar */}
        <div className="shrink-0 sticky top-0 z-10 bg-background border-b">
          <TabsList className="h-auto p-0 bg-transparent rounded-none w-full justify-start">
            <TabsTrigger
              value="gesprekken"
              className="flex items-center gap-2 px-4 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <MessageSquare className="h-4 w-4" />
              Gesprekken
            </TabsTrigger>
            <TabsTrigger
              value="templates"
              className="flex items-center gap-2 px-4 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <FileText className="h-4 w-4" />
              Templates
            </TabsTrigger>
            <TabsTrigger
              value="qrcodes"
              className="flex items-center gap-2 px-4 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <QrCode className="h-4 w-4" />
              QR Codes
            </TabsTrigger>
            <TabsTrigger
              value="analytics"
              className="flex items-center gap-2 px-4 py-3 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <BarChart3 className="h-4 w-4" />
              Analytics
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Gesprekken tab — full-height 3-panel chat layout */}
        <TabsContent value="gesprekken" className="flex-1 min-h-0 mt-0 data-[state=active]:flex data-[state=active]:flex-col">
          <div className="flex flex-1 min-h-0 border rounded-lg overflow-hidden bg-card mt-4">
            {/* Left: Conversation list */}
            {showConvList && (
              <div
                className={cn(
                  'flex flex-col shrink-0',
                  isMobile ? 'w-full' : 'w-[300px]'
                )}
              >
                <ConversationList
                  conversations={conversations}
                  isLoading={convsLoading}
                  selectedPhone={selectedPhone}
                  onSelect={handleSelectConversation}
                  onNewChat={() => setShowNewChat(true)}
                />
              </div>
            )}

            {/* Middle: Chat thread */}
            {showChat && (
              <div className="flex-1 flex min-w-0">
                <ChatThread
                  phone={selectedPhone}
                  candidateName={candidateName}
                  candidateId={selectedCandidateId}
                  messages={messages}
                  isLoading={msgsLoading}
                  isSending={sendMutation.isPending}
                  showBackButton={isMobile}
                  onBack={handleBack}
                  onToggleContact={handleToggleContact}
                  onSendText={handleSendText}
                  onSendMedia={handleSendMedia}
                  onOpenTemplates={() => setShowTemplates(true)}
                  onSendInteractive={handleSendInteractive}
                />
              </div>
            )}

            {/* Right: Contact panel */}
            {showContact && selectedPhone && (
              <div
                className={cn(
                  'flex flex-col shrink-0 border-l',
                  isMobile ? 'w-full absolute inset-y-0 right-0 z-10 bg-card' : 'w-[300px]'
                )}
              >
                <ContactPanel
                  candidateId={selectedCandidateId}
                  phone={selectedPhone}
                  orgId={orgId}
                  onClose={() => setShowContactPanel(false)}
                />
              </div>
            )}
          </div>
        </TabsContent>

        {/* Templates tab */}
        <TabsContent value="templates" className="flex-1 overflow-auto mt-0">
          <div className="p-4">
            <TemplateManager />
          </div>
        </TabsContent>

        {/* QR Codes tab */}
        <TabsContent value="qrcodes" className="flex-1 overflow-auto mt-0">
          <div className="p-4">
            <QRCodeManager />
          </div>
        </TabsContent>

        {/* Analytics tab */}
        <TabsContent value="analytics" className="flex-1 overflow-auto mt-0">
          <div className="p-4">
            <WhatsAppAnalytics />
          </div>
        </TabsContent>
      </Tabs>

      {/* New chat dialog */}
      <NewChatDialog
        open={showNewChat}
        onOpenChange={setShowNewChat}
        orgId={orgId}
        onStartChat={handleStartNewChat}
      />

      {/* Template picker modal */}
      <TemplatePicker
        open={showTemplates}
        onOpenChange={setShowTemplates}
        orgId={orgId}
        onSend={handleSendTemplate}
        isSending={sendMutation.isPending}
      />
    </div>
  );
};

export default WhatsAppPage;
