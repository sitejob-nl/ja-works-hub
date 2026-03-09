import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Settings as SettingsIcon, Upload, Palette, Building2, User, LogOut, Trash2, FileSpreadsheet } from 'lucide-react';
import { Link } from 'react-router-dom';
import WhatsAppSettings from '@/components/settings/WhatsAppSettings';
import ExactOnlineSettings from '@/components/settings/ExactOnlineSettings';
import DataExport from '@/components/settings/DataExport';
import ComplianceRulesSettings from '@/components/settings/ComplianceRulesSettings';
import RegulationsSettings from '@/components/settings/RegulationsSettings';
import ContractTemplatesSettings from '@/components/settings/ContractTemplatesSettings';

const ACCENT_PRESETS = [
  { name: 'Blauw (standaard)', hsl: '197 100% 60%', hex: '#32C5FF' },
  { name: 'Groen', hsl: '142 71% 45%', hex: '#22C55E' },
  { name: 'Paars', hsl: '262 83% 58%', hex: '#8B5CF6' },
  { name: 'Oranje', hsl: '25 95% 53%', hex: '#F97316' },
  { name: 'Rood', hsl: '0 72% 51%', hex: '#EF4444' },
  { name: 'Roze', hsl: '330 81% 60%', hex: '#EC4899' },
  { name: 'Teal', hsl: '175 77% 40%', hex: '#14B8A6' },
  { name: 'Indigo', hsl: '239 84% 67%', hex: '#6366F1' },
];

