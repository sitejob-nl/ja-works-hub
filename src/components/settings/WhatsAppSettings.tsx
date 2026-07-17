import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useWhatsAppQuery, useWhatsAppMutation } from '@/hooks/useWhatsAppApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { MessageSquare, ExternalLink, Loader2, CheckCircle2, XCircle, RefreshCw, Unlink, RefreshCcw, User } from 'lucide-react';
import WhatsAppAutomationSettings from './WhatsAppAutomationSettings';

const VERTICAL_OPTIONS = [
  { value: 'UNDEFINED', label: 'Niet opgegeven' },
  { value: 'OTHER', label: 'Overig' },
  { value: 'AUTO', label: 'Automotive' },
  { value: 'BEAUTY', label: 'Beauty & verzorging' },
  { value: 'APPAREL', label: 'Kleding & mode' },
  { value: 'EDU', label: 'Onderwijs' },
  { value: 'ENTERTAIN', label: 'Entertainment' },
  { value: 'EVENT_PLAN', label: 'Evenementenplanning' },
  { value: 'FINANCE', label: 'Financiën' },
  { value: 'GROCERY', label: 'Supermarkt' },
  { value: 'GOVT', label: 'Overheid' },
  { value: 'HOTEL', label: 'Hotel & verblijf' },
  { value: 'HEALTH', label: 'Gezondheid' },
  { value: 'NONPROFIT', label: 'Non-profit' },
  { value: 'PROF_SERVICES', label: 'Professionele diensten' },
  { value: 'RETAIL', label: 'Retail' },
  { value: 'TRAVEL', label: 'Reizen' },
  { value: 'RESTAURANT', label: 'Restaurant' },
  { value: 'NOT_A_BIZ', label: 'Geen bedrijf' },
];

function functionErrorMessage(data: any, fallback: string) {
  const raw = data?.error ?? data?.message ?? fallback;
  return typeof raw === 'string' ? raw : raw?.message || fallback;
}

async function readFunctionError(error: any, fallback: string) {
  const response = error?.context;
  if (!response || typeof response.clone !== 'function') return error?.message || fallback;

  try {
    const data = await response.clone().json();
    return functionErrorMessage(data, fallback);
  } catch {
    return error?.message || fallback;
  }
}

async function invokeWhatsAppFunction<T = any>(functionName: string, body?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, body ? { body } : undefined);
  if (error) throw new Error(await readFunctionError(error, 'WhatsApp actie mislukt'));
  if ((data as any)?.error) throw new Error(functionErrorMessage(data, 'WhatsApp actie mislukt'));
  return data as T;
}

// ── Section 2: Account Status ──────────────────────────────────────────────

