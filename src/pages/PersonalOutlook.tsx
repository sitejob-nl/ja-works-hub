import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CalendarCheck, CheckCircle2, Loader2, Mail, RotateCcw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { invokeOutlookFunction, useOutlookAccounts } from '@/hooks/useOutlookAccounts';
import { usePublicUrl } from '@/hooks/usePublicUrl';

const PersonalOutlook = () => {
  const { profile } = useAuth();
  const { buildUrl } = usePublicUrl();
  const outlook = useOutlookAccounts('any');
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const personalAccount = outlook.accounts.find((account) => account.scope === 'personal');

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let changed = false;

    if (searchParams.get('outlook_connected') === '1') {
      toast.success('Je persoonlijke Outlook is gekoppeld');
      queryClient.invalidateQueries({ queryKey: ['outlook-accounts-visible'] });
      next.delete('outlook_connected');
      next.delete('outlook_scope');
      changed = true;
    }

    if (searchParams.get('outlook_error')) {
      toast.error(searchParams.get('outlook_error_description') || 'Outlook koppelen mislukt');
      next.delete('outlook_error');
      next.delete('outlook_error_description');
      next.delete('outlook_scope');
      changed = true;
    }

    if (changed) setSearchParams(next, { replace: true });
  }, [queryClient, searchParams, setSearchParams]);

  const connect = useMutation({
    mutationFn: () => invokeOutlookFunction<{ authorization_url: string }>('outlook-start', {
      scope: 'personal',
      return_to: buildUrl('/mijn-outlook'),
      force_consent: Boolean(personalAccount),
      login_hint: personalAccount?.email || profile?.email || undefined,
    }),
    onSuccess: ({ authorization_url }) => {
      window.location.assign(authorization_url);
    },
    onError: (error: Error) => toast.error(`Outlook koppelen mislukt: ${error.message}`),
  });

  const connected = personalAccount?.microsoft_access_ok === true;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Mijn Outlook</h1>
        <p className="text-sm text-muted-foreground">
          Koppel je persoonlijke mailbox en agenda. Deze toegang staat los van je rol en overige rechten.
        </p>
      </div>

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Persoonlijk en afgeschermd</AlertTitle>
        <AlertDescription>
          Alleen jij kunt je persoonlijke mailbox en agenda gebruiken. Bedrijfsmail en gedeelde mailboxen blijven
          afzonderlijk door een admin beheerd.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-4 w-4" /> Persoonlijke Microsoft 365-koppeling
              </CardTitle>
              <CardDescription>
                {personalAccount?.email || 'Er is nog geen persoonlijke mailbox gekoppeld.'}
              </CardDescription>
            </div>
            <Badge variant={connected ? 'default' : 'outline'}>
              {connected ? 'Gekoppeld' : personalAccount ? 'Opnieuw koppelen' : 'Niet gekoppeld'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {personalAccount?.status_reason && !connected && (
            <Alert variant="destructive">
              <AlertTitle>Koppeling vereist aandacht</AlertTitle>
              <AlertDescription>{personalAccount.status_reason}</AlertDescription>
            </Alert>
          )}

          {connected && (
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5">
                <CheckCircle2 className="h-4 w-4 text-primary" /> Mail gekoppeld
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5">
                <CalendarCheck className="h-4 w-4 text-primary" /> Agenda gekoppeld
              </span>
            </div>
          )}

          <Button onClick={() => connect.mutate()} disabled={connect.isPending || outlook.isLoading} className="gap-2">
            {connect.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : personalAccount ? (
              <RotateCcw className="h-4 w-4" />
            ) : (
              <Mail className="h-4 w-4" />
            )}
            {personalAccount ? 'Persoonlijke Outlook herkoppelen' : 'Persoonlijke Outlook koppelen'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default PersonalOutlook;
