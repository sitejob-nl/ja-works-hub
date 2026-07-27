import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Mail, Send } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { toFriendlyError } from '@/lib/errorMessages';
import { domainInstructions, invokeDomainManagement, recordLabel, type OrganizationDomain } from '@/lib/domains';

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
 */
export default function SendDnsInstructionsDialog({ domain, onSent }: Props) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState<string | undefined>();

  const { usableAccounts, defaultAccountId, hasUsableAccounts, isLoading: accountsLoading } =
    useOutlookAccounts('mail_send');
  const { records, warning } = domainInstructions(domain);

  useEffect(() => {
    if (!accountId && defaultAccountId) setAccountId(defaultAccountId);
  }, [accountId, defaultAccountId]);

  const send = useMutation({
    mutationFn: async () =>
      invokeDomainManagement<SendResponse>({
        action: 'send_instructions',
        id: domain.id,
        to,
        cc: cc ? cc.split(/[,;]/) : [],
        note,
        account_id: accountId ?? null,
      }),
    onSuccess: (result) => {
      onSent();
      if (result.communication_paused) {
        toast.warning('Uitgaande e-mail staat gepauzeerd voor deze organisatie — de mail is als concept gelogd.');
        return;
      }
      toast.success(`Instructies verstuurd naar ${result.to ?? to}`);
      setOpen(false);
      setTo('');
      setCc('');
      setNote('');
    },
    onError: (error: unknown) => toast.error(toFriendlyError(error)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Mail className="h-3.5 w-3.5" /> Mail naar beheerder
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
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

        <div className="space-y-4">
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
          </div>

          <div className="rounded-md border bg-muted/40 p-3 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Wat er meegaat
            </p>
            {records.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nog geen records bekend — doe eerst een Check op dit domein.
              </p>
            )}
            {records.map((record, index) => (
              <p key={index} className="font-mono text-xs break-all">{recordLabel(record)}</p>
            ))}
            {warning && <p className="text-xs text-orange-700 pt-1">Inclusief de waarschuwing over nameservers.</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Annuleren</Button>
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
