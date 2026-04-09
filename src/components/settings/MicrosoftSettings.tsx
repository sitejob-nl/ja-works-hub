import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Mail, Loader2, CheckCircle2, XCircle, Unlink } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

const MicrosoftSettings = () => {
  const orgId = useOrganizationId();
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: config, isLoading } = useQuery({
    queryKey: ['microsoft-config', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('microsoft_config' as any)
        .select('*')
        .eq('organization_id', orgId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  // Handle redirect back from OAuth
  useEffect(() => {
    const microsoftParam = searchParams.get('microsoft');
    if (microsoftParam === 'connected') {
      queryClient.invalidateQueries({ queryKey: ['microsoft-config'] });
      toast.success('Microsoft 365 gekoppeld!');
      searchParams.delete('microsoft');
      setSearchParams(searchParams, { replace: true });
    } else if (microsoftParam === 'error') {
      const reason = searchParams.get('reason') || 'Onbekende fout';
      toast.error(`Microsoft koppeling mislukt: ${reason}`);
      searchParams.delete('microsoft');
      searchParams.delete('reason');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams]);

  const connectMutation = useMutation({
    mutationFn: async () => {
      setConnecting(true);
      const { data, error } = await supabase.functions.invoke('microsoft-auth');
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      if (data?.auth_url) {
        // Redirect to Microsoft OAuth
        window.location.href = data.auth_url;
      }
    },
    onError: (err: Error) => {
      toast.error('Koppeling starten mislukt: ' + err.message);
      setConnecting(false);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('microsoft_config' as any)
        .update({
          access_token: null,
          refresh_token: null,
          token_expires_at: null,
          microsoft_user_id: null,
          microsoft_email: null,
          microsoft_tenant_id: null,
          is_active: false,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('organization_id', orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['microsoft-config'] });
      toast.success('Microsoft 365 ontkoppeld');
    },
    onError: (err: Error) => toast.error('Ontkoppelen mislukt: ' + err.message),
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

  const isConnected = config?.is_active && config?.microsoft_email;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" /> Microsoft 365
        </CardTitle>
        <CardDescription>
          Koppel Outlook voor e-mail en agenda vanuit het systeem
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Status:</span>
          {isConnected ? (
            <Badge variant="default" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> Verbonden
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
                <p className="text-muted-foreground">Account</p>
                <p className="font-medium">{config.microsoft_email}</p>
              </div>
              {config.microsoft_tenant_id && (
                <div>
                  <p className="text-muted-foreground">Tenant ID</p>
                  <p className="font-medium font-mono text-xs truncate">{config.microsoft_tenant_id}</p>
                </div>
              )}
            </div>
          </>
        )}

        <Separator />
        <div className="flex gap-2">
          {!isConnected ? (
            <Button onClick={() => connectMutation.mutate()} disabled={connecting} className="gap-2">
              {connecting && <Loader2 className="h-4 w-4 animate-spin" />}
              Microsoft 365 koppelen
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => connectMutation.mutate()}
                disabled={connecting}
              >
                {connecting && <Loader2 className="h-4 w-4 animate-spin" />}
                Opnieuw koppelen
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 text-destructive hover:text-destructive"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                <Unlink className="h-4 w-4" /> Ontkoppelen
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default MicrosoftSettings;
