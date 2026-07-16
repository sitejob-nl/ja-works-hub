import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileText, Loader2, Mail, Monitor } from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import ProposalPageEditor from '@/components/matches/ProposalPageEditor';
import {
  DEFAULT_PROPOSAL_PAGE_CONFIG,
  mergeProposalPageConfig,
  type ProposalPageConfig,
} from '@/lib/proposal-page';
import { toast } from 'sonner';

type RecipientOption = {
  email: string;
  name: string;
  is_primary: boolean;
};

const MINIMAL_EMAIL_SECTIONS = {
  summary: false,
  profile: false,
  skills: false,
  certifications: false,
  languages: false,
  availability: false,
  positiveSignals: false,
  riskFactors: false,
  targetFunctions: false,
  interviewQuestions: false,
  matchReasoning: false,
  reliability: false,
};

type MatchProposalEmailDialogProps = {
  open: boolean;
  matchId: string | null;
  onOpenChange: (open: boolean) => void;
  onSent?: () => void;
};

const splitEmails = (value: string) => value.split(/[;,]/).map((item) => item.trim()).filter(Boolean);

const MatchProposalEmailDialog = ({ open, matchId, onOpenChange, onSent }: MatchProposalEmailDialogProps) => {
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
  const [mailCc, setMailCc] = useState('');
  const [mailBcc, setMailBcc] = useState('');
  const [mailSubject, setMailSubject] = useState('');
  const [introText, setIntroText] = useState('');
  const [closingText, setClosingText] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [proposalResponseUrl, setProposalResponseUrl] = useState('');
  const [proposalTokenId, setProposalTokenId] = useState<string | null>(null);
  const [mailRecipients, setMailRecipients] = useState<RecipientOption[]>([]);
  const [pageConfig, setPageConfig] = useState<ProposalPageConfig>(DEFAULT_PROPOSAL_PAGE_CONFIG);
  const [pagePreviewRevision, setPagePreviewRevision] = useState(0);
  const [pageDirty, setPageDirty] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  const selectedRecipient = useMemo(
    () => mailRecipients.find((recipient) => recipient.email === mailTo),
    [mailRecipients, mailTo],
  );

  const resetState = useCallback(() => {
    setMailAccountId(undefined);
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
    setPageConfig(DEFAULT_PROPOSAL_PAGE_CONFIG);
    setPagePreviewRevision(0);
    setPageDirty(false);
    setPreviewLoading(false);
  }, []);

  const loadPreview = useCallback(async (
    targetMatchId: string,
    nextPageConfig: ProposalPageConfig,
    opts: {
      resetTo?: boolean;
      intro?: string;
      closing?: string;
      subject?: string;
      syncText?: boolean;
      syncSubject?: boolean;
      syncPage?: boolean;
      recipientEmail?: string;
      proposalTokenId?: string | null;
    } = {},
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
          include_sections: MINIMAL_EMAIL_SECTIONS,
          proposal_page: nextPageConfig,
          subject: opts.subject,
          intro_text: opts.intro,
          closing_text: opts.closing,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Kon preview niet laden');
      if (opts.syncSubject !== false) setMailSubject(json.subject ?? '');
      setPreviewHtml(json.html ?? '');
      setProposalResponseUrl(json.response_url ?? '');
      setProposalTokenId(json.proposal_token_id ?? null);
      setMailRecipients(json.recipients ?? []);
      if (opts.syncPage !== false) setPageConfig(mergeProposalPageConfig(json.proposal_page));
      setPagePreviewRevision((revision) => revision + 1);
      setPageDirty(false);
      if (opts.syncText !== false) {
        setIntroText(json.intro_text ?? '');
        setClosingText(json.closing_text ?? '');
      }
      if (opts.resetTo) setMailTo(json.to ?? '');
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
    setMailCc('');
    setMailBcc('');
    setPageConfig(DEFAULT_PROPOSAL_PAGE_CONFIG);
    void loadPreview(matchId, DEFAULT_PROPOSAL_PAGE_CONFIG, { resetTo: true, syncPage: true });
  }, [loadPreview, matchId, open]);

  useEffect(() => {
    if (!open || !defaultAccountId) return;
    setMailAccountId((current) => current ?? defaultAccountId);
  }, [defaultAccountId, open]);

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetState();
    onOpenChange(nextOpen);
  };

  const refreshPreview = () => {
    if (matchId) void loadPreview(matchId, pageConfig, {
      intro: introText,
      closing: closingText,
      subject: mailSubject,
      syncText: false,
      syncSubject: false,
      syncPage: false,
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
          include_sections: MINIMAL_EMAIL_SECTIONS,
          proposal_page: pageConfig,
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
      <DialogContent className="flex max-h-[94vh] w-[96vw] max-w-[1500px] flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Voorstel versturen</DialogTitle>
          <DialogDescription>Houd de e-mail kort en bepaal afzonderlijk wat de opdrachtgever op de klantpagina ziet.</DialogDescription>
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

        <Tabs defaultValue="klantpagina" className="space-y-4">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="email" className="gap-2"><Mail className="h-4 w-4" /> E-mail</TabsTrigger>
            <TabsTrigger value="klantpagina" className="gap-2"><Monitor className="h-4 w-4" /> Klantpagina</TabsTrigger>
          </TabsList>

          <TabsContent value="email" className="mt-0">
            <div className="grid gap-4 lg:grid-cols-[minmax(320px,0.8fr)_minmax(460px,1.2fr)]">
              <div className="space-y-3 rounded-lg border bg-muted/15 p-4">
                <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
                  De e-mail bevat alleen de kandidaat, functie, een korte toelichting en de knop naar de klantpagina.
                </div>

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

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Korte begeleidende tekst</Label>
                  <Textarea
                    value={introText}
                    onChange={(event) => setIntroText(event.target.value)}
                    className="min-h-32 text-sm"
                    placeholder="Schrijf hier de korte begeleidende tekst..."
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Tekst boven de knop</Label>
                  <Textarea
                    value={closingText}
                    onChange={(event) => setClosingText(event.target.value)}
                    className="min-h-20 text-sm"
                    placeholder="Nodig de opdrachtgever uit om het voorstel te bekijken."
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
                  <iframe title="email-preview" srcDoc={previewHtml} sandbox="allow-popups allow-popups-to-escape-sandbox" className="h-[680px] w-full bg-white" />
                ) : (
                  <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">Preview laden...</div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="klantpagina" className="mt-0">
            <ProposalPageEditor
              config={pageConfig}
              responseUrl={proposalResponseUrl}
              previewRevision={pagePreviewRevision}
              loading={previewLoading}
              dirty={pageDirty}
              onChange={(nextConfig) => {
                setPageConfig(nextConfig);
                setPageDirty(true);
              }}
              onRefresh={refreshPreview}
              onCopyLink={copyProposalLink}
            />
          </TabsContent>
        </Tabs>

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
