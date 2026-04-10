import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Phone, CheckCircle2, XCircle, Loader2, Unlink, RefreshCw } from 'lucide-react';

const VoysSettings = () => {
  const orgId = useOrganizationId();
  const queryClient = useQueryClient();
  const [apiToken, setApiToken] = useState('');
  const [connecting, setConnecting] = useState(false);

  const { data: config, isLoading } = useQuery({
    queryKey: ['voys-config', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('voys_config' as any)
        .select('id, organization_id, client_uuid, client_id, user_uuid, is_connected, connected_at, last_sync_at, created_at, updated_at')
        .eq('organization_id', orgId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      setConnecting(true);
      // Validate the token by calling Voys API via our edge function
      const { data, error } = await supabase.functions.invoke('voys-api', {
        body: {
          endpoint: 'users/auth-context',
          method: 'GET',
          api_token: apiToken,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Extract client_uuid and user_uuid from auth context
      const clientUuid = data.client_uuid;
      const userUuid = data.uuid;

      // Get user details for client_id
      let clientId = null;
      if (userUuid) {
        const { data: userDetails } = await supabase.functions.invoke('voys-api', {
          body: {
            endpoint: `user/${userUuid}/details/`,
            method: 'GET',
            api_token: apiToken,
          },
        });
        clientId = userDetails?.client?.id || null;
      }

      // Upsert voys_config
      if (config?.id) {
        const { error: updateError } = await supabase
          .from('voys_config' as any)
          .update({
            api_token: apiToken,
            client_uuid: clientUuid,
            client_id: clientId,
            user_uuid: userUuid,
            is_connected: true,
            connected_at: new Date().toISOString(),
          } as any)
          .eq('id', config.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('voys_config' as any)
          .insert({
            organization_id: orgId,
            api_token: apiToken,
            client_uuid: clientUuid,
            client_id: clientId,
            user_uuid: userUuid,
            is_connected: true,
            connected_at: new Date().toISOString(),
          } as any);
        if (insertError) throw insertError;
      }

      return { clientUuid, userUuid, clientId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voys-config'] });
      toast.success('Voys succesvol verbonden');
      setApiToken('');
    },
    onError: (err: Error) => {
      toast.error('Verbinding mislukt: ' + err.message);
    },
    onSettled: () => setConnecting(false),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('voys_config' as any)
        .update({
          is_connected: false,
          client_uuid: null,
          client_id: null,
          user_uuid: null,
        } as any)
        .eq('organization_id', orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voys-config'] });
      toast.success('Voys ontkoppeld');
    },
    onError: (err: Error) => {
      toast.error('Ontkoppelen mislukt: ' + err.message);
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('voys-sync-calls');
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['voys-config'] });
      queryClient.invalidateQueries({ queryKey: ['communications'] });
      toast.success(`${data?.synced ?? 0} gesprekken gesynchroniseerd`);
    },
    onError: (err: Error) => {
      toast.error('Synchronisatie mislukt: ' + err.message);
    },
  });

  const isConnected = config?.is_connected;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Laden...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Phone className="h-4 w-4" /> Voys Telefonie
            </CardTitle>
            <CardDescription>
              Koppel Voys voor automatische gespreksregistratie met transcripties en samenvattingen
            </CardDescription>
          </div>
          {isConnected ? (
            <Badge variant="default" className="bg-green-600 hover:bg-green-700">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Verbonden
            </Badge>
          ) : (
            <Badge variant="secondary">
              <XCircle className="h-3 w-3 mr-1" /> Niet verbonden
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isConnected ? (
          <>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {config?.client_uuid && (
                <div>
                  <Label className="text-muted-foreground text-xs">Client UUID</Label>
                  <p className="font-mono text-xs">{config.client_uuid}</p>
                </div>
              )}
              {config?.client_id && (
                <div>
                  <Label className="text-muted-foreground text-xs">Client ID</Label>
                  <p className="font-mono text-xs">{config.client_id}</p>
                </div>
              )}
              {config?.connected_at && (
                <div>
                  <Label className="text-muted-foreground text-xs">Verbonden sinds</Label>
                  <p className="text-xs">{new Date(config.connected_at).toLocaleDateString('nl-NL')}</p>
                </div>
              )}
              {config?.last_sync_at && (
                <div>
                  <Label className="text-muted-foreground text-xs">Laatste sync</Label>
                  <p className="text-xs">{new Date(config.last_sync_at).toLocaleString('nl-NL')}</p>
                </div>
              )}
            </div>

            <Separator />

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
              >
                {syncMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                )}
                Gesprekken synchroniseren
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                <Unlink className="h-3.5 w-3.5 mr-1.5" /> Ontkoppelen
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Voer je Voys API token in. Je vindt deze in Freedom onder{' '}
              <strong>Persoonlijke instellingen</strong>. Je gebruiker moet admin-rechten
              hebben met toegang tot gespreksopnames.
            </p>
            <div className="space-y-2">
              <Label>API Token</Label>
              <Input
                type="password"
                placeholder="Voer je Voys API token in..."
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
              />
            </div>
            <Button
              onClick={() => connectMutation.mutate()}
              disabled={!apiToken.trim() || connecting}
            >
              {connecting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Phone className="h-4 w-4 mr-2" />
              )}
              Verbinden met Voys
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default VoysSettings;
