import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { usePublicUrl } from '@/hooks/usePublicUrl';
import { useOutlookAccounts } from '@/hooks/useOutlookAccounts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import TagInput from '@/components/ui/tag-input';
import { ChevronRight, Copy, MessageCircle, Mail, Check, AlertTriangle, ChevronsUpDown, X, KeyRound, Upload, Loader2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import { useDeduplication } from '@/hooks/useDeduplication';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import { resolveAddressCoordinates } from '@/lib/pdok';
import { CV_ACCEPT, extractCvTextFromFile } from '@/lib/cvText';

// Leest de JSON-foutmelding uit een mislukte supabase.functions.invoke (bv. 402-saldo).
// FunctionsHttpError verbergt de body achter context (een Response).
const readFnErrorMessage = async (error: unknown, fallback: string): Promise<string> => {
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    const text = await context.clone().text().catch(() => '');
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (parsed?.error && typeof parsed.error === 'string') return parsed.error;
      } catch {
        /* niet-JSON body — val terug op fallback */
      }
    }
  }
  return error instanceof Error ? error.message : fallback;
};

type SkillOption = {
  id: string;
  name: string;
};

const sources = [
  { value: 'website', label: 'Website' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'indeed', label: 'Indeed' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'referral', label: 'Referral' },
  { value: 'overig', label: 'Overig' },
];

