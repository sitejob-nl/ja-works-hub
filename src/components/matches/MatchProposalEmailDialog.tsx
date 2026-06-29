import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Copy, ExternalLink, Loader2, Mail, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useOutboundPause } from '@/hooks/useOutboundPause';
import { useOutlookAccounts } from '@/hooks/useOutlookAccounts';
import { useRolePermission } from '@/hooks/usePermissions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

type RecipientOption = {
  email: string;
  name: string;
  is_primary: boolean;
};

type ProposalSections = {
  summary: boolean;
  profile: boolean;
  skills: boolean;
  certifications: boolean;
  languages: boolean;
  availability: boolean;
  positiveSignals: boolean;
  riskFactors: boolean;
  targetFunctions: boolean;
  interviewQuestions: boolean;
  matchReasoning: boolean;
  reliability: boolean;
};

const DEFAULT_PROPOSAL_SECTIONS: ProposalSections = {
  summary: true,
  profile: true,
  skills: true,
  certifications: true,
  languages: true,
  availability: true,
  positiveSignals: true,
  riskFactors: true,
  targetFunctions: true,
  interviewQuestions: false,
  matchReasoning: true,
  reliability: false,
};

const SECTION_OPTIONS: Array<{ key: keyof ProposalSections; label: string }> = [
  { key: 'summary', label: 'Samenvatting' },
  { key: 'profile', label: 'Profiel' },
  { key: 'skills', label: 'Vaardigheden' },
  { key: 'certifications', label: 'Certificaten' },
  { key: 'languages', label: 'Talen' },
  { key: 'availability', label: 'Beschikbaarheid' },
  { key: 'positiveSignals', label: 'Sterke signalen' },
  { key: 'riskFactors', label: 'Aandachtspunten' },
  { key: 'targetFunctions', label: 'Passende functies' },
  { key: 'interviewQuestions', label: 'Vragen' },
  { key: 'matchReasoning', label: 'Matchnotitie' },
  { key: 'reliability', label: 'Betrouwbaarheidsscore' },
];

type MatchProposalEmailDialogProps = {
  open: boolean;
  matchId: string | null;
  onOpenChange: (open: boolean) => void;
  onSent?: () => void;
};

const splitEmails = (value: string) => value.split(/[;,]/).map((item) => item.trim()).filter(Boolean);

