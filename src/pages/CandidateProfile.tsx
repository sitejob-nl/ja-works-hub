import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { getErrorMessage } from '@/lib/error-message';
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
import NationalitySelect from '@/components/shared/NationalitySelect';
import LanguageMultiSelect from '@/components/shared/LanguageMultiSelect';
import { normalizeNationality, normalizeLanguages } from '@/lib/candidate-options';

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
    first_name: '', last_name: '', phone: '', phone_nl: '', email: '',
    emergency_contact_name: '', emergency_contact_phone: '',
    date_of_birth: '', nationality: '',
    languages: [] as string[],
    has_dutch_address: false,
    address_street: '', address_postal: '', address_city: '', address_country: 'Nederland',
    address_lat: null as number | null, address_lng: null as number | null,
    skills: [] as string[], certifications: [] as string[],
    has_drivers_license: false, drivers_license_expiry: '',
    available_from: '', available_until: '', arrival_date: '',
    availability_notes: '',
  });

  // File state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cvInputRef = useRef<HTMLInputElement>(null);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

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
        const hasNlAddress = c.has_dutch_address ?? (!!c.address_city && !!c.address_street);
        setForm({
          first_name: c.first_name ?? '',
          last_name: c.last_name ?? '',
          phone: c.phone ?? '',
          phone_nl: c.phone_nl ?? '',
          email: c.email ?? '',
          emergency_contact_name: c.emergency_contact_name ?? '',
          emergency_contact_phone: c.emergency_contact_phone ?? '',
          date_of_birth: c.date_of_birth ?? '',
          nationality: normalizeNationality(c.nationality),
          languages: normalizeLanguages(c.languages ?? []),
          has_dutch_address: hasNlAddress,
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
          available_from: c.available_from ?? '',
          available_until: c.available_until ?? '',
          arrival_date: c.arrival_date ?? '',
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
      // B-upload: send files to the service-role edge function. The public page is
      // anonymous and the documents bucket is authenticated-only, so a direct upload
      // here silently fails — the candidate's CV/photo would be lost without warning.
      const fileToPayload = (file: File | null) =>
        new Promise<{ name: string; data: string } | null>((resolve) => {
          if (!file) return resolve(null);
          const reader = new FileReader();
          reader.onload = () => {
            const r = String(reader.result);
            resolve({ name: file.name, data: r.includes(',') ? r.split(',')[1] : r });
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        });
      const cv_file = await fileToPayload(cvFile);
      const photo_file = await fileToPayload(photoFile);

      const nationality = form.nationality;
      const languages = form.languages;
      const address = form.has_dutch_address
        ? await resolveAddressCoordinates({
            street: form.address_street,
            postal: form.address_postal,
            city: form.address_city,
            lat: form.address_lat,
            lng: form.address_lng,
          })
        : { lat: null, lng: null };

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
              phone_nl: form.phone_nl || undefined,
              emergency_contact_name: form.emergency_contact_name || undefined,
              emergency_contact_phone: form.emergency_contact_phone || undefined,
              email: form.email || undefined,
              date_of_birth: form.date_of_birth || undefined,
              nationality: nationality || undefined,
              languages: languages.length ? languages : undefined,
              has_dutch_address: form.has_dutch_address,
              address_street: form.has_dutch_address ? (form.address_street || undefined) : undefined,
              address_postal: form.has_dutch_address ? (form.address_postal || undefined) : undefined,
              address_city: form.has_dutch_address ? (form.address_city || undefined) : undefined,
              address_country: form.has_dutch_address ? (form.address_country || undefined) : undefined,
              address_lat: address.lat ?? undefined,
              address_lng: address.lng ?? undefined,
              skills: form.skills.length ? form.skills : undefined,
              certifications: form.certifications.length ? form.certifications : undefined,
              has_drivers_license: form.has_drivers_license,
              drivers_license_expiry: form.has_drivers_license && form.drivers_license_expiry ? form.drivers_license_expiry : undefined,
              available_from: form.available_from || undefined,
              available_until: form.available_until || undefined,
              arrival_date: form.arrival_date || undefined,
              availability_notes: form.availability_notes || undefined,
            },
            cv_file,
            photo_file,
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
      alert(getErrorMessage(err, 'Er is een fout opgetreden. Probeer het opnieuw.'));
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
            <Label>Telefoon (EU / buitenland)</Label>
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} type="tel" placeholder="bijv. +40 ..." className="h-12 text-base" />
          </div>

          <div className="space-y-1.5">
            <Label>Telefoon (Nederlands)</Label>
            <Input value={form.phone_nl} onChange={(e) => set('phone_nl', e.target.value)} type="tel" placeholder="bijv. +31 6 ..." className="h-12 text-base" />
          </div>

          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input value={form.email} onChange={(e) => set('email', e.target.value)} type="email" className="h-12 text-base" />
          </div>

          <div className="space-y-2 rounded-lg bg-muted/40 p-3">
            <Label className="text-sm font-medium">Noodcontact (ICE)</Label>
            <div className="space-y-1.5">
              <Input value={form.emergency_contact_name} onChange={(e) => set('emergency_contact_name', e.target.value)} placeholder="Naam noodcontact" className="h-12 text-base" />
              <Input value={form.emergency_contact_phone} onChange={(e) => set('emergency_contact_phone', e.target.value)} type="tel" placeholder="Telefoonnummer noodcontact" className="h-12 text-base" />
            </div>
            <p className="text-xs text-muted-foreground">Wie kunnen we bellen in geval van nood?</p>
          </div>

          <div className="space-y-1.5">
            <Label>Geboortedatum</Label>
            <Input value={form.date_of_birth} onChange={(e) => set('date_of_birth', e.target.value)} type="date" className="h-12 text-base" />
          </div>

          <div className="space-y-1.5">
            <Label>Nationaliteit</Label>
            <NationalitySelect value={form.nationality} onChange={(v) => set('nationality', v)} />
          </div>

          <div className="space-y-2">
            <Label>Talen</Label>
            <LanguageMultiSelect value={form.languages} onChange={(v) => set('languages', v)} />
          </div>
        </div>

        {/* Section 2: Adres */}
        <div className="bg-card border rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Adres</h2>

          <div className="flex items-start gap-2">
            <Checkbox
              id="has-dutch-address"
              checked={form.has_dutch_address}
              onCheckedChange={(v) => set('has_dutch_address', !!v)}
            />
            <Label htmlFor="has-dutch-address" className="text-sm cursor-pointer leading-snug">
              Ik heb al een (vast) adres in Nederland
            </Label>
          </div>

          {form.has_dutch_address ? (
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
          ) : (
            <p className="text-sm text-muted-foreground">
              Geen Nederlands adres? Geen probleem — je recruiter helpt je verder met huisvesting.
            </p>
          )}
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

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Beschikbaar vanaf</Label>
              <Input type="date" value={form.available_from} onChange={(e) => set('available_from', e.target.value)} className="h-12 text-base" />
            </div>
            <div className="space-y-1.5">
              <Label>Beschikbaar tot</Label>
              <Input type="date" value={form.available_until} onChange={(e) => set('available_until', e.target.value)} className="h-12 text-base" />
            </div>
            <div className="space-y-1.5">
              <Label>Aankomst/check-in</Label>
              <Input type="date" value={form.arrival_date} onChange={(e) => set('arrival_date', e.target.value)} className="h-12 text-base" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Extra beschikbaarheidsnotities</Label>
            <Textarea
              value={form.availability_notes}
              onChange={(e) => set('availability_notes', e.target.value)}
              placeholder="Opzegtermijn, gewenste uren, ploegendienst of andere bijzonderheden"
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
