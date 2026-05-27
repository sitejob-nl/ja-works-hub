import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { usePublicUrl } from '@/hooks/usePublicUrl';
import { useAuth } from '@/contexts/AuthContext';
import { useOutlookAccounts, useOutlookInvoke } from '@/hooks/useOutlookAccounts';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Copy, Check, Send } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  companyId: string;
  contactEmail?: string | null;
  contactName?: string;
}

const ClientPortalActivateSheet = ({ open, onOpenChange, contactId, companyId, contactEmail, contactName }: Props) => {
  const orgId = useOrganizationId();
  const { buildUrl } = usePublicUrl();
  const { profile } = useAuth();
  const callOutlook = useOutlookInvoke();
  const { hasUsableAccounts } = useOutlookAccounts('mail_send');
  const isConnected = hasUsableAccounts;
  const qc = useQueryClient();
  const [email, setEmail] = useState(contactEmail ?? '');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const createInvite = useMutation({
    mutationFn: async () => {
      // Update contact portal_enabled
      await supabase.from('company_contacts').update({ portal_enabled: true }).eq('id', contactId);

      // Create invite
      const { data: invite, error } = await supabase
        .from('client_portal_invites')
        .insert({ organization_id: orgId, company_contact_id: contactId, company_id: companyId, email })
        .select('token')
        .single();
      if (error) throw error;

      const link = buildUrl(`/klantportaal/activeren/${invite.token}`);
      setInviteLink(link);
      return link;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts', companyId] });
      toast.success('Uitnodiging aangemaakt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleCopy = () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Link gekopieerd');
    }
  };

  const handleSendEmail = async () => {
    if (!inviteLink || !isConnected) return;
    try {
      const html = `
        <p>Beste ${contactName ?? ''},</p>
        <p>U bent uitgenodigd voor het opdrachtgeverportaal. Via dit portaal kunt u ingediende uren goedkeuren en uw plaatsingen inzien.</p>
        <p><a href="${inviteLink}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Account activeren</a></p>
        <p>Deze link is 7 dagen geldig.</p>
        <p>Met vriendelijke groet,<br/>${profile?.full_name || 'Het team'}</p>
      `;
      await callOutlook('outlook-send-mail', {
        to: [email],
        subject: 'Uitnodiging Opdrachtgeverportaal',
        html,
        company_id: companyId,
        company_contact_id: contactId,
      });
      setEmailSent(true);
      toast.success('Uitnodiging verstuurd per e-mail');
    } catch (err: any) {
      toast.error('E-mail versturen mislukt: ' + (err.message || 'onbekende fout'));
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) { setInviteLink(null); setCopied(false); setEmailSent(false); } onOpenChange(v); }}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Opdrachtgeverportaal activeren</SheetTitle>
          <SheetDescription>
            {contactName ? `Uitnodiging voor ${contactName}` : 'Stuur een activatielink naar de contactpersoon'}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 mt-6">
          {!inviteLink ? (
            <>
              <div>
                <Label>E-mailadres</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@bedrijf.nl" />
              </div>
              <Button onClick={() => createInvite.mutate()} disabled={!email || createInvite.isPending} className="w-full">
                {createInvite.isPending ? 'Aanmaken...' : 'Activatielink aanmaken'}
              </Button>
            </>
          ) : (
            <>
              <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Activatielink (7 dagen geldig)</p>
                <div className="flex gap-2">
                  <Input value={inviteLink} readOnly className="text-xs bg-background" />
                  <Button size="icon" variant="outline" onClick={handleCopy}>
                    {copied ? <Check className="h-4 w-4 text-stat-green" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {isConnected && !emailSent && (
                <Button onClick={handleSendEmail} variant="outline" className="w-full gap-2">
                  <Send className="h-4 w-4" /> Verstuur per e-mail
                </Button>
              )}

              {emailSent && (
                <p className="text-sm text-stat-green text-center">Uitnodiging verstuurd naar {email}</p>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default ClientPortalActivateSheet;
