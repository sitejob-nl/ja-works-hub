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
import { Settings as SettingsIcon, Upload, Palette, Building2, User, LogOut, Trash2, FileSpreadsheet, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import WhatsAppSettings from '@/components/settings/WhatsAppSettings';
import ExactOnlineSettings from '@/components/settings/ExactOnlineSettings';
import DataExport from '@/components/settings/DataExport';
import ComplianceRulesSettings from '@/components/settings/ComplianceRulesSettings';
import RegulationsSettings from '@/components/settings/RegulationsSettings';
import ContractTemplatesSettings from '@/components/settings/ContractTemplatesSettings';
import OnboardingFormSettings from '@/components/settings/OnboardingFormSettings';
import TerminationReasonsSettings from '@/components/settings/TerminationReasonsSettings';
import CustomFieldsSettings from '@/components/settings/CustomFieldsSettings';
import MicrosoftSettings from '@/components/settings/MicrosoftSettings';
import VoysSettings from '@/components/settings/VoysSettings';
import { applyBranding, BRANDING_DEFAULTS, type BrandingSettings } from '@/lib/branding';

/* ---- Color conversion helpers ---- */
function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function hslToHex(hslStr: string): string {
  const parts = hslStr.split(/\s+/);
  const h = parseInt(parts[0], 10) / 360;
  const s = parseInt(parts[1], 10) / 100;
  const l = parseInt(parts[2], 10) / 100;
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Small color picker: presets + native picker + hex input */
function ColorPickerRow({
  presets,
  value,
  onChange,
  columns = 8,
}: {
  presets: { name: string; hsl: string; hex: string }[];
  value: string;
  onChange: (hsl: string) => void;
  columns?: number;
}) {
  const currentHex = hslToHex(value);
  const [hexInput, setHexInput] = useState(currentHex);

  useEffect(() => { setHexInput(hslToHex(value)); }, [value]);

  const applyHex = (hex: string) => {
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      onChange(hexToHsl(hex));
    }
  };

  return (
    <div className="space-y-3">
      <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {presets.map((preset) => (
          <button
            key={preset.hsl}
            onClick={() => onChange(preset.hsl)}
            className="group flex flex-col items-center gap-1.5"
            title={preset.name}
          >
            <div
              className={`h-10 w-10 rounded-full border-2 transition-all ${
                value === preset.hsl ? 'border-foreground scale-110 shadow-md' : 'border-transparent hover:scale-105'
              }`}
              style={{ backgroundColor: preset.hex }}
            />
            <span className="text-[10px] text-muted-foreground leading-tight text-center">{preset.name}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <div className="relative">
          <input
            type="color"
            value={currentHex}
            onChange={(e) => { applyHex(e.target.value); setHexInput(e.target.value); }}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
          <div
            className="h-9 w-9 rounded-md border border-border cursor-pointer shadow-sm"
            style={{ backgroundColor: currentHex }}
          />
        </div>
        <Input
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={() => applyHex(hexInput)}
          onKeyDown={(e) => e.key === 'Enter' && applyHex(hexInput)}
          placeholder="#000000"
          className="w-28 font-mono text-sm"
        />
        <span className="text-xs text-muted-foreground">of kies een kleurcode</span>
      </div>
    </div>
  );
}

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

const SIDEBAR_PRESETS = [
  { name: 'Donker (standaard)', hsl: '224 60% 8%', hex: '#0B1020' },
  { name: 'Antraciet', hsl: '220 13% 18%', hex: '#272B33' },
  { name: 'Navy', hsl: '222 47% 15%', hex: '#141E33' },
  { name: 'Donkergroen', hsl: '160 40% 10%', hex: '#0F1F1A' },
  { name: 'Donkerpaars', hsl: '270 40% 14%', hex: '#1E1433' },
  { name: 'Warm grijs', hsl: '30 8% 20%', hex: '#37332F' },
  { name: 'Wit', hsl: '0 0% 100%', hex: '#FFFFFF' },
  { name: 'Lichtgrijs', hsl: '210 20% 96%', hex: '#F1F5F9' },
];

const BG_PRESETS = [
  { name: 'Lichtgrijs (standaard)', hsl: '210 33% 98%', hex: '#F8FAFC' },
  { name: 'Wit', hsl: '0 0% 100%', hex: '#FFFFFF' },
  { name: 'Warm crème', hsl: '40 33% 97%', hex: '#FAF8F5' },
  { name: 'Koel blauw', hsl: '214 32% 97%', hex: '#F5F8FC' },
  { name: 'Mint', hsl: '160 25% 97%', hex: '#F4FAF8' },
  { name: 'Lavender', hsl: '260 25% 97%', hex: '#F6F4FA' },
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
    applyBranding(newSettings as BrandingSettings);
  };

  const handleSetSidebarBg = (hsl: string) => {
    const newSettings = { ...settings, sidebar_bg: hsl };
    updateOrg.mutate({ settings: newSettings });
    applyBranding(newSettings as BrandingSettings);
  };

  const handleSetBackground = (hsl: string) => {
    const newSettings = { ...settings, background: hsl };
    updateOrg.mutate({ settings: newSettings });
    applyBranding(newSettings as BrandingSettings);
  };

  const handleResetBranding = () => {
    const newSettings = { ...settings };
    delete newSettings.accent_color;
    delete newSettings.sidebar_bg;
    delete newSettings.background;
    delete newSettings.sidebar_fg;
    delete newSettings.sidebar_fg_active;
    delete newSettings.card;
    delete newSettings.heading;
    delete newSettings.border_radius;
    updateOrg.mutate({ settings: newSettings });
    applyBranding(BRANDING_DEFAULTS);
    toast.success('Branding hersteld naar standaard');
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

          {/* Branding */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Palette className="h-4 w-4" /> Branding & Kleuren
                  </CardTitle>
                  <CardDescription>Pas het uiterlijk van het platform aan per organisatie</CardDescription>
                </div>
                <Button size="sm" variant="ghost" onClick={handleResetBranding}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Standaard
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Accent color */}
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 block">Accentkleur</Label>
                <ColorPickerRow presets={ACCENT_PRESETS} value={accentColor} onChange={handleSetAccent} columns={8} />
              </div>

              <Separator />

              {/* Sidebar color */}
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 block">Sidebar kleur</Label>
                <ColorPickerRow presets={SIDEBAR_PRESETS} value={settings.sidebar_bg ?? BRANDING_DEFAULTS.sidebar_bg} onChange={handleSetSidebarBg} columns={8} />
              </div>

              <Separator />

              {/* Background color */}
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 block">Achtergrondkleur</Label>
                <ColorPickerRow presets={BG_PRESETS} value={settings.background ?? BRANDING_DEFAULTS.background} onChange={handleSetBackground} columns={6} />
              </div>

              <Separator />

              {/* Live preview */}
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 block">Voorbeeld</Label>
                <div className="flex rounded-lg overflow-hidden border border-border h-24">
                  <div
                    className="w-16 p-2 flex flex-col gap-1.5"
                    style={{ backgroundColor: `hsl(${settings.sidebar_bg ?? BRANDING_DEFAULTS.sidebar_bg})` }}
                  >
                    {[1, 2, 3].map(i => (
                      <div
                        key={i}
                        className="h-2 rounded-sm"
                        style={{
                          backgroundColor: i === 1
                            ? `hsl(${accentColor})`
                            : `hsl(${settings.sidebar_fg ?? BRANDING_DEFAULTS.sidebar_fg} / 0.3)`,
                        }}
                      />
                    ))}
                  </div>
                  <div
                    className="flex-1 p-3 flex flex-col gap-2"
                    style={{ backgroundColor: `hsl(${settings.background ?? BRANDING_DEFAULTS.background})` }}
                  >
                    <div className="h-2.5 w-20 rounded-sm" style={{ backgroundColor: `hsl(${settings.heading ?? BRANDING_DEFAULTS.heading})` }} />
                    <div
                      className="flex-1 rounded-md p-2"
                      style={{ backgroundColor: `hsl(${settings.card ?? BRANDING_DEFAULTS.card})` }}
                    >
                      <div className="h-2 w-16 rounded-sm" style={{ backgroundColor: `hsl(${accentColor})` }} />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* WhatsApp */}
          <WhatsAppSettings />

          {/* Exact Online */}
          <ExactOnlineSettings />

          {/* Voys Telefonie */}
          <VoysSettings />

          {/* Microsoft 365 */}
          <MicrosoftSettings />

          {/* Data Export */}
          <DataExport />

          {/* Compliance Rules */}
          <ComplianceRulesSettings />

          {/* Reglementen */}
          <RegulationsSettings />

          {/* Contracttemplates */}
          <ContractTemplatesSettings />

          {/* Onboarding formulieren */}
          <OnboardingFormSettings />

          {/* Beëindigingsredenen */}
          <TerminationReasonsSettings />

          {/* Extra velden */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Extra velden</CardTitle>
              <CardDescription>Voeg aangepaste velden toe aan kandidaten, opdrachtgevers en meer</CardDescription>
            </CardHeader>
            <CardContent>
              <CustomFieldsSettings />
            </CardContent>
          </Card>

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