const Settings = () => {
  const orgId = useOrganizationId();
  const { profile, signOut } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: org, isLoading } = useQuery({
    queryKey: ['organization', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', orgId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const settings = (org?.settings as Record<string, string> | null) ?? {};
  const accentColor = settings.accent_color ?? '197 100% 60%';

  // Org info form
  const [orgName, setOrgName] = useState('');
  const [orgEmail, setOrgEmail] = useState('');
  const [orgPhone, setOrgPhone] = useState('');
  const [orgWebsite, setOrgWebsite] = useState('');
  const [orgStreet, setOrgStreet] = useState('');
  const [orgPostal, setOrgPostal] = useState('');
  const [orgCity, setOrgCity] = useState('');
  const [orgKvk, setOrgKvk] = useState('');
  const [orgBtw, setOrgBtw] = useState('');

  useEffect(() => {
    if (org) {
      setOrgName(org.name ?? '');
      setOrgEmail(org.email ?? '');
      setOrgPhone(org.phone ?? '');
      setOrgWebsite(org.website ?? '');
      setOrgStreet(org.address_street ?? '');
      setOrgPostal(org.address_postal ?? '');
      setOrgCity(org.address_city ?? '');
      setOrgKvk(org.kvk_number ?? '');
      setOrgBtw(org.btw_number ?? '');
    }
  }, [org]);

  const updateOrg = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      const { error } = await supabase.from('organizations').update(updates).eq('id', orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization'] });
      toast.success('Instellingen opgeslagen');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSaveOrg = () => {
    updateOrg.mutate({
      name: orgName,
      email: orgEmail || null,
      phone: orgPhone || null,
      website: orgWebsite || null,
      address_street: orgStreet || null,
      address_postal: orgPostal || null,
      address_city: orgCity || null,
      kvk_number: orgKvk || null,
      btw_number: orgBtw || null,
    });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Selecteer een afbeelding');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Afbeelding mag maximaal 2MB zijn');
      return;
    }

    const ext = file.name.split('.').pop();
    const path = `${orgId}/logo.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('organization-logos')
      .upload(path, file, { upsert: true });

    if (uploadError) {
      toast.error('Upload mislukt: ' + uploadError.message);
      return;
    }

    const { data: urlData } = supabase.storage.from('organization-logos').getPublicUrl(path);

    const logoUrl = urlData.publicUrl + '?t=' + Date.now();
    updateOrg.mutate({ logo_url: logoUrl });
  };

  const handleRemoveLogo = () => {
    updateOrg.mutate({ logo_url: null });
  };

  const handleSetAccent = (hsl: string) => {
    const newSettings = { ...settings, accent_color: hsl };
    updateOrg.mutate({ settings: newSettings });

    // Apply immediately
    document.documentElement.style.setProperty('--primary', hsl);
    document.documentElement.style.setProperty('--ring', hsl);
    document.documentElement.style.setProperty('--accent-blue', hsl);
    document.documentElement.style.setProperty('--stat-blue', hsl);
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Laden...</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Instellingen</h1>
      <p className="text-sm text-muted-foreground mb-6">Organisatie- en gebruikersinstellingen</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Organization info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4" /> Organisatie gegevens
              </CardTitle>
              <CardDescription>Algemene informatie van je organisatie</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Organisatienaam</Label>
                  <Input value={orgName} onChange={e => setOrgName(e.target.value)} />
                </div>
                <div>
                  <Label>E-mail</Label>
                  <Input value={orgEmail} onChange={e => setOrgEmail(e.target.value)} type="email" />
                </div>
                <div>
                  <Label>Telefoon</Label>
                  <Input value={orgPhone} onChange={e => setOrgPhone(e.target.value)} />
                </div>
                <div>
                  <Label>Website</Label>
                  <Input value={orgWebsite} onChange={e => setOrgWebsite(e.target.value)} />
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <Label>Straat + huisnr.</Label>
                  <Input value={orgStreet} onChange={e => setOrgStreet(e.target.value)} />
                </div>
                <div>
                  <Label>Postcode</Label>
                  <Input value={orgPostal} onChange={e => setOrgPostal(e.target.value)} />
                </div>
                <div>
                  <Label>Stad</Label>
                  <Input value={orgCity} onChange={e => setOrgCity(e.target.value)} />
                </div>
                <div>
                  <Label>KVK nummer</Label>
                  <Input value={orgKvk} onChange={e => setOrgKvk(e.target.value)} />
                </div>
                <div>
                  <Label>BTW nummer</Label>
                  <Input value={orgBtw} onChange={e => setOrgBtw(e.target.value)} />
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveOrg} disabled={updateOrg.isPending}>Opslaan</Button>
              </div>
            </CardContent>
          </Card>

          {/* Accent color */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Palette className="h-4 w-4" /> Accentkleur
              </CardTitle>
              <CardDescription>Kies een accentkleur voor het dashboard en de interface</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
                {ACCENT_PRESETS.map((preset) => (
                  <button
                    key={preset.hsl}
                    onClick={() => handleSetAccent(preset.hsl)}
                    className={`group flex flex-col items-center gap-1.5`}
                    title={preset.name}
                  >
                    <div
                      className={`h-10 w-10 rounded-full border-2 transition-all ${
                        accentColor === preset.hsl ? 'border-foreground scale-110 shadow-md' : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: preset.hex }}
                    />
                    <span className="text-[10px] text-muted-foreground leading-tight text-center">{preset.name}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* WhatsApp */}
          <WhatsAppSettings />

          {/* Exact Online */}
          <ExactOnlineSettings />

          {/* Data Export */}
          <DataExport />

          {/* Compliance Rules */}
          <ComplianceRulesSettings />

          {/* Data Import */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="h-4 w-4" /> Data importeren
              </CardTitle>
              <CardDescription>Importeer kandidaten en opdrachtgevers vanuit Excel of CSV</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link to="/importeren">Naar import wizard</Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Logo */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Upload className="h-4 w-4" /> Logo
              </CardTitle>
              <CardDescription>Upload je organisatie logo (max 2MB)</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              <div className="h-24 w-24 rounded-xl bg-secondary border border-border flex items-center justify-center overflow-hidden">
                {org?.logo_url ? (
                  <img src={org.logo_url} alt="Logo" className="h-full w-full object-contain" />
                ) : (
                  <Building2 className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoUpload}
              />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5 mr-1.5" /> Uploaden
                </Button>
                {org?.logo_url && (
                  <Button size="sm" variant="ghost" onClick={handleRemoveLogo}>
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Verwijderen
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Current user */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4" /> Mijn account
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-muted-foreground text-xs">Naam</Label>
                <p className="text-sm font-medium">{profile?.full_name}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">E-mail</Label>
                <p className="text-sm font-medium">{profile?.email}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs">Rol</Label>
                <p className="text-sm font-medium capitalize">{profile?.role}</p>
              </div>
              <Separator />
              <Button variant="outline" size="sm" className="w-full" onClick={signOut}>
                <LogOut className="h-3.5 w-3.5 mr-1.5" /> Uitloggen
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Settings;
