import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { FileSpreadsheet, ExternalLink, Loader2, CheckCircle2, XCircle, RefreshCw, Bell } from 'lucide-react';
import ExactGLAccountMappings from './ExactGLAccountMappings';

const ExactOnlineSettings = () => {
  const orgId = useOrganizationId();
  const queryClient = useQueryClient();
  const [registering, setRegistering] = useState(false);

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
      const { data, error } = await supabase.functions.invoke('exact-register');
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['exact-config'] });
      toast.success('Exact Online tenant geregistreerd');
      if (data?.setup_url) {
        window.open(data.setup_url, 'exact-setup', 'width=600,height=700');
        const handler = (e: MessageEvent) => {
          if (e.data?.type === 'exact-connected') {
            queryClient.invalidateQueries({ queryKey: ['exact-config'] });
            toast.success('Exact Online gekoppeld!');
            window.removeEventListener('message', handler);
          }
        };
        window.addEventListener('message', handler);
      }
    },
    onError: (err: Error) => toast.error('Registratie mislukt: ' + err.message),
    onSettled: () => setRegistering(false),
  });

  // Reactivate webhook subscriptions
  const reactivateWebhooks = useMutation({
    mutationFn: async () => {
      // Trigger webhook subscription registration via exact-api proxy
      // This calls the Exact Online webhooks API to register subscriptions
      const topics = ['SalesInvoices', 'Accounts'];
      for (const topic of topics) {
        const { data, error } = await supabase.functions.invoke('exact-api', {
          body: {
            endpoint: 'webhooks/WebhookSubscriptions',
            method: 'POST',
            payload: {
              CallbackURL: 'https://xeshjkznwdrxjjhbpisn.supabase.co/functions/v1/exact-webhook-router',
              Topic: topic,
            },
          },
        });
        if (error) throw error;
        if (data?.error) console.warn(`Webhook ${topic}:`, data.error);
      }
    },
    onSuccess: () => toast.success('Webhook subscriptions geactiveerd'),
    onError: (e: any) => toast.error('Webhooks activeren mislukt: ' + e.message),
  });

  const openSetup = () => {
    if (!config?.tenant_id) return;
    window.open(
      `https://connect.sitejob.nl/exact-setup?tenant_id=${config.tenant_id}`,
      'exact-setup',
      'width=600,height=700'
    );
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'exact-connected') {
        queryClient.invalidateQueries({ queryKey: ['exact-config'] });
        toast.success('Exact Online gekoppeld!');
        window.removeEventListener('message', handler);
      }
    };
    window.addEventListener('message', handler);
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
          <div className="flex gap-2">
            {!isRegistered ? (
              <Button onClick={() => registerMutation.mutate()} disabled={registering} className="gap-2">
                {registering && <Loader2 className="h-4 w-4 animate-spin" />}
                Exact Online koppelen
              </Button>
            ) : !isConnected ? (
              <Button variant="outline" className="gap-2" onClick={openSetup}>
                <ExternalLink className="h-4 w-4" /> Setup voltooien
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
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {isConnected && <ExactGLAccountMappings />}
    </div>
  );
};

export default ExactOnlineSettings;