const MatchProposalEmailDialog = ({ open, matchId, onOpenChange, onSent }: MatchProposalEmailDialogProps) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const { data: outboundPaused } = useOutboundPause(orgId);
  const canSendProposal = useRolePermission('matching.proposal.send');
  const { usableAccounts, defaultAccountId } = useOutlookAccounts('mail_send');
  const personalAccounts = usableAccounts.filter((account) => account.scope === 'personal');
  const orgAccounts = usableAccounts.filter((account) => account.scope === 'organization');

  const [mailAccountId, setMailAccountId] = useState<string | undefined>(undefined);
  const [mailTo, setMailTo] = useState('');
  const [mailCc, setMailCc] = useState('');
  const [mailBcc, setMailBcc] = useState('');
  const [mailSubject, setMailSubject] = useState('');
  const [introText, setIntroText] = useState('');
  const [closingText, setClosingText] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [proposalResponseUrl, setProposalResponseUrl] = useState('');
  const [proposalTokenId, setProposalTokenId] = useState<string | null>(null);
  const [mailRecipients, setMailRecipients] = useState<RecipientOption[]>([]);
  const [sections, setSections] = useState<ProposalSections>(DEFAULT_PROPOSAL_SECTIONS);
  const [previewLoading, setPreviewLoading] = useState(false);

  const selectedRecipient = useMemo(
    () => mailRecipients.find((recipient) => recipient.email === mailTo),
    [mailRecipients, mailTo],
  );

  const resetState = useCallback(() => {
    setMailAccountId(defaultAccountId);
    setMailTo('');
    setMailCc('');
    setMailBcc('');
    setMailSubject('');
    setIntroText('');
    setClosingText('');
    setPreviewHtml('');
    setProposalResponseUrl('');
    setProposalTokenId(null);
    setMailRecipients([]);
    setSections(DEFAULT_PROPOSAL_SECTIONS);
    setPreviewLoading(false);
  }, [defaultAccountId]);

  const loadPreview = useCallback(async (
    targetMatchId: string,
    nextSections: ProposalSections,
    opts: { resetTo?: boolean; intro?: string; closing?: string; syncText?: boolean; recipientEmail?: string; proposalTokenId?: string | null } = {},
  ) => {
    setPreviewLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-match-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          match_id: targetMatchId,
          preview: true,
          proposal_token_id: opts.proposalTokenId,
          recipient_email: opts.recipientEmail || undefined,
          include_sections: nextSections,
          intro_text: opts.intro,
          closing_text: opts.closing,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Kon preview niet laden');
      setMailSubject(json.subject ?? '');
      setPreviewHtml(json.html ?? '');
      setProposalResponseUrl(json.response_url ?? '');
      setProposalTokenId(json.proposal_token_id ?? null);
      setMailRecipients(json.recipients ?? []);
      if (opts.syncText !== false) {
        setIntroText(json.intro_text ?? '');
        setClosingText(json.closing_text ?? '');
      }
      if (opts.resetTo) setMailTo(json.to ?? '');
    } catch (error: any) {
      toast.error(error.message);
      onOpenChange(false);
    } finally {
      setPreviewLoading(false);
    }
  }, [onOpenChange]);

  useEffect(() => {
    if (!open || !matchId) return;
    setMailAccountId(defaultAccountId);
    setMailCc('');
    setMailBcc('');
    setSections(DEFAULT_PROPOSAL_SECTIONS);
    void loadPreview(matchId, DEFAULT_PROPOSAL_SECTIONS, { resetTo: true });
  }, [defaultAccountId, loadPreview, matchId, open]);

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetState();
    onOpenChange(nextOpen);
  };

  const handleSectionChange = (key: keyof ProposalSections, checked: boolean) => {
    const nextSections = { ...sections, [key]: checked };
    setSections(nextSections);
    if (matchId) void loadPreview(matchId, nextSections, {
      intro: introText,
      closing: closingText,
      syncText: false,
      recipientEmail: mailTo,
      proposalTokenId,
    });
  };

  const refreshPreview = () => {
    if (matchId) void loadPreview(matchId, sections, {
      intro: introText,
      closing: closingText,
      syncText: false,
      recipientEmail: mailTo,
      proposalTokenId,
    });
  };

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!canSendProposal) throw new Error('Je rol mag geen voorstelmails versturen');
      if (!matchId) throw new Error('Geen match geselecteerd');
      if (!mailTo.trim()) throw new Error('Vul een ontvanger in');
      if (!mailSubject.trim()) throw new Error('Vul een onderwerp in');
      if (!introText.trim()) throw new Error('Vul een introtekst in');

      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-match-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          match_id: matchId,
          account_id: mailAccountId ?? null,
          recipient_email: mailTo.trim(),
          cc: mailCc ? splitEmails(mailCc) : undefined,
          bcc: mailBcc ? splitEmails(mailBcc) : undefined,
          subject: mailSubject.trim(),
          proposal_token_id: proposalTokenId,
          intro_text: introText,
          closing_text: closingText,
          include_sections: sections,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.success === false) throw new Error(json.error ?? json.outlook_error ?? 'Fout bij versturen');
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['communications'] });
      onSent?.();
      toast.success('Voorstel verstuurd naar opdrachtgever');
      handleDialogOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const copyProposalLink = async () => {
    if (!proposalResponseUrl) return;
    await navigator.clipboard.writeText(proposalResponseUrl);
    toast.success('Klantlink gekopieerd');
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Voorstel versturen</DialogTitle>
          <DialogDescription>Controleer de preview, vink onderdelen aan of uit en pas de tekst aan voordat je verstuurt.</DialogDescription>
        </DialogHeader>

        {outboundPaused?.email === true && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>E-mail staat op pauze</AlertTitle>
            <AlertDescription>Je kunt de voorbereiding controleren, maar versturen is geblokkeerd door de outbound kill-switch.</AlertDescription>
          </Alert>
        )}

        {!canSendProposal && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Geen verzendrecht</AlertTitle>
            <AlertDescription>Je kunt de preview controleren, maar jouw rol mag geen voorstelmail naar opdrachtgevers versturen.</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="space-y-3">
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
              <Label className="text-xs text-muted-foreground">Aan</Label>
              {mailRecipients.length > 0 ? (
                <Select value={mailTo} onValueChange={setMailTo}>
                  <SelectTrigger><SelectValue placeholder="Kies ontvanger" /></SelectTrigger>
                  <SelectContent>
                    {mailRecipients.map((recipient) => (
                      <SelectItem key={recipient.email} value={recipient.email}>
                        {recipient.is_primary ? '* ' : ''}{recipient.name} &lt;{recipient.email}&gt;
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={mailTo} onChange={(event) => setMailTo(event.target.value)} placeholder="ontvanger@bedrijf.nl" />
              )}
              {selectedRecipient && <p className="text-xs text-muted-foreground">{selectedRecipient.name}</p>}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">CC</Label>
                <Input value={mailCc} onChange={(event) => setMailCc(event.target.value)} placeholder="optioneel" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">BCC</Label>
                <Input value={mailBcc} onChange={(event) => setMailBcc(event.target.value)} placeholder="optioneel" />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Onderwerp</Label>
              <Input value={mailSubject} onChange={(event) => setMailSubject(event.target.value)} />
            </div>

            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-medium">Onderdelen in voorstel</Label>
                <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={refreshPreview} disabled={previewLoading}>
                  <RefreshCw className="h-3.5 w-3.5" /> Ververs
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {SECTION_OPTIONS.map((option) => (
                  <label key={option.key} className="flex items-center gap-2 text-sm leading-none cursor-pointer">
                    <Checkbox checked={sections[option.key]} onCheckedChange={(value) => handleSectionChange(option.key, value === true)} />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Intro tekst</Label>
              <Textarea
                value={introText}
                onChange={(event) => setIntroText(event.target.value)}
                onBlur={refreshPreview}
                className="min-h-32 text-sm"
                placeholder="Schrijf hier de begeleidende tekst..."
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Afsluiting</Label>
              <Textarea
                value={closingText}
                onChange={(event) => setClosingText(event.target.value)}
                onBlur={refreshPreview}
                className="min-h-24 text-sm"
                placeholder="Schrijf hier de afsluitende tekst..."
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Preview</Label>
              {previewLoading && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Laden</span>}
            </div>
            {proposalResponseUrl && (
              <div className="rounded-md border bg-muted/20 p-3">
                <Label className="text-xs text-muted-foreground">Publieke klantlink</Label>
                <div className="mt-1 flex gap-2">
                  <Input value={proposalResponseUrl} readOnly className="h-9 bg-white text-xs" />
                  <Button type="button" variant="outline" size="icon" onClick={copyProposalLink} title="Kopieer klantlink">
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" asChild title="Open preview">
                    <a href={proposalResponseUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Deze link is publiek en werkt zonder klantaccount. Dezelfde link wordt gebruikt als je de mail verstuurt.
                </p>
              </div>
            )}
            <div className="overflow-hidden rounded-md border bg-white">
              {previewHtml ? (
                <iframe title="email-preview" srcDoc={previewHtml} sandbox="allow-popups allow-popups-to-escape-sandbox" className="h-[620px] w-full bg-white" />
              ) : (
                <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
                  Preview laden...
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleDialogOpenChange(false)}>Annuleren</Button>
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={!canSendProposal || !introText.trim() || !mailTo || sendMutation.isPending || outboundPaused?.email === true}
            className="gap-2"
          >
            {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            {!canSendProposal ? 'Geen verzendrecht' : outboundPaused?.email === true ? 'E-mail gepauzeerd' : sendMutation.isPending ? 'Versturen...' : 'Versturen naar opdrachtgever'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MatchProposalEmailDialog;
