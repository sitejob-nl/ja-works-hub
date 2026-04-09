import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Mail, Loader2, CheckCircle2, XCircle, Unlink, Building2, User } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

const MicrosoftSettings = () => {
  const orgId = useOrganizationId();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);
  const [connectingPersonal, setConnectingPersonal] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = profile?.role === 'admin';

  // Fetch org-wide config (user_id IS NULL)
  const { data: orgConfig, isLoading: loadingOrg } = useQuery({
    queryKey: ['microsoft-config-org', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('microsoft_config' as any)
        .select('*')
        .eq('organization_id', orgId)
        .is('user_id', null)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  // Fetch personal config
  const { data: personalConfig, isLoading: loadingPersonal } = useQuery({
    queryKey: ['microsoft-config-personal', orgId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('microsoft_config' as any)
        .select('*')
        .eq('organization_id', orgId)
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: !!user?.id,
  });

  // Handle redirect back from OAuth
  useEffect(() => {
    const microsoftParam = searchParams.get('microsoft');
    if (microsoftParam === 'connected') {
      queryClient.invalidateQueries({ queryKey: ['microsoft-config-org'] });
      queryClient.invalidateQueries({ queryKey: ['microsoft-config-personal'] });
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

  const connectOrg = useMutation({
    mutationFn: async () => {
      setConnecting(true);
      const { data, error } = await supabase.functions.invoke('microsoft-auth', {
        body: { organization_id: orgId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => { if (data?.auth_url) window.location.href = data.auth_url; },
    onError: (err: Error) => { toast.error('Koppeling mislukt: ' + err.message); setConnecting(false); },
  });

  const connectPersonal = useMutation({
    mutationFn: async () => {
      setConnectingPersonal(true);
      const { data, error } = await supabase.functions.invoke('microsoft-auth', {
        body: { organization_id: orgId, user_id: user!.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => { if (data?.auth_url) window.location.href = data.auth_url; },
    onError: (err: Error) => { toast.error('Koppeling mislukt: ' + err.message); setConnectingPersonal(false); },
  });

  const disconnectOrg = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('microsoft_config' as any)
        .update({ access_token: null, refresh_token: null, token_expires_at: null, microsoft_user_id: null, microsoft_email: null, microsoft_tenant_id: null, is_active: false, updated_at: new Date().toISOString() } as any)
        .eq('organization_id', orgId)
        .is('user_id', null);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['microsoft-config-org'] }); toast.success('Organisatie-koppeling ontkoppeld'); },
    onError: (err: Error) => toast.error(err.message),
  });

  const disconnectPersonal = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('microsoft_config' as any)
        .update({ access_token: null, refresh_token: null, token_expires_at: null, microsoft_user_id: null, microsoft_email: null, microsoft_tenant_id: null, is_active: false, updated_at: new Date().toISOString() } as any)
        .eq('organization_id', orgId)
        .eq('user_id', user!.id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['microsoft-config-personal'] }); toast.success('Persoonlijke koppeling ontkoppeld'); },
    onError: (err: Error) => toast.error(err.message),
  });

  if (loadingOrg || loadingPersonal) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const orgConnected = orgConfig?.is_active && orgConfig?.microsoft_email;
  const personalConnected = personalConfig?.is_active && personalConfig?.microsoft_email;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" /> Microsoft 365
        </CardTitle>
        <CardDescription>
          Koppel Outlook voor e-mail en agenda. Organisatie-breed voor systeemmails, of persoonlijk voor je eigen inbox.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Org-wide connection (admin only to set up, visible to all) */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Organisatie account</span>
            <span className="text-xs text-muted-foreground">(systeemmails, campagnes, uitnodigingen)</span>
          </div>

          <div className="flex items-center gap-3 ml-6">
            <span className="text-sm text-muted-foreground">Status:</span>
            {orgConnected ? (
              <Badge variant="default" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> {orgConfig.microsoft_email}
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <XCircle className="h-3 w-3" /> Niet gekoppeld
              </Badge>
            )}
          </div>

          <div className="flex gap-2 ml-6">
            {isAdmin && (
              <>
                {!orgConnected ? (
                  <Button onClick={() => connectOrg.mutate()} disabled={connecting} size="sm" className="gap-2">
                    {connecting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Organisatie koppelen
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" size="sm" onClick={() => connectOrg.mutate()} disabled={connecting} className="gap-2">
                      {connecting && <Loader2 className="h-4 w-4 animate-spin" />}
                      Opnieuw koppelen
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive gap-1" onClick={() => disconnectOrg.mutate()}>
                      <Unlink className="h-3 w-3" /> Ontkoppelen
                    </Button>
                  </>
                )}
              </>
            )}
            {!isAdmin && !orgConnected && (
              <p className="text-xs text-muted-foreground">Vraag een admin om het organisatie-account te koppelen</p>
            )}
          </div>
        </div>

        <Separator />

        {/* Personal connection */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Persoonlijk account</span>
            <span className="text-xs text-muted-foreground">(jouw eigen Outlook inbox & agenda)</span>
          </div>

          <div className="flex items-center gap-3 ml-6">
            <span className="text-sm text-muted-foreground">Status:</span>
            {personalConnected ? (
              <Badge variant="default" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> {personalConfig.microsoft_email}
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <XCircle className="h-3 w-3" /> Niet gekoppeld
              </Badge>
            )}
          </div>

          <div className="flex gap-2 ml-6">
            {!personalConnected ? (
              <Button onClick={() => connectPersonal.mutate()} disabled={connectingPersonal} size="sm" variant="outline" className="gap-2">
                {connectingPersonal && <Loader2 className="h-4 w-4 animate-spin" />}
                Mijn Outlook koppelen
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => connectPersonal.mutate()} disabled={connectingPersonal} className="gap-2">
                  {connectingPersonal && <Loader2 className="h-4 w-4 animate-spin" />}
                  Opnieuw koppelen
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive gap-1" onClick={() => disconnectPersonal.mutate()}>
                  <Unlink className="h-3 w-3" /> Ontkoppelen
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default MicrosoftSettings;
