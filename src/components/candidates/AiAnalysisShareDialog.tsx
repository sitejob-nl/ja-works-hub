import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Send, Loader2, Download, Eye, FileText } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidate: any;
}

const AiAnalysisShareDialog = ({ open, onOpenChange, candidate }: Props) => {
  const orgId = useOrganizationId();
  const previewRef = useRef<HTMLDivElement>(null);

  const [companyId, setCompanyId] = useState<string>('');
  const [contactId, setContactId] = useState<string>('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [introText, setIntroText] = useState('');
  const [showName, setShowName] = useState(true);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [tab, setTab] = useState<'compose' | 'preview'>('compose');

  // Reset on close
  useEffect(() => {
    if (!open) {
      setCompanyId(''); setContactId(''); setRecipientEmail(''); setRecipientName('');
      setIntroText(''); setShowName(true); setPreviewHtml(''); setTab('compose');
    }
  }, [open]);

  const { data: companies = [] } = useQuery({
    queryKey: ['ai-share-companies', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('id, name')
        .eq('organization_id', orgId!)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId && open,
  });

  const { data: contacts = [] } = useQuery({
    queryKey: ['ai-share-contacts', companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from('company_contacts')
        .select('id, first_name, last_name, email')
        .eq('company_id', companyId)
        .order('last_name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!companyId,
  });

  // Auto-fill recipient when contact picked
  useEffect(() => {
    if (!contactId) return;
    const c = contacts.find((x: any) => x.id === contactId);
    if (c) {
      setRecipientEmail(c.email ?? '');
      setRecipientName([c.first_name, c.last_name].filter(Boolean).join(' '));
    }
  }, [contactId, contacts]);

  const previewMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('send-ai-analysis', {
        body: {
          candidate_id: candidate.id,
          recipient_name: recipientName || undefined,
          intro_text: introText || undefined,
          show_name: showName,
          preview: true,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { html: string };
    },
    onSuccess: (data) => {
      setPreviewHtml(data.html);
      setTab('preview');
    },
    onError: (e: Error) => toast.error('Preview mislukt: ' + e.message),
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!recipientEmail.trim()) throw new Error('Vul een e-mailadres in');
      const { data, error } = await supabase.functions.invoke('send-ai-analysis', {
        body: {
          candidate_id: candidate.id,
          recipient_email: recipientEmail.trim(),
          recipient_name: recipientName || undefined,
          company_id: companyId || undefined,
          intro_text: introText || undefined,
          show_name: showName,
          preview: false,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: () => {
      toast.success('AI-analyse verstuurd');
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error('Verzenden mislukt: ' + e.message),
  });

  const downloadPdf = async () => {
    if (!previewHtml) {
      await previewMutation.mutateAsync();
    }
    // wait one tick so previewRef has rendered html
    setTimeout(async () => {
      if (!previewRef.current) {
        toast.error('Voorbeeld niet beschikbaar');
        return;
      }
      try {
        const html2pdf = (await import('html2pdf.js')).default;
        const candidateLabel = showName
          ? [candidate.first_name, candidate.last_name].filter(Boolean).join('-').replace(/\s+/g, '-')
          : `kandidaat-${candidate.id?.slice(0, 6) ?? 'profiel'}`;
        await html2pdf()
          .from(previewRef.current)
          .set({
            margin: 10,
            filename: `ai-analyse-${candidateLabel}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          })
          .save();
      } catch (e: any) {
        toast.error('PDF maken mislukt: ' + (e?.message ?? 'Onbekend'));
      }
    }, 200);
  };

  const aiReady = candidate?.ai_status === 'completed';
  const canSend = aiReady && !!recipientEmail.trim();
  const previewLoading = previewMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" /> AI-analyse delen met opdrachtgever
          </DialogTitle>
        </DialogHeader>

        {!aiReady && (
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
            De AI-analyse voor deze kandidaat is nog niet voltooid. Wacht tot de analyse klaar is voor je 'm kunt delen.
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="self-start">
            <TabsTrigger value="compose">Samenstellen</TabsTrigger>
            <TabsTrigger value="preview" disabled={!previewHtml}>Voorbeeld</TabsTrigger>
          </TabsList>

          <TabsContent value="compose" className="flex-1 overflow-y-auto space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Opdrachtgever</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger><SelectValue placeholder="Kies opdrachtgever" /></SelectTrigger>
                  <SelectContent>
                    {companies.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Contactpersoon</Label>
                <Select value={contactId} onValueChange={setContactId} disabled={!companyId}>
                  <SelectTrigger><SelectValue placeholder={companyId ? 'Kies contact' : 'Eerst opdrachtgever'} /></SelectTrigger>
                  <SelectContent>
                    {contacts.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {[c.first_name, c.last_name].filter(Boolean).join(' ')}{c.email ? ` — ${c.email}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Naam ontvanger</Label>
                <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Bijv. Jan de Vries" />
              </div>
              <div className="space-y-1">
                <Label>E-mailadres *</Label>
                <Input value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="contact@bedrijf.nl" />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Inleiding (optioneel)</Label>
              <Textarea
                value={introText}
                onChange={(e) => setIntroText(e.target.value)}
                rows={4}
                placeholder="Bijv. 'Hierbij stuur ik je het profiel van een geschikte kandidaat voor de productie-functie...'"
              />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label className="cursor-pointer">Toon kandidaatnaam in rapport</Label>
                <p className="text-xs text-muted-foreground mt-1">Uit zetten = alleen functiegroep en kenmerken zichtbaar (geanonimiseerd voorstel).</p>
              </div>
              <Switch checked={showName} onCheckedChange={setShowName} />
            </div>
          </TabsContent>

          <TabsContent value="preview" className="flex-1 overflow-y-auto">
            <div className="rounded-md border bg-white">
              <div ref={previewRef} dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-between items-center pt-3 border-t gap-2 flex-wrap">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => previewMutation.mutate()}
              disabled={!aiReady || previewLoading}
              className="gap-2"
            >
              {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Voorbeeld
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadPdf}
              disabled={!aiReady || previewLoading}
              className="gap-2"
            >
              <Download className="h-4 w-4" /> Download PDF
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuleren</Button>
            <Button
              onClick={() => sendMutation.mutate()}
              disabled={!canSend || sendMutation.isPending}
              className="gap-2"
            >
              {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Verstuur
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AiAnalysisShareDialog;
