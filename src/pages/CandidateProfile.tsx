import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TagInput from '@/components/ui/tag-input';
import { CheckCircle2, AlertTriangle, Upload, Camera, Loader2, User } from 'lucide-react';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import { resolveAddressCoordinates } from '@/lib/pdok';

const nationalities = [
  { value: 'Nederlands', label: 'Nederlands' },
  { value: 'Pools', label: 'Pools' },
  { value: 'Roemeens', label: 'Roemeens' },
  { value: 'Bulgaars', label: 'Bulgaars' },
  { value: 'Hongaars', label: 'Hongaars' },
  { value: 'overig', label: 'Overig' },
];

const languageOptions = ['Nederlands', 'Engels', 'Pools', 'Roemeens', 'Duits', 'Frans'];

type PageState = 'loading' | 'invalid' | 'expired' | 'used' | 'form' | 'success';

const CandidateProfile = () => {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PageState>('loading');
  const [orgName, setOrgName] = useState('');
  const [candidateId, setCandidateId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [usedFirstName, setUsedFirstName] = useState('');

  // Form state
  const [form, setForm] = useState({
    first_name: '', last_name: '', phone: '', email: '',
    date_of_birth: '', nationality: '', nationality_other: '',
    languages: [] as string[],
    address_street: '', address_postal: '', address_city: '', address_country: 'Nederland',
    address_lat: null as number | null, address_lng: null as number | null,
    skills: [] as string[], certifications: [] as string[],
    has_drivers_license: false, drivers_license_expiry: '',
    availability_notes: '',
  });

  // File state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cvInputRef = useRef<HTMLInputElement>(null);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const toggleLanguage = (lang: string) => {
    setForm((f) => ({
      ...f,
      languages: f.languages.includes(lang)
        ? f.languages.filter((l) => l !== lang)
        : [...f.languages, lang],
    }));
  };

  // Validate token on mount
  useEffect(() => {
    if (!token) { setState('invalid'); return; }

    const validate = async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/candidate-profile?token=${encodeURIComponent(token)}`,
          { headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` } }
        );
        const data = await res.json();

        if (!data.valid) {
          if (data.reason === 'already_used') {
            setUsedFirstName(data.first_name ?? '');
            setState('used');
          } else if (data.reason === 'expired') {
            setState('expired');
          } else {
            setState('invalid');
          }
          return;
        }

        // Valid — populate form
        setOrgName(data.organization?.name ?? '');
        setCandidateId(data.candidate?.id ?? '');
        setOrganizationId(data.organization_id ?? '');

        const c = data.candidate;
        setForm({
          first_name: c.first_name ?? '',
          last_name: c.last_name ?? '',
          phone: c.phone ?? '',
          email: c.email ?? '',
          date_of_birth: c.date_of_birth ?? '',
          nationality: c.nationality && nationalities.some(n => n.value === c.nationality) ? c.nationality : (c.nationality ? 'overig' : ''),
          nationality_other: c.nationality && !nationalities.some(n => n.value === c.nationality) ? c.nationality : '',
          languages: c.languages ?? [],
          address_street: c.address_street ?? '',
          address_postal: c.address_postal ?? '',
          address_city: c.address_city ?? '',
          address_country: c.address_country ?? 'Nederland',
          address_lat: c.address_lat ?? null,
          address_lng: c.address_lng ?? null,
          skills: c.skills ?? [],
          certifications: c.certifications ?? [],
          has_drivers_license: c.has_drivers_license ?? false,
          drivers_license_expiry: c.drivers_license_expiry ?? '',
          availability_notes: c.availability_notes ?? '',
        });

        setState('form');
      } catch {
        setState('invalid');
      }
    };

    validate();
  }, [token]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!token) return;
    setSubmitting(true);

    try {
      let cv_file_url: string | null = null;

      // Upload CV
      if (cvFile) {
        const ext = cvFile.name.split('.').pop() ?? 'pdf';
        const path = `${organizationId}/candidates/${candidateId}/cv_${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from('documents').upload(path, cvFile);
        if (!error) cv_file_url = path;
      }

      // Upload photo
      let photo_file_url: string | null = null;
      if (photoFile) {
        const ext = photoFile.name.split('.').pop() ?? 'jpg';
        const path = `${organizationId}/candidates/${candidateId}/photo_${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from('documents').upload(path, photoFile);
        if (!error) photo_file_url = path;
      }

      const nationality = form.nationality === 'overig' ? form.nationality_other : form.nationality;
      const address = await resolveAddressCoordinates({
        street: form.address_street,
        postal: form.address_postal,
        city: form.address_city,
        lat: form.address_lat,
        lng: form.address_lng,
      });

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/candidate-profile`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            token,
            candidate_data: {
              phone: form.phone || undefined,
              email: form.email || undefined,
              date_of_birth: form.date_of_birth || undefined,
              nationality: nationality || undefined,
              languages: form.languages.length ? form.languages : undefined,
              address_street: form.address_street || undefined,
              address_postal: form.address_postal || undefined,
              address_city: form.address_city || undefined,
              address_country: form.address_country || undefined,
              address_lat: address.lat ?? undefined,
              address_lng: address.lng ?? undefined,
              skills: form.skills.length ? form.skills : undefined,
              certifications: form.certifications.length ? form.certifications : undefined,
              has_drivers_license: form.has_drivers_license,
              drivers_license_expiry: form.has_drivers_license && form.drivers_license_expiry ? form.drivers_license_expiry : undefined,
              availability_notes: form.availability_notes || undefined,
              cv_file_url: cv_file_url || undefined,
              profile_photo_url: photo_file_url || undefined,
            },
            documents: [
              ...(cv_file_url ? [{ type: 'cv' as const, file_path: cv_file_url, name: 'CV (zelf geüpload)' }] : []),
            ],
          }),
        }
      );

      const result = await res.json();
      if (result.success) {
        setState('success');
      } else {
        throw new Error(result.error ?? 'Onbekende fout');
      }
    } catch (err: any) {
      alert(err.message ?? 'Er is een fout opgetreden. Probeer het opnieuw.');
    } finally {
      setSubmitting(false);
    }
  };

  // Loading
  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Invalid / Expired
  if (state === 'invalid' || state === 'expired') {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <div className="bg-card border rounded-xl p-8 max-w-md text-center space-y-3">
          <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
          <h1 className="text-lg font-semibold">
            {state === 'expired' ? 'Link verlopen' : 'Ongeldige link'}
          </h1>
          <p className="text-sm text-muted-foreground">
            Deze link is niet meer geldig. Neem contact op met je recruiter voor een nieuwe link.
          </p>
        </div>
      </div>
    );
  }

  // Already used
  if (state === 'used') {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <div className="bg-card border rounded-xl p-8 max-w-md text-center space-y-3">
          <CheckCircle2 className="h-12 w-12 text-stat-green mx-auto" />
          <h1 className="text-lg font-semibold">Profiel al aangevuld</h1>
          <p className="text-sm text-muted-foreground">
            {usedFirstName ? `Bedankt ${usedFirstName}! ` : ''}Je profiel is al aangevuld. Je kunt dit venster sluiten.
          </p>
        </div>
      </div>
    );
  }

  // Success
  if (state === 'success') {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <div className="bg-card border rounded-xl p-8 max-w-md text-center space-y-3">
          <CheckCircle2 className="h-12 w-12 text-stat-green mx-auto" />
          <h1 className="text-lg font-semibold">Bedankt {form.first_name}!</h1>
          <p className="text-sm text-muted-foreground">
            Je profiel is aangevuld. Je recruiter neemt binnenkort contact met je op.
          </p>
          <p className="text-xs text-muted-foreground">Je kunt dit venster sluiten.</p>
        </div>
      </div>
    );
  }

  // Form
  return (
    <div className="min-h-screen bg-muted py-6 px-4">
      <div className="max-w-lg mx-auto space-y-5">
        {/* Header */}
        <div className="bg-card border rounded-xl p-6 text-center space-y-2">
          {orgName && <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{orgName}</p>}
          <h1 className="text-xl font-semibold">Hoi {form.first_name}! Vul je profiel aan.</h1>
          <p className="text-sm text-muted-foreground">Het duurt maar een paar minuten.</p>
        </div>

        {/* Section 1: Persoonlijke gegevens */}
        <div className="bg-card border rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Persoonlijke gegevens</h2>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Voornaam</Label>
              <Input value={form.first_name} readOnly className="bg-muted" />
            </div>
            <div className="space-y-1.5">
              <Label>Achternaam</Label>
              <Input value={form.last_name} readOnly className="bg-muted" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Telefoonnummer</Label>
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} type="tel" className="h-12 text-base" />
          </div>

          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input value={form.email} onChange={(e) => set('email', e.target.value)} type="email" className="h-12 text-base" />
          </div>

          <div className="space-y-1.5">
            <Label>Geboortedatum</Label>
            <Input value={form.date_of_birth} onChange={(e) => set('date_of_birth', e.target.value)} type="date" className="h-12 text-base" />
          </div>

          <div className="space-y-1.5">
            <Label>Nationaliteit</Label>
            <Select value={form.nationality} onValueChange={(v) => set('nationality', v)}>
              <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Selecteer nationaliteit" /></SelectTrigger>
              <SelectContent>
                {nationalities.map((n) => <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {form.nationality === 'overig' && (
              <Input
                value={form.nationality_other}
                onChange={(e) => set('nationality_other', e.target.value)}
                placeholder="Vul je nationaliteit in"
                className="mt-2 h-12 text-base"
              />
            )}
          </div>

          <div className="space-y-2">
            <Label>Talen</Label>
            <div className="grid grid-cols-2 gap-2">
              {languageOptions.map((lang) => (
                <div key={lang} className="flex items-center gap-2">
                  <Checkbox
                    id={`lang-${lang}`}
                    checked={form.languages.includes(lang)}
                    onCheckedChange={() => toggleLanguage(lang)}
                  />
                  <Label htmlFor={`lang-${lang}`} className="text-sm cursor-pointer">{lang}</Label>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Section 2: Adres */}
        <div className="bg-card border rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Adres</h2>

          <AddressAutocomplete
            value={{ street: form.address_street, postal: form.address_postal, city: form.address_city, country: form.address_country, lat: form.address_lat, lng: form.address_lng }}
            onChange={(address) => setForm((f) => ({
              ...f,
              address_street: address.street,
              address_postal: address.postal,
              address_city: address.city,
              address_country: address.country ?? f.address_country,
              address_lat: address.lat ?? null,
              address_lng: address.lng ?? null,
            }))}
            gridClassName="grid-cols-2 gap-3"
            streetClassName="col-span-2"
            countryClassName="col-span-2"
            showCountry
            inputClassName="h-12 text-base"
          />
        </div>

        {/* Section 3: Werk & beschikbaarheid */}
        <div className="bg-card border rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Werk & beschikbaarheid</h2>

          <div className="space-y-1.5">
            <Label>Vaardigheden</Label>
            <TagInput value={form.skills} onChange={(v) => set('skills', v)} placeholder="bijv. heftruckcertificaat, lassen, timmerman" />
          </div>

          <div className="space-y-1.5">
            <Label>Certificaten</Label>
            <TagInput value={form.certifications} onChange={(v) => set('certifications', v)} placeholder="bijv. VCA, BHV" />
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="drivers-license"
                checked={form.has_drivers_license}
                onCheckedChange={(v) => set('has_drivers_license', !!v)}
              />
              <Label htmlFor="drivers-license" className="cursor-pointer">Ik heb een rijbewijs</Label>
            </div>
            {form.has_drivers_license && (
              <div className="space-y-1.5">
                <Label>Verloopdatum rijbewijs</Label>
                <Input type="date" value={form.drivers_license_expiry} onChange={(e) => set('drivers_license_expiry', e.target.value)} className="h-12 text-base" />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Beschikbaarheid</Label>
            <Textarea
              value={form.availability_notes}
              onChange={(e) => set('availability_notes', e.target.value)}
              placeholder="Wanneer kun je beginnen? Hoeveel uur per week?"
              rows={3}
              className="text-base"
            />
          </div>
        </div>

        {/* Section 4: Documenten */}
        <div className="bg-card border rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Documenten (optioneel)</h2>

          {/* Photo */}
          <div className="space-y-2">
            <Label>Profielfoto</Label>
            <div className="flex items-center gap-4">
              <div
                className="h-20 w-20 rounded-full bg-muted border-2 border-dashed border-border flex items-center justify-center overflow-hidden cursor-pointer shrink-0"
                onClick={() => photoInputRef.current?.click()}
              >
                {photoPreview ? (
                  <img src={photoPreview} alt="Profielfoto" className="h-full w-full object-cover" />
                ) : (
                  <User className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => photoInputRef.current?.click()}
                className="gap-2"
              >
                <Camera className="h-4 w-4" /> Foto kiezen
              </Button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="user"
                className="hidden"
                onChange={handlePhotoChange}
              />
            </div>
          </div>

          {/* CV */}
          <div className="space-y-2">
            <Label>CV uploaden</Label>
            <div
              className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => cvInputRef.current?.click()}
            >
              <Upload className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
              {cvFile ? (
                <p className="text-sm font-medium">{cvFile.name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Tik om een bestand te kiezen (PDF, Word, afbeelding)</p>
              )}
            </div>
            <input
              ref={cvInputRef}
              type="file"
              accept=".pdf,.doc,.docx,image/*"
              className="hidden"
              onChange={(e) => setCvFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        {/* Submit */}
        <Button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full h-14 text-lg font-semibold"
        >
          {submitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Opslaan...
            </>
          ) : (
            'Profiel opslaan'
          )}
        </Button>

        <p className="text-xs text-center text-muted-foreground pb-4">
          Je gegevens worden veilig opgeslagen en alleen gedeeld met je recruiter.
        </p>
      </div>
    </div>
  );
};

export default CandidateProfile;