function AccountStatusSection() {
  const { data, isLoading } = useWhatsAppQuery('get_phone_status', undefined, { enabled: true });

  const qualityColor = (rating: string) => {
    if (rating === 'HIGH') return 'bg-green-600 text-white';
    if (rating === 'MEDIUM') return 'bg-yellow-500 text-white';
    return 'bg-red-600 text-white';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Account Status</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">Geen statusdata beschikbaar.</p>
        ) : (
          <div className="space-y-4">
            {data.verified_name && (
              <div>
                <p className="text-muted-foreground text-xs">Geverifieerde naam</p>
                <p className="font-semibold text-base">{data.verified_name}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-sm">
              {data.display_phone_number && (
                <div>
                  <p className="text-muted-foreground">Telefoonnummer</p>
                  <p className="font-medium">{data.display_phone_number}</p>
                </div>
              )}
              {data.platform_type && (
                <div>
                  <p className="text-muted-foreground">Platform</p>
                  <p className="font-medium">{data.platform_type}</p>
                </div>
              )}
              {data.name_status && (
                <div>
                  <p className="text-muted-foreground">Naamstatus</p>
                  <p className="font-medium">{data.name_status}</p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {data.quality_rating && (
                <Badge className={qualityColor(data.quality_rating)}>
                  Kwaliteit: {data.quality_rating}
                </Badge>
              )}
              {data.is_official_business_account && (
                <Badge className="gap-1 bg-green-600 text-white">
                  <CheckCircle2 className="h-3 w-3" /> Officieel bedrijfsaccount
                </Badge>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section 3: Business Profile ────────────────────────────────────────────

function BusinessProfileSection() {
  const profileQuery = useWhatsAppQuery('get_profile', undefined, { enabled: true });
  const { data: profileData, isLoading } = profileQuery;
  const updateMutation = useWhatsAppMutation('update_profile');

  const [about, setAbout] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [websites, setWebsites] = useState<string>('');
  const [vertical, setVertical] = useState<string>('UNDEFINED');
  const [initialized, setInitialized] = useState(false);

  // Pre-fill form once profile loads
  if (profileData && !initialized) {
    setAbout(profileData.about ?? '');
    setAddress(profileData.address ?? '');
    setEmail(profileData.email ?? '');
    setWebsites(Array.isArray(profileData.websites) ? profileData.websites.join(', ') : (profileData.websites ?? ''));
    setVertical(profileData.vertical ?? 'UNDEFINED');
    setInitialized(true);
  }

  const handleSave = () => {
    const websiteArray = websites
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    updateMutation.mutate(
      { about, address, email, websites: websiteArray, vertical },
      {
        onSuccess: () => toast.success('Bedrijfsprofiel opgeslagen'),
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bedrijfsprofiel</CardTitle>
        <CardDescription>Beheer het openbare WhatsApp Business-profiel van je organisatie</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Profielfoto */}
            <div className="flex items-center gap-4">
              {profileData?.profile_picture_url ? (
                <img
                  src={profileData.profile_picture_url}
                  alt="Profielfoto"
                  className="h-16 w-16 rounded-full object-cover border"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center border">
                  <User className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div>
                <p className="text-sm font-medium">Profielfoto</p>
                <p className="text-xs text-muted-foreground mt-1 mb-2">
                  Vierkant, min. 640x640px, max 5MB (JPG/PNG)
                </p>
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  className="hidden"
                  id="wp-profile-photo"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 5 * 1024 * 1024) {
                      toast.error('Afbeelding is te groot (max 5MB)');
                      return;
                    }
                    try {
                      // Convert file to base64
                      const buffer = await file.arrayBuffer();
                      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

                      const res = await supabase.functions.invoke('whatsapp-api', {
                        body: {
                          action: 'upload_profile_photo',
                          image_base64: base64,
                          mime_type: file.type,
                        },
                      });

                      if (res.error) throw new Error(await readFunctionError(res.error, 'Profielfoto uploaden mislukt'));
                      toast.success('Profielfoto bijgewerkt');
                      // Refetch profile to show new photo
                      profileQuery.refetch();
                    } catch (err: any) {
                      toast.error(err?.message ?? 'Profielfoto uploaden mislukt');
                    }
                    e.target.value = '';
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('wp-profile-photo')?.click()}
                >
                  Foto wijzigen
                </Button>
              </div>
            </div>

            <Separator />

            {/* Over ons */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="wp-about">Over ons</Label>
                <span className="text-xs text-muted-foreground">{about.length}/139</span>
              </div>
              <Textarea
                id="wp-about"
                value={about}
                onChange={(e) => setAbout(e.target.value.slice(0, 139))}
                placeholder="Korte bedrijfsomschrijving..."
                rows={3}
              />
            </div>

            {/* Adres */}
            <div className="space-y-1.5">
              <Label htmlFor="wp-address">Adres</Label>
              <Input
                id="wp-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Straat, stad"
              />
            </div>

            {/* E-mail */}
            <div className="space-y-1.5">
              <Label htmlFor="wp-email">E-mailadres</Label>
              <Input
                id="wp-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="info@bedrijf.nl"
              />
            </div>

            {/* Websites */}
            <div className="space-y-1.5">
              <Label htmlFor="wp-websites">Websites</Label>
              <Input
                id="wp-websites"
                value={websites}
                onChange={(e) => setWebsites(e.target.value)}
                placeholder="https://voorbeeld.nl, https://ander.nl"
              />
              <p className="text-xs text-muted-foreground">Meerdere websites scheiden met een komma.</p>
            </div>

            {/* Branche */}
            <div className="space-y-1.5">
              <Label>Branche</Label>
              <Select value={vertical} onValueChange={setVertical}>
                <SelectTrigger>
                  <SelectValue placeholder="Kies een branche" />
                </SelectTrigger>
                <SelectContent>
                  {VERTICAL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="gap-2"
            >
              {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Profiel opslaan
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

const WhatsAppSettings = () => {
  const orgId = useOrganizationId();
  const queryClient = useQueryClient();
  const setupWindowRef = useRef<Window | null>(null);
  const [registering, setRegistering] = useState(false);

  const { data: config, isLoading } = useQuery({
    queryKey: ['whatsapp-config', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('whatsapp_config' as any)
        .select('id, tenant_id, is_active, phone_number_id, display_phone, waba_id, updated_at')
        .eq('organization_id', orgId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      setRegistering(true);
      return invokeWhatsAppFunction('whatsapp-register');
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-config'] });
      toast.success('WhatsApp tenant geregistreerd');
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

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      await invokeWhatsAppFunction('whatsapp-disconnect');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-config'] });
      toast.success('WhatsApp ontkoppeld');
    },
    onError: (err: Error) => {
      toast.error('Ontkoppelen mislukt: ' + err.message);
    },
  });

  const templateSyncMutation = useMutation({
    mutationFn: async () => {
      return invokeWhatsAppFunction('whatsapp-templates-sync');
    },
    onSuccess: (data) => {
      toast.success(
        data?.synced != null
          ? `${data.synced} templates gesynchroniseerd`
          : 'Templates gesynchroniseerd'
      );
    },
    onError: (err: Error) => {
      toast.error('Synchronisatie mislukt: ' + err.message);
    },
  });

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== 'whatsapp-connected') return;
      queryClient.invalidateQueries({ queryKey: ['whatsapp-config'] });
      setupWindowRef.current = null;
      toast.success('WhatsApp gekoppeld!');
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [queryClient]);

  const openSetupUrl = (url: string) => {
    const popup = setupWindowRef.current && !setupWindowRef.current.closed
      ? setupWindowRef.current
      : window.open('', 'whatsapp-setup', 'width=600,height=700');

    if (popup) {
      popup.location.href = url;
      popup.focus();
      setupWindowRef.current = popup;
    }
  };

  const openSetup = () => {
    if (!config?.tenant_id) return;
    openSetupUrl(`https://connect.sitejob.nl/whatsapp-setup?tenant_id=${config.tenant_id}`);
  };

  const startRegistration = () => {
    setupWindowRef.current = window.open('', 'whatsapp-setup', 'width=600,height=700');
    registerMutation.mutate();
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

  const isConnected = config?.is_active && config?.phone_number_id;
  const isRegistered = config?.tenant_id;

  return (
    <div className="space-y-4">
      {/* ── Section 1: Connection ── */}
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
          <div className="flex flex-wrap gap-2">
            {!isRegistered ? (
              <Button
                onClick={startRegistration}
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
                onClick={startRegistration}
                disabled={registering}
              >
                {registering ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                Setup voltooien
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={openSetup}
                >
                  <ExternalLink className="h-4 w-4" /> Beheer koppeling
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => templateSyncMutation.mutate()}
                  disabled={templateSyncMutation.isPending}
                >
                  {templateSyncMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-4 w-4" />
                  )}
                  Templates synchroniseren
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-destructive hover:text-destructive"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                >
                  {disconnectMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Unlink className="h-4 w-4" />
                  )}
                  Ontkoppelen
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Section 2: Account Status (only when connected) ── */}
      {isConnected && <AccountStatusSection />}

      {/* ── Section 3: Automations ── */}
      {isRegistered && <WhatsAppAutomationSettings />}

      {/* ── Section 3: Business Profile (only when connected) ── */}
      {isConnected && <BusinessProfileSection />}
    </div>
  );
};

export default WhatsAppSettings;
