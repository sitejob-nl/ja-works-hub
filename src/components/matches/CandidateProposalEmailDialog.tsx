// Kandidaat-voorstelmail (A2): bewerkbare preview van de baanvoorstel-mail naar de
// MEDEWERKER, gevoed uit de AI-gegenereerde vacaturetekst. Spiegelt het
// MatchProposalEmailDialog-patroon (server-rendered preview via de edge function,
// recruiter bewerkt, dan versturen). De interesse-knoppen in de mail verschuiven de
// match automatisch via /baan/interesse/:token.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileText, Loader2, Mail } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useOutboundPause } from '@/hooks/useOutboundPause';
import { useOutlookAccounts } from '@/hooks/useOutlookAccounts';
import { useRolePermission } from '@/hooks/usePermissions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

type CandidateProposalEmailDialogProps = {
  open: boolean;
  matchId: string | null;
  onOpenChange: (open: boolean) => void;
  onSent?: () => void;
};

const CandidateProposalEmailDialog = ({ open, matchId, onOpenChange, onSent }: CandidateProposalEmailDialogProps) => {
  const onOpenChangeRef = useRef(onOpenChange);
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const { data: outboundPaused } = useOutboundPause(orgId);
  const canSendProposal = useRolePermission('matching.proposal.send');
  const { usableAccounts, defaultAccountId } = useOutlookAccounts('mail_send');
  const personalAccounts = usableAccounts.filter((account) => account.scope === 'personal');
  const orgAccounts = usableAccounts.filter((account) => account.scope === 'organization');

  const [mailAccountId, setMailAccountId] = useState<string | undefined>(undefined);
  const [mailTo, setMailTo] = useState('');
  const [mailSubject, setMailSubject] = useState('');
  const [introText, setIntroText] = useState('');
  const [pitch, setPitch] = useState('');
  const [hasGeneratedText, setHasGeneratedText] = useState(true);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  const loadPreview = useCallback(async (
    targetMatchId: string,
    opts: { resetFields?: boolean; subject?: string; intro?: string; pitch?: string; recipient?: string } = {},
  ) => {
    setPreviewLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-candidate-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          match_id: targetMatchId,
          preview: true,
          subject: opts.subject,
          intro_text: opts.intro,
          pitch: opts.pitch,
          recipient_email: opts.recipient || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Kon preview niet laden');
      setPreviewHtml(json.html ?? '');
      setHasGeneratedText(json.has_generated_text !== false);
      if (opts.resetFields) {
        setMailTo(json.to ?? '');
        setMailSubject(json.subject ?? '');
        setIntroText(json.intro_text ?? '');
        setPitch(json.pitch ?? '');
      }
    } catch (error: any) {
      toast.error(error.message);
      onOpenChangeRef.current(false);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !matchId) return;
    setMailAccountId(undefined);
    void loadPreview(matchId, { resetFields: true });
  }, [loadPreview, matchId, open]);

  useEffect(() => {
    if (!open || !defaultAccountId) return;
    setMailAccountId((current) => current ?? defaultAccountId);
  }, [defaultAccountId, open]);

  const refreshPreview = () => {
    if (matchId) void loadPreview(matchId, { subject: mailSubject, intro: introText, pitch, recipient: mailTo });
  };

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!canSendProposal) throw new Error('Je rol mag geen voorstelmails versturen');
      if (!matchId) throw new Error('Geen match geselecteerd');
      if (!mailTo.trim()) throw new Error('Vul een ontvanger in');
      if (!mailSubject.trim()) throw new Error('Vul een onderwerp in');

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-candidate-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          match_id: matchId,
          account_id: mailAccountId ?? null,
          recipient_email: mailTo.trim(),
          subject: mailSubject.trim(),
          intro_text: introText,
          pitch,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.error ?? json.outlook_error ?? 'Fout bij versturen');
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['communications'] });
      onSent?.();
      toast.success('Baanvoorstel verstuurd naar de medewerker');
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94vh] w-[96vw] max-w-[1200px] flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Baanvoorstel naar medewerker</DialogTitle>
          <DialogDescription>
            De mail is gevuld met de AI-gegenereerde vacaturetekst en bevat interesse-knoppen die de match
            automatisch bijwerken. De opdrachtgever wordt niet genoemd.
          </DialogDescription>
        </DialogHeader>

        {outboundPaused?.email === true && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>E-mail staat op pauze</AlertTitle>
            <AlertDescription>Je kunt de voorbereiding controleren, maar versturen is geblokkeerd door de outbound kill-switch.</AlertDescription>
          </Alert>
        )}

        {!hasGeneratedText && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Nog geen gegenereerde vacaturetekst</AlertTitle>
            <AlertDescription>
              Genereer eerst een vacaturetekst (tab “Vacaturetekst” op de vacature) voor een sterkere pitch, of schrijf hieronder zelf een tekst.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(320px,0.9fr)_minmax(420px,1.1fr)]">
          <div className="space-y-3 rounded-lg border bg-muted/15 p-4">
            {usableAccounts.length > 1 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Afzender</Label>
                <Select value={mailAccountId} onValueChange={setMailAccountId}>
                  <SelectTrigger><SelectValue placeholder="Kies afzender-mailbox" /></SelectTrigger>
                  <SelectContent>
                    {personalAccounts.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Persoonlijk</SelectLabel>
                        {personalAccounts.map((account) => (
                          <SelectItem key={account.account_id} value={account.account_id}>
                            {account.label || account.email || 'Persoonlijke mailbox'}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {orgAccounts.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Bedrijf</SelectLabel>
                        {orgAccounts.map((account) => (
                          <SelectItem key={account.account_id} value={account.account_id}>
                            {account.label || account.email || 'Bedrijfsmailbox'}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Aan (medewerker)</Label>
              <Input value={mailTo} onChange={(event) => setMailTo(event.target.value)} placeholder="medewerker@voorbeeld.nl" />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Onderwerp</Label>
              <Input value={mailSubject} onChange={(event) => setMailSubject(event.target.value)} />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Korte intro</Label>
              <Textarea
                value={introText}
                onChange={(event) => setIntroText(event.target.value)}
                className="min-h-16 text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Baanomschrijving (pitch)</Label>
              <Textarea
                value={pitch}
                onChange={(event) => setPitch(event.target.value)}
                className="min-h-48 text-sm"
                placeholder="De pitch uit de gegenereerde vacaturetekst; hier aan te passen."
              />
            </div>

            <Button type="button" variant="outline" onClick={refreshPreview} disabled={previewLoading} className="w-full gap-2">
              {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              E-mailvoorbeeld bijwerken
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border bg-white">
            <div className="border-b px-3 py-2 text-sm font-medium">Preview e-mail</div>
            {previewHtml ? (
              <iframe title="candidate-email-preview" srcDoc={previewHtml} sandbox="allow-popups allow-popups-to-escape-sandbox" className="h-[620px] w-full bg-white" />
            ) : (
              <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">Preview laden...</div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annuleren</Button>
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={!canSendProposal || !mailTo.trim() || sendMutation.isPending || outboundPaused?.email === true}
            className="gap-2"
          >
            {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            {!canSendProposal ? 'Geen verzendrecht' : outboundPaused?.email === true ? 'E-mail gepauzeerd' : sendMutation.isPending ? 'Versturen...' : 'Versturen naar medewerker'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CandidateProposalEmailDialog;