const CandidateNew = () => {
  const orgId = useOrganizationId();
  const { buildUrl } = usePublicUrl();
  const { profile } = useAuth();
  const { hasUsableAccounts } = useOutlookAccounts('mail_send');
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [step, setStep] = useState<'form' | 'link'>('form');
  const [createdCandidate, setCreatedCandidate] = useState<{ id: string; first_name: string; phone: string | null; email: string | null } | null>(null);
  const [profileToken, setProfileToken] = useState<string | null>(null);
  const [portalInviteUrl, setPortalInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [portalCopied, setPortalCopied] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);

  // CV-upload: bewaar het bestand + de geëxtraheerde tekst zodat we ze ná het aanmaken
  // kunnen opslaan en de AI-analyse kunnen starten.
  const cvInputRef = useRef<HTMLInputElement>(null);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [cvRawText, setCvRawText] = useState('');
  const [cvExtracting, setCvExtracting] = useState(false);

  const [form, setForm] = useState({
    first_name: '', last_name: '', date_of_birth: '', nationality: '',
    email: '', phone: '', address_street: '', address_postal: '', address_city: '',
    address_lat: null as number | null, address_lng: null as number | null,
    bsn: '', iban: '', has_drivers_license: false, drivers_license_expiry: '',
    skills: [] as string[], languages: [] as string[], source: '', notes: '',
  });

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // Vult lege formuliervelden met de uit het CV geëxtraheerde waarden. Overschrijft nooit
  // wat de recruiter al heeft ingevuld. Geeft het aantal gevulde velden terug.
  const applyExtractedFields = (fields: Record<string, any>): number => {
    const updates: Record<string, any> = {};
    let count = 0;
    const setIfEmpty = (key: keyof typeof form, value: unknown) => {
      if (typeof value === 'string' && value.trim() && !String(form[key] ?? '').trim()) {
        updates[key] = value.trim();
        count += 1;
      }
    };

    setIfEmpty('first_name', fields.first_name);
    setIfEmpty('last_name', fields.last_name);
    setIfEmpty('nationality', fields.nationality);
    setIfEmpty('email', fields.email);
    setIfEmpty('phone', fields.phone);
    setIfEmpty('address_street', fields.address_street);
    setIfEmpty('address_postal', fields.address_postal);
    setIfEmpty('address_city', fields.address_city);

    // Geboortedatum alleen overnemen als het exact YYYY-MM-DD is (de date-input eist dat).
    if (typeof fields.date_of_birth === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(fields.date_of_birth)
      && !form.date_of_birth) {
      updates.date_of_birth = fields.date_of_birth;
      count += 1;
    }

    if (fields.has_drivers_license === true && !form.has_drivers_license) {
      updates.has_drivers_license = true;
      count += 1;
    }

    // Skills: alleen termen die in de org-catalogus voorkomen, en alleen als nog leeg.
    if (Array.isArray(fields.skills) && fields.skills.length > 0 && form.skills.length === 0) {
      const catalogNames = new Set(skillOptions.map((s: SkillOption) => s.name));
      const matched = [...new Set(fields.skills.filter((s: unknown) => typeof s === 'string' && catalogNames.has(s)))] as string[];
      if (matched.length > 0) {
        updates.skills = matched;
        count += 1;
      }
    }

    // Talen: vrije tekst, alleen als nog leeg.
    if (Array.isArray(fields.languages) && fields.languages.length > 0 && form.languages.length === 0) {
      const langs = [...new Set(fields.languages.map((l: unknown) => String(l).trim()).filter(Boolean))] as string[];
      if (langs.length > 0) {
        updates.languages = langs;
        count += 1;
      }
    }

    if (count > 0) setForm((f) => ({ ...f, ...updates }));
    return count;
  };

  const handleCvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      toast.error('Bestand is te groot (maximaal 15 MB)');
      if (cvInputRef.current) cvInputRef.current.value = '';
      return;
    }

    setCvExtracting(true);
    try {
      const rawText = await extractCvTextFromFile(file);
      const cleaned = (rawText || '').replace(/\n{3,}/g, '\n\n').trim();
      setCvFile(file);
      setCvRawText(cleaned);

      if (cleaned.length < 100) {
        toast.info('Het CV is bewaard, maar bevat te weinig herkenbare tekst om automatisch in te vullen. Vul de velden handmatig in.');
        return;
      }

      const { data, error } = await supabase.functions.invoke('extract-cv-profile', {
        body: { cv_text: cleaned },
      });

      if (error) {
        const msg = await readFnErrorMessage(error, 'Automatisch invullen mislukt');
        toast.info(`${msg}. Vul de velden handmatig in — het CV wordt wel bewaard en geanalyseerd.`);
        return;
      }
      if ((data as any)?.error) {
        toast.info(`${(data as any).error}. Vul de velden handmatig in — het CV wordt wel bewaard en geanalyseerd.`);
        return;
      }

      const fields = (data as any)?.fields;
      if (!fields) {
        toast.info('Geen gegevens gevonden om automatisch in te vullen.');
        return;
      }

      const filled = applyExtractedFields(fields);
      toast.success(
        filled > 0
          ? `${filled} ${filled === 1 ? 'veld' : 'velden'} automatisch ingevuld — controleer ze`
          : 'CV geüpload — geen nieuwe velden gevonden om in te vullen',
      );
    } catch (err: any) {
      toast.error(err?.message || 'Fout bij het lezen van het bestand');
      console.error(err);
    } finally {
      setCvExtracting(false);
      if (cvInputRef.current) cvInputRef.current.value = '';
    }
  };

  const { data: skillOptions = [] } = useQuery({
    queryKey: ['candidate-skill-options', orgId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('skills')
        .select('id, name')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!orgId,
  });

  const { data: duplicates = [] } = useDeduplication({
    email: form.email,
    phone: form.phone,
    date_of_birth: form.date_of_birth,
    last_name: form.last_name,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const address = await resolveAddressCoordinates({
        street: form.address_street,
        postal: form.address_postal,
        city: form.address_city,
        lat: form.address_lat,
        lng: form.address_lng,
      });
      const payload = {
        ...form,
        organization_id: orgId,
        date_of_birth: form.date_of_birth || null,
        drivers_license_expiry: form.has_drivers_license && form.drivers_license_expiry ? form.drivers_license_expiry : null,
        source: form.source || null,
        notes: form.notes || null,
        bsn: form.bsn || null,
        iban: form.iban || null,
        nationality: form.nationality || null,
        email: form.email || null,
        phone: form.phone || null,
        address_street: form.address_street || null,
        address_postal: form.address_postal || null,
        address_city: form.address_city || null,
        address_lat: address.lat,
        address_lng: address.lng,
      };
      const { data, error } = await supabase.from('candidates').insert(payload as any).select('id, first_name, phone, email').single();
      if (error) throw error;

      // Generate profile token
      const { data: tokenData, error: tokenError } = await supabase
        .from('candidate_profile_tokens')
        .insert({ organization_id: orgId, candidate_id: data.id })
        .select('token')
        .single();
      if (tokenError) throw tokenError;

      // Bewaar het geüploade CV + de geëxtraheerde tekst (non-kritisch: faalt stil,
      // breekt het aanmaken nooit). cv_raw_text voedt straks de AI-analyse.
      if (cvFile) {
        try {
          const ext = cvFile.name.split('.').pop()?.toLowerCase() || 'bin';
          const filePath = `${orgId}/${data.id}/cv_${Date.now()}.${ext}`;
          const { error: uploadError } = await supabase.storage
            .from('documents')
            .upload(filePath, cvFile, { upsert: true, contentType: cvFile.type || undefined });

          const update: Record<string, any> = {};
          if (!uploadError) {
            const { data: urlData } = supabase.storage.from('documents').getPublicUrl(filePath);
            update.cv_file_url = urlData.publicUrl;
          } else {
            console.warn('CV-upload mislukt (non-kritisch):', uploadError);
          }
          if (cvRawText) update.cv_raw_text = cvRawText;
          if (Object.keys(update).length > 0) {
            await supabase.from('candidates').update(update).eq('id', data.id);
          }
        } catch (e) {
          console.warn('CV opslaan mislukt (non-kritisch):', e);
        }
      }

      return { ...data, token: tokenData.token, hadCv: !!cvFile };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['candidates'] });
      logAudit({ action: 'create', tableName: 'candidates', recordId: data.id, newValues: form });
      toast.success('Kandidaat aangemaakt');

      // Start de dossieranalyse (org-default provider) als er een CV is geüpload.
      // Fire-and-forget: het resultaat verschijnt op het kandidaatdossier.
      if (data.hadCv) {
        supabase.functions
          .invoke('analyze-cv', { body: { candidate_id: data.id, cv_text: cvRawText || undefined } })
          .then(({ error }) => { if (error) console.warn('CV-analyse starten mislukt:', error); })
          .catch((e) => console.warn('CV-analyse starten mislukt:', e));
        toast.success('CV-analyse gestart — verschijnt op het kandidaatdossier');
      }

      setCreatedCandidate({ id: data.id, first_name: data.first_name, phone: data.phone, email: data.email });
      setProfileToken(data.token);
      setStep('link');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const profileUrl = profileToken ? buildUrl(`/profiel/${profileToken}`) : '';
  const orgName = profile?.full_name ? profile.full_name.split(' ')[0] : 'ons';
  const whatsAppText = `Hoi ${createdCandidate?.first_name}, je bent aangemeld. Vul je profiel aan via deze link: ${profileUrl}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(profileUrl);
    setCopied(true);
    toast.success('Link gekopieerd');
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePortalCopy = () => {
    if (!portalInviteUrl) return;
    navigator.clipboard.writeText(portalInviteUrl);
    setPortalCopied(true);
    toast.success('Portaalactivatielink gekopieerd');
    setTimeout(() => setPortalCopied(false), 2000);
  };

  const handleWhatsApp = () => {
    const phone = createdCandidate?.phone?.replace(/[^0-9+]/g, '') ?? '';
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(whatsAppText)}`, '_blank');
  };

  const handleEmail = () => {
    if (!createdCandidate?.email) return;
    if (!hasUsableAccounts) {
      toast.error('Geen verbonden e-mailaccount gevonden. Koppel eerst Outlook via Instellingen.');
      return;
    }
    portalInviteMutation.mutate({ sendEmail: true });
  };

  const handleCreatePortalLink = () => {
    portalInviteMutation.mutate({ sendEmail: false });
  };

  const portalInviteMutation = useMutation({
    mutationFn: async ({ sendEmail }: { sendEmail: boolean }) => {
      if (!createdCandidate?.email) throw new Error('Geen e-mailadres bekend');

      const { data: existingInvite, error: existingError } = await supabase
        .from('portal_invites')
        .select('id, token')
        .eq('candidate_id', createdCandidate.id)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingError) throw existingError;

      let inviteId = existingInvite?.id;
      let inviteToken = existingInvite?.token;
      if (!inviteId) {
        const { data: invite, error: inviteError } = await supabase
          .from('portal_invites')
          .insert({
            organization_id: orgId,
            candidate_id: createdCandidate.id,
            email: createdCandidate.email,
          })
          .select('id, token')
          .single();
        if (inviteError) throw inviteError;
        inviteId = invite.id;
        inviteToken = invite.token;
      }

      const { error: candidateError } = await supabase
        .from('candidates')
        .update({ portal_enabled: true })
        .eq('id', createdCandidate.id);
      if (candidateError) throw candidateError;

      if (!sendEmail) {
        return {
          sent: false,
          activation_url: buildUrl(`/portaal/activeren/${inviteToken}`),
          sendEmail,
        };
      }

      const { data, error } = await supabase.functions.invoke('send-portal-invite', {
        body: { invite_id: inviteId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      if (!(data as any)?.sent) throw new Error((data as any)?.error ?? 'E-mail versturen mislukt');
      return { ...(data as { sent: boolean; activation_url?: string; error?: string }), sendEmail };
    },
    onSuccess: (data) => {
      if (data.activation_url) setPortalInviteUrl(data.activation_url);
      qc.invalidateQueries({ queryKey: ['candidates'] });
      toast.success(data.sendEmail ? 'Portaaluitnodiging verstuurd via het verbonden e-mailaccount' : 'Portaalactivatielink aangemaakt');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const toggleSkill = (skillName: string) => {
    setForm((current) => ({
      ...current,
      skills: current.skills.includes(skillName)
        ? current.skills.filter((skill) => skill !== skillName)
        : [...current.skills, skillName],
    }));
  };

  const removeSkill = (skillName: string) => {
    set('skills', form.skills.filter((skill) => skill !== skillName));
  };

  if (step === 'link' && createdCandidate) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Link to="/kandidaten" className="hover:text-foreground transition-colors">Kandidaten</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-foreground">Links versturen</span>
        </div>

        <h1 className="text-2xl font-semibold">Links versturen</h1>
        <p className="text-muted-foreground">
          {createdCandidate.first_name} is aangemaakt. Gebruik de profiellink voor gegevens aanvullen, of de portaalactivatielink voor medewerkersportaal-login.
        </p>

        <div className="bg-card rounded-lg border p-6 max-w-xl space-y-5">
          <div className="space-y-2">
            <Label>Profiel aanvullen</Label>
            <div className="flex gap-2">
              <Input value={profileUrl} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4 text-stat-green" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label>Medewerkersportaal activeren</Label>
                <p className="text-xs text-muted-foreground mt-1">Hiermee stelt de medewerker een wachtwoord in voor het portaal.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={handleCreatePortalLink} disabled={!createdCandidate.email || portalInviteMutation.isPending} className="gap-1.5 shrink-0">
                <KeyRound className="h-3.5 w-3.5" />
                Link maken
              </Button>
            </div>
            {portalInviteUrl && (
              <div className="flex gap-2">
                <Input value={portalInviteUrl} readOnly className="font-mono text-xs bg-background" />
                <Button variant="outline" size="icon" onClick={handlePortalCopy}>
                  {portalCopied ? <Check className="h-4 w-4 text-stat-green" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            {createdCandidate.phone && (
              <Button onClick={handleWhatsApp} className="gap-2 bg-[#25D366] hover:bg-[#1da851] text-white">
                <MessageCircle className="h-4 w-4" /> Verstuur via WhatsApp
              </Button>
            )}
            {createdCandidate.email && (
              <Button variant="outline" onClick={handleEmail} disabled={portalInviteMutation.isPending} className="gap-2">
                <Mail className="h-4 w-4" /> {portalInviteMutation.isPending ? 'Versturen...' : 'Verstuur portaaluitnodiging via email'}
              </Button>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="ghost" onClick={() => navigate('/kandidaten')}>Terug naar lijst</Button>
            <Button onClick={() => navigate(`/kandidaten/${createdCandidate.id}`)}>Naar kandidaat</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/kandidaten" className="hover:text-foreground transition-colors">Kandidaten</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">Nieuwe kandidaat</span>
      </div>

      <h1 className="text-2xl font-semibold">Nieuwe kandidaat</h1>

      <div className="bg-card rounded-lg border p-5 max-w-3xl">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-2.5">
            <FileText className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium">CV uploaden &amp; automatisch invullen</p>
              <p className="text-xs text-muted-foreground">
                Upload een CV (PDF, Word of afbeelding). Lege velden worden alvast ingevuld; controleer ze. De AI-analyse start automatisch na het aanmaken.
              </p>
            </div>
          </div>
          <input
            ref={cvInputRef}
            type="file"
            accept={CV_ACCEPT}
            className="hidden"
            onChange={handleCvUpload}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => cvInputRef.current?.click()}
            disabled={cvExtracting || mutation.isPending}
            className="gap-1.5 shrink-0"
          >
            {cvExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {cvExtracting ? 'Bezig...' : 'CV uploaden'}
          </Button>
        </div>
        {cvFile && !cvExtracting && (
          <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-stat-green shrink-0" />
            {cvFile.name} — wordt bewaard en geanalyseerd na het aanmaken
          </p>
        )}
      </div>

      <div className="bg-card rounded-lg border p-6 max-w-3xl">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Voornaam *</Label><Input value={form.first_name} onChange={(e) => set('first_name', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Achternaam *</Label><Input value={form.last_name} onChange={(e) => set('last_name', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Geboortedatum</Label><Input type="date" value={form.date_of_birth} onChange={(e) => set('date_of_birth', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Nationaliteit</Label><Input value={form.nationality} onChange={(e) => set('nationality', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>E-mail</Label><Input value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Telefoon</Label><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
          </div>
          <AddressAutocomplete
            value={{ street: form.address_street, postal: form.address_postal, city: form.address_city, lat: form.address_lat, lng: form.address_lng }}
            onChange={(address) => setForm((f) => ({
              ...f,
              address_street: address.street,
              address_postal: address.postal,
              address_city: address.city,
              address_lat: address.lat ?? null,
              address_lng: address.lng ?? null,
            }))}
            gridClassName="grid-cols-1 sm:grid-cols-3 gap-4"
            streetLabel="Straat"
          />
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>BSN</Label><Input value={form.bsn} onChange={(e) => set('bsn', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>IBAN</Label><Input value={form.iban} onChange={(e) => set('iban', e.target.value)} /></div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox checked={form.has_drivers_license} onCheckedChange={(v) => set('has_drivers_license', !!v)} id="dl" />
              <Label htmlFor="dl">Rijbewijs</Label>
            </div>
            {form.has_drivers_license && (
              <div className="max-w-xs space-y-1.5"><Label>Verloopdatum rijbewijs</Label><Input type="date" value={form.drivers_license_expiry} onChange={(e) => set('drivers_license_expiry', e.target.value)} /></div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Vaardigheden</Label>
            <Popover open={skillsOpen} onOpenChange={setSkillsOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal">
                  <span className={form.skills.length > 0 ? 'text-foreground' : 'text-muted-foreground'}>
                    {form.skills.length > 0 ? `${form.skills.length} vaardigheid${form.skills.length === 1 ? '' : 'en'} geselecteerd` : 'Kies vaardigheden'}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Zoek vaardigheid..." />
                  <CommandList>
                    <CommandEmpty>Geen vaardigheden gevonden.</CommandEmpty>
                    <CommandGroup>
                      {skillOptions.map((skill: SkillOption) => {
                        const selected = form.skills.includes(skill.name);
                        return (
                          <CommandItem key={skill.id} value={skill.name} onSelect={() => toggleSkill(skill.name)}>
                            <Check className={`mr-2 h-4 w-4 ${selected ? 'opacity-100' : 'opacity-0'}`} />
                            {skill.name}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {form.skills.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {form.skills.map((skill) => (
                  <Badge key={skill} variant="secondary" className="gap-1 text-xs">
                    {skill}
                    <button type="button" className="rounded-sm hover:text-destructive" onClick={() => removeSkill(skill)} aria-label={`${skill} verwijderen`}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1.5"><Label>Talen</Label><TagInput value={form.languages} onChange={(v) => set('languages', v)} placeholder="Typ taal + Enter" /></div>
          <div className="space-y-1.5">
            <Label>Bron</Label>
            <Select value={form.source} onValueChange={(v) => set('source', v)}>
              <SelectTrigger className="max-w-xs"><SelectValue placeholder="Selecteer bron" /></SelectTrigger>
              <SelectContent>
                {sources.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} /></div>

          {duplicates.length > 0 && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-orange-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span className="text-sm font-medium">Mogelijke duplicaten gevonden</span>
              </div>
              <div className="space-y-1.5">
                {duplicates.map(d => (
                  <div key={d.id} className="flex items-center justify-between text-sm">
                    <span>
                      <span className="font-medium">{d.first_name} {d.last_name}</span>
                      <span className="text-muted-foreground ml-2">— match op {d.matchedOn.join(', ')}</span>
                    </span>
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate(`/kandidaten/${d.id}`)}>
                      Bekijk
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-orange-600">Je kunt de kandidaat alsnog aanmaken als het geen duplicaat is.</p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="ghost" onClick={() => navigate('/kandidaten')}>Annuleren</Button>
            <Button onClick={() => mutation.mutate()} disabled={!form.first_name || !form.last_name || mutation.isPending}>
              {mutation.isPending ? 'Opslaan...' : 'Kandidaat aanmaken'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CandidateNew;
