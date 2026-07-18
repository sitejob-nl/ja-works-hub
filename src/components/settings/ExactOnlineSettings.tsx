import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { AlertTriangle, Bell, ExternalLink, FileSpreadsheet, Loader2, CheckCircle2, ListChecks, RefreshCw, XCircle, Unlink } from 'lucide-react';
import ExactGLAccountMappings from './ExactGLAccountMappings';
import ExactVatCodeMappings from './ExactVatCodeMappings';
import { toExactErrorMessage } from '@/lib/exact-errors';

type ExactDiagnosticResult = {
  ok: boolean;
  division: number;
  region: string;
  base_url: string;
  expires_at: string;
  checks: Array<{ name: string; ok: boolean; status: number; error?: unknown }>;
};

type ExactWebhookResult = {
  ok: boolean;
  callback_url: string;
  results: Array<{ topic: string; ok: boolean; status: number; body?: string }>;
};

const ExactOnlineSettings = () => {
  const orgId = useOrganizationId();
  const queryClient = useQueryClient();
  const setupWindowRef = useRef<Window | null>(null);
  const [registering, setRegistering] = useState(false);
  const [diagnosticResult, setDiagnosticResult] = useState<ExactDiagnosticResult | null>(null);
  const [webhookResult, setWebhookResult] = useState<ExactWebhookResult | null>(null);

  const { data: config, isLoading } = useQuery({
    queryKey: ['exact-config', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exact_config' as any)
        .select('*')
        .eq('organization_id', orgId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      setRegistering(true);
      const { data, error } = await supabase.functions.invoke('exact-register', {
        body: { organization_id: orgId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['exact-config'] });
      toast.success('Exact Online tenant geregistreerd');
      if (data?.setup_url) {
        openSetupUrl(data.setup_url);
      }
    },
    onError: (err: Error) => {
      setupWindowRef.current?.close();
      setupWindowRef.current = null;
      toast.error('Registratie mislukt: ' + err.message);
    },
    onSettled: () => setRegistering(false),
  });

  // Reactivate webhook subscriptions
  const reactivateWebhooks = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('exact-api', {
        body: { action: 'reactivate_webhooks' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as ExactWebhookResult;
    },
    onSuccess: (data) => {
      setWebhookResult(data);
      const failed = data.results.filter((result) => !result.ok);
      if (failed.length > 0) {
        toast.warning(`Exact webhook aandacht nodig: ${failed.map((result) => `${result.topic} (${result.status || 'geen response'})`).join(', ')}`);
      } else {
        toast.success('Exact webhooks geactiveerd');
      }
    },
    onError: async (e: any) => toast.error(await toExactErrorMessage(e, 'Webhooks activeren mislukt')),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('exact-disconnect');
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exact-config'] });
      setDiagnosticResult(null);
      setWebhookResult(null);
      toast.success('Exact Online ontkoppeld');
    },
    onError: async (e: any) => toast.error(await toExactErrorMessage(e, 'Ontkoppelen mislukt')),
  });

  const testConnection = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('exact-api', {
        body: { action: 'diagnostics' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as ExactDiagnosticResult;
    },
    onSuccess: (data) => {
      setDiagnosticResult(data);
      if (data.ok) toast.success('Exact Online koppeling getest');
      else toast.error('Exact Online test heeft aandachtspunten');
    },
    onError: async (e: any) => {
      setDiagnosticResult(null);
      toast.error(await toExactErrorMessage(e, 'Exact test mislukt'));
    },
  });

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== 'exact-connected') return;
      queryClient.invalidateQueries({ queryKey: ['exact-config'] });
      setupWindowRef.current = null;
      toast.success('Exact Online gekoppeld!');
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [queryClient]);

  const prepareSetupPopup = () => {
    setupWindowRef.current = window.open('', 'exact-setup', 'width=600,height=700');
  };

  const openSetupUrl = (url: string) => {
    const popup = setupWindowRef.current && !setupWindowRef.current.closed
      ? setupWindowRef.current
      : window.open('', 'exact-setup', 'width=600,height=700');

    if (popup) {
      popup.location.href = url;
      popup.focus();
      setupWindowRef.current = popup;
    }
  };

  const startRegistration = () => {
    prepareSetupPopup();
    registerMutation.mutate();
  };

  const openSetup = () => {
    if (!config?.tenant_id) return;
    openSetupUrl(`https://connect.sitejob.nl/exact-setup?tenant_id=${config.tenant_id}`);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const isConnected = config?.is_active && config?.division;
  const isRegistered = config?.tenant_id;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="h-4 w-4" /> Exact Online
          </CardTitle>
          <CardDescription>
            Koppel je Exact Online administratie voor facturen, relaties en urenregistratie
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Status:</span>
            {isConnected ? (
              <Badge variant="default" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> Verbonden
              </Badge>
            ) : isRegistered ? (
              <Badge variant="secondary" className="gap-1">
                <RefreshCw className="h-3 w-3" /> Wacht op koppeling
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <XCircle className="h-3 w-3" /> Niet geconfigureerd
              </Badge>
            )}
          </div>

          {isConnected && (
            <>
              <Separator />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Administratie</p>
                  <p className="font-medium">{config.company_name || `Division ${config.division}`}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Regio</p>
                  <p className="font-medium uppercase">{config.region || 'nl'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Division</p>
                  <p className="font-medium font-mono text-xs">{config.division}</p>
                </div>
              </div>
            </>
          )}

          <Separator />
          <div className="flex flex-wrap gap-2">
            {!isRegistered ? (
              <Button onClick={startRegistration} disabled={registering} className="gap-2">
                {registering && <Loader2 className="h-4 w-4 animate-spin" />}
                Exact Online koppelen
              </Button>
            ) : !isConnected ? (
              <Button variant="outline" className="gap-2" onClick={startRegistration} disabled={registering}>
                {registering ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} Setup voltooien
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" className="gap-2" onClick={openSetup}>
                  <ExternalLink className="h-4 w-4" /> Beheer koppeling
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => reactivateWebhooks.mutate()}
                  disabled={reactivateWebhooks.isPending}
                >
                  <Bell className={`h-4 w-4 ${reactivateWebhooks.isPending ? 'animate-pulse' : ''}`} />
                  {reactivateWebhooks.isPending ? 'Activeren...' : 'Heractiveer webhooks'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => testConnection.mutate()}
                  disabled={testConnection.isPending}
                >
                  {testConnection.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
                  Test koppeling
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-destructive hover:text-destructive"
                  onClick={() => {
                    if (window.confirm('Weet je zeker dat je Exact Online wilt ontkoppelen?')) {
                      disconnectMutation.mutate();
                    }
                  }}
                  disabled={disconnectMutation.isPending}
                >
                  {disconnectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
                  Ontkoppelen
                </Button>
              </>
            )}
          </div>

          {diagnosticResult && (
            <div className={`rounded-md border p-3 ${diagnosticResult.ok ? 'border-green-200 bg-green-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
              <div className="mb-2 flex items-start gap-2">
                {diagnosticResult.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-700" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700" />
                )}
                <div>
                  <p className="text-sm font-medium">Live acceptatiecheck</p>
                  <p className="text-xs text-muted-foreground">
                    Division {diagnosticResult.division} · regio {diagnosticResult.region?.toUpperCase() || 'NL'}
                  </p>
                </div>
              </div>
              <div className="space-y-1">
                {diagnosticResult.checks.map((check) => (
                  <div key={check.name} className="flex items-center justify-between gap-3 text-xs">
                    <span>{check.name}</span>
                    <Badge variant={check.ok ? 'default' : 'destructive'}>{check.ok ? 'OK' : `HTTP ${check.status || '—'}`}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {webhookResult && (
            <div className={`rounded-md border p-3 ${webhookResult.ok ? 'border-green-200 bg-green-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
              <div className="mb-2 flex items-start gap-2">
                {webhookResult.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-700" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700" />
                )}
                <div>
                  <p className="text-sm font-medium">Webhookreactivatie</p>
                  <p className="break-all text-xs text-muted-foreground">{webhookResult.callback_url}</p>
                </div>
              </div>
              <div className="space-y-1">
                {webhookResult.results.map((result) => (
                  <div key={result.topic} className="flex items-center justify-between gap-3 text-xs">
                    <span>{result.topic}</span>
                    <Badge variant={result.ok ? 'default' : 'destructive'}>{result.ok ? 'OK' : `HTTP ${result.status || '—'}`}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {isConnected && <ExactGLAccountMappings />}
      {isConnected && <ExactVatCodeMappings />}
    </div>
  );
};

export default ExactOnlineSettings;
