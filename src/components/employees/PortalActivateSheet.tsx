import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { useMicrosoftApi } from '@/hooks/useMicrosoftApi';
import { useMicrosoftConfig } from '@/hooks/useMicrosoftConfig';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Copy, Check, Mail, Send } from 'lucide-react';
import { format } from 'date-fns';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateId: string;
  /** @deprecated Use candidateId instead */
  employeeId?: string;
  candidateEmail?: string | null;
}

function replaceVars(text: string, vars: Record<string, string>): string {
  let result = text;
  Object.entries(vars).forEach(([key, val]) => {
    result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), val);
  });
  return result;
}

const PortalActivateSheet = ({ open, onOpenChange, candidateId: candidateIdProp, employeeId, candidateEmail }: Props) => {
  const candidateId = candidateIdProp ?? employeeId!;
  const orgId = useOrganizationId();
  const { profile } = useAuth();
  const { callApi } = useMicrosoftApi();
  const { isConnected } = useMicrosoftConfig();
  const qc = useQueryClient();
  const [email, setEmail] = useState(candidateEmail ?? '');
  const [language, setLanguage] = useState('nl');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // Fetch candidate data for template variables
  const { data: candidate } = useQuery({
    queryKey: ['candidate-for-invite', candidateId],
    queryFn: async () => {
      const { data } = await supabase
        .from('candidates')
        .select('first_name, last_name, email, phone, employee_number')
        .eq('id', candidateId)
        .single();
      return data;
    },
    enabled: !!candidateId && open,
  });

  // Fetch org name
  const { data: org } = useQuery({
    queryKey: ['org-name', orgId],
    queryFn: async () => {
      const { data } = await supabase.from('organizations').select('name').eq('id', orgId).single();
      return data;
    },
    enabled: !!orgId,
  });

  // Fetch invitation template
  const { data: inviteTemplate } = useQuery({
    queryKey: ['email-template-invitation', orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from('email_templates' as any)
        .select('*')
        .eq('organization_id', orgId)
        .eq('category', 'invitation')
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as any;
    },
    enabled: !!orgId && open,
  });

  const buildVariableMap = (link: string) => ({
    '{{voornaam}}': candidate?.first_name || '',
    '{{achternaam}}': candidate?.last_name || '',
    '{{volledige_naam}}': [candidate?.first_name, candidate?.last_name].filter(Boolean).join(' '),
    '{{email}}': email,
    '{{telefoon}}': candidate?.phone || '',
    '{{medewerker_nummer}}': candidate?.employee_number || '',
    '{{organisatie_naam}}': org?.name || '',
    '{{datum_vandaag}}': format(new Date(), 'dd-MM-yyyy'),
    '{{portaal_link}}': link,
    '{{activatie_link}}': link,
    // English variants
    '{{first_name}}': candidate?.first_name || '',
    '{{last_name}}': candidate?.last_name || '',
    '{{portal_link}}': link,
  });

  const defaultEmailHtml = (link: string, name: string) => `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Welkom bij het medewerkerportaal</h2>
      <p>Beste ${name},</p>
      <p>Er is een account voor je aangemaakt in het medewerkerportaal van ${org?.name || 'ons uitzendbureau'}. Via dit portaal kun je:</p>
      <ul>
        <li>Je uren registreren</li>
        <li>Documenten inzien</li>
        <li>Ziekmeldingen doorgeven</li>
        <li>Je profiel beheren</li>
      </ul>
      <p><a href="${link}" style="display: inline-block; background: #1e293b; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Account activeren</a></p>
      <p style="color: #64748b; font-size: 13px;">Deze link is 7 dagen geldig.</p>
      <p>Met vriendelijke groet,<br><strong>${org?.name || 'Het team'}</strong></p>
    </div>`;

  const activate = useMutation({
    mutationFn: async () => {
      // 1. Update candidate
      const { error: empError } = await supabase
        .from('candidates')
        .update({
          portal_enabled: true,
          portal_activated_at: new Date().toISOString(),
          portal_language: language,
        })
        .eq('id', candidateId);
      if (empError) throw empError;

      // 2. Insert portal invite
      const { data: invite, error: inviteError } = await supabase
        .from('portal_invites')
        .insert({
          organization_id: orgId,
          candidate_id: candidateId,
          email,
        })
        .select('token')
        .single();
      if (inviteError) throw inviteError;

      const link = `${window.location.origin}/portaal/activeren/${invite.token}`;

      // 3. Send email via Outlook if connected
      if (isConnected) {
        const vars = buildVariableMap(link);
        const name = [candidate?.first_name, candidate?.last_name].filter(Boolean).join(' ');

        let subject: string;
        let htmlBody: string;

        if (inviteTemplate) {
          subject = replaceVars(inviteTemplate.subject, vars);
          htmlBody = replaceVars(inviteTemplate.body_html, vars);
        } else {
          subject = `Activeer je medewerkerportaal — ${org?.name || ''}`;
          htmlBody = defaultEmailHtml(link, name);
        }

        try {
          await callApi({
            endpoint: 'me/sendMail',
            method: 'POST',
            payload: {
              message: {
                subject,
                body: { contentType: 'HTML', content: htmlBody },
                toRecipients: [{ emailAddress: { address: email } }],
              },
            },
          });
          setEmailSent(true);
        } catch (err) {
          console.error('Email send failed:', err);
          // Don't throw — invite is created, email is a bonus
        }
      }

      return link;
    },
    onSuccess: (link) => {
      setInviteLink(link);
      qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      if (emailSent) {
        toast.success('Portaal geactiveerd en uitnodiging verstuurd via e-mail');
      } else {
        toast.success('Portaal geactiveerd — kopieer de link hieronder');
      }
    },
    onError: () => {
      toast.error('Er ging iets mis bij het activeren');
    },
  });

  const sendNewInvite = useMutation({
    mutationFn: async () => {
      const { data: invite, error } = await supabase
        .from('portal_invites')
        .insert({
          organization_id: orgId,
          candidate_id: candidateId,
          email,
        })
        .select('token')
        .single();
      if (error) throw error;

      const link = `${window.location.origin}/portaal/activeren/${invite.token}`;

      // Send via Outlook
      if (isConnected) {
        const vars = buildVariableMap(link);
        const name = [candidate?.first_name, candidate?.last_name].filter(Boolean).join(' ');

        let subject: string;
        let htmlBody: string;

        if (inviteTemplate) {
          subject = replaceVars(inviteTemplate.subject, vars);
          htmlBody = replaceVars(inviteTemplate.body_html, vars);
        } else {
          subject = `Activeer je medewerkerportaal — ${org?.name || ''}`;
          htmlBody = defaultEmailHtml(link, name);
        }

        try {
          await callApi({
            endpoint: 'me/sendMail',
            method: 'POST',
            payload: {
              message: {
                subject,
                body: { contentType: 'HTML', content: htmlBody },
                toRecipients: [{ emailAddress: { address: email } }],
              },
            },
          });
          setEmailSent(true);
        } catch { /* silent */ }
      }

      return link;
    },
    onSuccess: (link) => {
      setInviteLink(link);
      if (emailSent) {
        toast.success('Nieuwe uitnodiging verstuurd via e-mail');
      } else {
        toast.success('Nieuwe uitnodiging aangemaakt');
      }
    },
  });

  const copyLink = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    toast.success('Link gekopieerd');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setInviteLink(null);
      setCopied(false);
      setEmailSent(false);
    }
    onOpenChange(v);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Portaal activeren</SheetTitle>
          <SheetDescription>Activeer het medewerkerportaal en verstuur een uitnodiging.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label htmlFor="portal-email">E-mailadres</Label>
            <Input
              id="portal-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="medewerker@email.com"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="portal-lang">Portaaltaal</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger id="portal-lang">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nl">Nederlands</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Email template status */}
          <div className="flex items-center gap-2 text-xs">
            <Mail className="h-3 w-3" />
            {isConnected ? (
              inviteTemplate ? (
                <span className="text-muted-foreground">
                  Template: <strong>{inviteTemplate.name}</strong>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Standaard template (maak een 'Uitnodiging' template aan in <a href="/email/templates" className="underline">Email Templates</a>)
                </span>
              )
            ) : (
              <span className="text-muted-foreground">
                Outlook niet gekoppeld — link wordt getoond om te kopiëren
              </span>
            )}
          </div>

          {!inviteLink ? (
            <Button
              onClick={() => activate.mutate()}
              disabled={!email || activate.isPending}
              className="w-full gap-2"
            >
              {activate.isPending ? 'Bezig...' : (
                <>
                  {isConnected ? <Send className="h-4 w-4" /> : null}
                  {isConnected ? 'Activeren & e-mail versturen' : 'Activeren & link aanmaken'}
                </>
              )}
            </Button>
          ) : (
            <div className="space-y-3">
              {emailSent && (
                <Badge variant="default" className="gap-1 w-full justify-center py-2">
                  <Check className="h-3 w-3" /> Uitnodiging verstuurd naar {email}
                </Badge>
              )}

              <div className="bg-muted rounded-md p-3">
                <p className="text-xs text-muted-foreground mb-1">Uitnodigingslink</p>
                <p className="text-sm font-mono break-all">{inviteLink}</p>
              </div>
              <Button onClick={copyLink} variant="outline" className="w-full gap-2">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Gekopieerd!' : 'Link kopiëren'}
              </Button>
              {!emailSent && (
                <p className="text-xs text-muted-foreground">
                  {isConnected
                    ? 'E-mail versturen is mislukt. Stuur de link handmatig.'
                    : 'Stuur deze link handmatig via WhatsApp of email. De link is 7 dagen geldig.'}
                </p>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default PortalActivateSheet;
