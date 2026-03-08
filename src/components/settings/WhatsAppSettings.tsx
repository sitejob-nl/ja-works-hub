import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { MessageSquare, ExternalLink, Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';

const WhatsAppSettings = () => {
  const orgId = useOrganizationId();
  const queryClient = useQueryClient();
  const [registering, setRegistering] = useState(false);

  const { data: config, isLoading } = useQuery({
    queryKey: ['whatsapp-config', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('whatsapp_config' as any)
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
      const { data, error } = await supabase.functions.invoke('whatsapp-register');
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-config'] });
      toast.success('WhatsApp tenant geregistreerd');
      // Open setup URL
      if (data?.setup_url) {
        window.open(data.setup_url, '_blank');
      }
    },
    onError: (err: Error) => {
      toast.error('Registratie mislukt: ' + err.message);
    },
    onSettled: () => setRegistering(false),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const isConnected = config?.is_active && config?.phone_number_id;
  const isRegistered = config?.tenant_id;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4 text-green-600" /> WhatsApp Integratie
        </CardTitle>
        <CardDescription>
          Koppel je WhatsApp Business account om berichten te versturen en ontvangen
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Status:</span>
          {isConnected ? (
            <Badge variant="default" className="gap-1 bg-green-600">
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

        {/* Connected info */}
        {isConnected && (
          <>
            <Separator />
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Telefoonnummer</p>
                <p className="font-medium">{config.display_phone || '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">WABA ID</p>
                <p className="font-medium font-mono text-xs">{config.waba_id || '—'}</p>
              </div>
            </div>
          </>
        )}

        {/* Actions */}
        <Separator />
        <div className="flex gap-2">
          {!isRegistered ? (
            <Button
              onClick={() => registerMutation.mutate()}
              disabled={registering}
              className="gap-2"
            >
              {registering && <Loader2 className="h-4 w-4 animate-spin" />}
              WhatsApp koppelen
            </Button>
          ) : !isConnected ? (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() =>
                window.open(
                  `https://connect.sitejob.nl/whatsapp-setup?tenant_id=${config.tenant_id}`,
                  '_blank'
                )
              }
            >
              <ExternalLink className="h-4 w-4" /> Setup voltooien
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() =>
                window.open(
                  `https://connect.sitejob.nl/whatsapp-setup?tenant_id=${config.tenant_id}`,
                  '_blank'
                )
              }
            >
              <ExternalLink className="h-4 w-4" /> Beheer koppeling
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default WhatsAppSettings;
