import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ClipboardCopy, Eye, Loader2, Mail, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useOutlookAccounts } from '@/hooks/useOutlookAccounts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toFriendlyError } from '@/lib/errorMessages';
import { invokeDomainManagement, type OrganizationDomain } from '@/lib/domains';

type PreviewResponse = {
  preview: true;
  subject: string;
  html: string;
  text: string;
};

type SendResponse = {
  sent: boolean;
  to?: string;
  from?: string | null;
  error?: string;
  communication_paused?: boolean;
};

type Props = {
  domain: OrganizationDomain;
  onSent: () => void;
};

/**
 * Mailt de DNS-instructies naar de partij die de zone beheert. Bedoeld voor organisaties
 * die niet zelf bij hun DNS kunnen en dat door een externe developer of hostingpartij
 * laten doen — die krijgt dan precies één mail met wat waar moet komen.
 *
 * De preview komt uit de edge function, niet uit een client-side kopie van de opmaak,
 * zodat wat je hier ziet exact is wat er verstuurd wordt.
 */
export default function SendDnsInstructionsDialog({ domain, onSent }: Props) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('bericht');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState<string | undefined>();

  const { usableAccounts, defaultAccountId, hasUsableAccounts, isLoading: accountsLoading } =
    useOutlookAccounts('mail_send');

  useEffect(() => {
    if (!accountId && defaultAccountId) setAccountId(defaultAccountId);
  }, [accountId, defaultAccountId]);

  const requestBody = (extra: Record<string, unknown>) => ({
    action: 'send_instructions',
    id: domain.id,
    to,
    cc: cc ? cc.split(/[,;]/) : [],
    note,
    ...extra,
  });

  const preview = useMutation({
    mutationFn: async () => invokeDomainManagement<PreviewResponse>(requestBody({ preview: true })),
    onError: (error: unknown) => toast.error(toFriendlyError(error)),
  });

  const send = useMutation({
    mutationFn: async () =>
      invokeDomainManagement<SendResponse>(requestBody({ account_id: accountId ?? null })),
    onSuccess: (result) => {
      onSent();
      if (result.communication_paused) {
        toast.warning('Uitgaande e-mail staat gepauzeerd voor deze organisatie — de mail is als concept gelogd.');
        return;
      }
      toast.success(`Instructies verstuurd naar ${result.to ?? to}`);
      close();
    },
    onError: (error: unknown) => toast.error(toFriendlyError(error)),
  });

  const close = () => {
    setOpen(false);
    setTab('bericht');
    setTo('');
    setCc('');
    setNote('');
    preview.reset();
  };

  // De preview hangt aan de ingevulde notitie, dus bij het openen van het tabblad
  // altijd opnieuw ophalen in plaats van een verouderde versie tonen.
  const openPreview = () => {
    setTab('voorbeeld');
    preview.mutate();
  };

  const copyText = async () => {
    const text = preview.data?.text;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toast.success('Tekst gekopieerd — klaar om te plakken');
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Mail className="h-3.5 w-3.5" /> Mail naar beheerder
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>DNS-instructies versturen</DialogTitle>
          <DialogDescription>
            Stuur de instellingen voor {domain.domain} naar degene die de DNS van{' '}
            {domain.apex_domain} beheert. De mail gaat vanuit je eigen gekoppelde mailbox.
          </DialogDescription>
        </DialogHeader>

        {!accountsLoading && !hasUsableAccounts && (
          <Alert variant="destructive">
            <AlertDescription>
              Er is nog geen mailbox gekoppeld die kan verzenden. Koppel eerst een mailaccount
              onder Instellingen → E-mail.
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={tab} onValueChange={(next) => (next === 'voorbeeld' ? openPreview() : setTab(next))}>
          <TabsList>
            <TabsTrigger value="bericht">Bericht</TabsTrigger>
            <TabsTrigger value="voorbeeld" className="gap-1.5">
              <Eye className="h-3.5 w-3.5" /> Voorbeeld
            </TabsTrigger>
          </TabsList>

          <TabsContent value="bericht" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="dns-to">E-mailadres beheerder</Label>
              <Input
                id="dns-to"
                type="email"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="developer@bureau.nl"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dns-cc">CC (optioneel)</Label>
              <Input
                id="dns-cc"
                value={cc}
                onChange={(event) => setCc(event.target.value)}
                placeholder={profile?.email ?? 'jij@bedrijf.nl'}
              />
              <p className="text-xs text-muted-foreground">Meerdere adressen scheiden met een komma.</p>
            </div>

            {usableAccounts.length > 1 && (
              <div className="space-y-2">
                <Label>Verzenden vanaf</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Kies een mailbox" />
                  </SelectTrigger>
                  <SelectContent>
                    {usableAccounts.map((account) => (
                      <SelectItem key={account.account_id} value={account.account_id}>
                        {account.email ?? account.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="dns-note">Persoonlijk bericht (optioneel)</Label>
              <Textarea
                id="dns-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                placeholder="Bijvoorbeeld: kun je dit deze week nog doorvoeren?"
              />
              <p className="text-xs text-muted-foreground">
                De records, TTL en uitleg staan al in de mail — dit komt er bovenop.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="voorbeeld" className="pt-4">
            {preview.isPending && (
              <div className="flex items-center gap-2 py-12 justify-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Voorbeeld ophalen...
              </div>
            )}

            {preview.isError && (
              <Alert variant="destructive">
                <AlertDescription>{toFriendlyError(preview.error)}</AlertDescription>
              </Alert>
            )}

            {preview.data && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm">
                    <span className="text-muted-foreground">Onderwerp: </span>
                    {preview.data.subject}
                  </p>
                  <Button variant="outline" size="sm" onClick={copyText} className="gap-2">
                    <ClipboardCopy className="h-3.5 w-3.5" /> Kopieer als tekst
                  </Button>
                </div>
                <iframe
                  title="Voorbeeld van de e-mail"
                  srcDoc={preview.data.html}
                  sandbox=""
                  className="h-[420px] w-full rounded-md border bg-white"
                />
                <p className="text-xs text-muted-foreground">
                  Dit is exact de mail die verstuurd wordt. "Kopieer als tekst" geeft dezelfde
                  instructies als platte tekst, bijvoorbeeld om via WhatsApp of een ticket te sturen.
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>Annuleren</Button>
          <Button
            onClick={() => send.mutate()}
            disabled={!to || send.isPending || !hasUsableAccounts}
            className="gap-2"
          >
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Versturen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
