import { useState, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Loader2, AlertTriangle, FileCheck, Upload, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import { resolveAddressCoordinates } from '@/lib/pdok';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

type PageState = 'loading' | 'ready' | 'submitted' | 'error';

type FormField = {
  id: string;
  label: string;
  field_type: string;
  is_required: boolean;
  placeholder: string | null;
  help_text: string | null;
  options: any;
  width: string | null;
  validation_regex: string | null;
  validation_message: string | null;
  maps_to_table: string | null;
  maps_to_column: string | null;
  document_type: string | null;
  sort_order: number;
};

type FormStep = {
  id: string;
  title: string;
  description: string | null;
  sort_order: number;
  fields: FormField[];
};

const ADDRESS_COLUMNS = ['address_street', 'address_postal', 'address_city'] as const;

const Onboarding = () => {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<PageState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [steps, setSteps] = useState<FormStep[]>([]);
  const [formId, setFormId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Fallback hardcoded fields if no dynamic form exists
  const [useFallback, setUseFallback] = useState(false);
  const [fallbackForm, setFallbackForm] = useState({
    bsn: '', iban: '', date_of_birth: '', nationality: '', phone: '', email: '',
    address_street: '', address_postal: '', address_city: '', address_country: 'NL',
    address_lat: null as number | null, address_lng: null as number | null,
  });
  const [reglementAccepted, setReglementAccepted] = useState(false);
  const [docFiles, setDocFiles] = useState<{ id_bewijs: File | null; rijbewijs: File | null; certificaat: File | null }>({
    id_bewijs: null, rijbewijs: null, certificaat: null,
  });

  const loadForm = useCallback(async () => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setStatus('error');
      setErrorMsg('Configuratiefout. Neem contact op met je intercedent.');
      return;
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/onboarding-submit?token=${encodeURIComponent(token!)}`, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus('error');
        setErrorMsg(data.error || `Link ongeldig (${res.status}). Vraag je intercedent om een nieuwe link.`);
        return;
      }

      if (data.form && data.form.steps && data.form.steps.length > 0) {
        setFormId(data.form.id);
        setSteps(data.form.steps);
        setUseFallback(false);
      } else {
        setUseFallback(true);
      }
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setErrorMsg('Kon de link niet openen. Controleer je internetverbinding en probeer opnieuw.');
    }
  }, [token]);

  useEffect(() => {
    if (!token) { setStatus('error'); setErrorMsg('Geen token opgegeven'); return; }
    loadForm();
  }, [loadForm, token]);

  const setValue = (fieldId: string, value: string) => {
    setValues(v => ({ ...v, [fieldId]: value }));
    setValidationErrors(e => { const n = { ...e }; delete n[fieldId]; return n; });
  };

  const getAddressFields = (fields: FormField[]) => ({
    street: fields.find(field => field.maps_to_table === 'candidates' && field.maps_to_column === 'address_street'),
    postal: fields.find(field => field.maps_to_table === 'candidates' && field.maps_to_column === 'address_postal'),
    city: fields.find(field => field.maps_to_table === 'candidates' && field.maps_to_column === 'address_city'),
  });

  const isAddressField = (field: FormField) =>
    field.maps_to_table === 'candidates' &&
    ADDRESS_COLUMNS.includes(field.maps_to_column as typeof ADDRESS_COLUMNS[number]);

  const resolveDynamicAddressGeo = async () => {
    const fields = steps.flatMap(step => step.fields);
    const addressFields = getAddressFields(fields);
    if (!addressFields.street || !addressFields.postal || !addressFields.city) return null;

    const address = await resolveAddressCoordinates({
      street: values[addressFields.street.id] ?? '',
      postal: values[addressFields.postal.id] ?? '',
      city: values[addressFields.city.id] ?? '',
    });

    if (address.lat == null || address.lng == null) return null;
    return { address_lat: address.lat, address_lng: address.lng };
  };

  const validateStep = (stepIndex: number): boolean => {
    const step = steps[stepIndex];
    if (!step) return true;
    const errors: Record<string, string> = {};

    step.fields.forEach(field => {
      if (field.field_type === 'heading') return;
      const val = values[field.id] ?? '';

      if (field.is_required && !val && !files[field.id]) {
        errors[field.id] = 'Dit veld is verplicht';
      }

      if (val && field.validation_regex) {
        try {
          if (!new RegExp(field.validation_regex).test(val)) {
            errors[field.id] = field.validation_message || 'Ongeldige invoer';
          }
        } catch { /* invalid regex, skip */ }
      }
    });

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(s => Math.min(s + 1, steps.length - 1));
    }
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleSubmitDynamic = async () => {
    if (!validateStep(currentStep)) return;
    setSubmitting(true);

    try {
      const addressGeo = await resolveDynamicAddressGeo();
      const fileFields = steps.flatMap(step => step.fields).filter(field => field.field_type === 'file');
      const documents: Array<{ type: string; name: string; data: string }> = [];

      for (const field of fileFields) {
        const file = files[field.id];
        if (!file) continue;
        if (file.size > 10 * 1024 * 1024) {
          throw new Error(`${field.label} is groter dan 10MB`);
        }
        documents.push({
          type: field.document_type || 'onboarding_formulier',
          name: file.name,
          data: await fileToBase64(file),
        });
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/onboarding-submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          token,
          form_id: formId,
          responses: values,
          address_geo: addressGeo,
          documents_accepted: true,
          documents,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fout bij indienen');

      setStatus('submitted');
      toast.success('Gegevens succesvol ingediend!');
    } catch (err: any) {
      toast.error(err.message);
      if (err.message.includes('verlopen') || err.message.includes('gebruikt') || err.message.includes('Ongeldig')) {
        setStatus('error');
        setErrorMsg(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Fallback submit (old behavior)
  const handleSubmitFallback = async () => {
    if (!fallbackForm.bsn || !fallbackForm.iban || !fallbackForm.date_of_birth) {
      toast.error('Vul alle verplichte velden in (BSN, IBAN, geboortedatum)');
      return;
    }
    setSubmitting(true);
    try {
      // Prepare document uploads as base64
      const documents: Array<{ type: string; name: string; data: string }> = [];
      for (const [type, file] of Object.entries(docFiles)) {
        if (file && file.size <= 10 * 1024 * 1024) {
          documents.push({ type, name: file.name, data: await fileToBase64(file) });
        }
      }
      const address = await resolveAddressCoordinates({
        street: fallbackForm.address_street,
        postal: fallbackForm.address_postal,
        city: fallbackForm.address_city,
        lat: fallbackForm.address_lat,
        lng: fallbackForm.address_lng,
      });

      const res = await fetch(`${SUPABASE_URL}/functions/v1/onboarding-submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          token,
          personal_data: { ...fallbackForm, address_lat: address.lat, address_lng: address.lng },
          documents_accepted: reglementAccepted,
          documents,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fout bij indienen');
      setStatus('submitted');
      toast.success('Gegevens succesvol ingediend!');
    } catch (err: any) {
      toast.error(err.message);
      if (err.message.includes('verlopen') || err.message.includes('gebruikt') || err.message.includes('Ongeldig')) {
        setStatus('error');
        setErrorMsg(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const setFallback = (k: string, v: string) => setFallbackForm(f => ({ ...f, [k]: v }));

  // ── Render field ──
  const renderField = (field: FormField) => {
    if (field.field_type === 'heading') {
      return <h3 key={field.id} className="text-sm font-semibold text-foreground pt-2">{field.label}</h3>;
    }

    const val = values[field.id] ?? '';
    const err = validationErrors[field.id];
    const widthClass = field.width === 'half' ? 'col-span-1' : 'col-span-2';

    return (
      <div key={field.id} className={widthClass}>
        <Label className="text-sm">
          {field.label} {field.is_required && <span className="text-destructive">*</span>}
        </Label>

        {field.field_type === 'text' && (
          <Input value={val} onChange={e => setValue(field.id, e.target.value)} placeholder={field.placeholder ?? ''} />
        )}
        {field.field_type === 'email' && (
          <Input type="email" value={val} onChange={e => setValue(field.id, e.target.value)} placeholder={field.placeholder ?? ''} />
        )}
        {field.field_type === 'tel' && (
          <Input type="tel" value={val} onChange={e => setValue(field.id, e.target.value)} placeholder={field.placeholder ?? ''} />
        )}
        {field.field_type === 'date' && (
          <Input type="date" value={val} onChange={e => setValue(field.id, e.target.value)} />
        )}
        {field.field_type === 'number' && (
          <Input type="number" value={val} onChange={e => setValue(field.id, e.target.value)} placeholder={field.placeholder ?? ''} />
        )}
        {field.field_type === 'textarea' && (
          <Textarea value={val} onChange={e => setValue(field.id, e.target.value)} placeholder={field.placeholder ?? ''} rows={3} />
        )}
        {field.field_type === 'select' && Array.isArray(field.options) && (
          <Select value={val} onValueChange={v => setValue(field.id, v)}>
            <SelectTrigger><SelectValue placeholder={field.placeholder || 'Selecteer...'} /></SelectTrigger>
            <SelectContent>
              {field.options.map((opt: string) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {field.field_type === 'checkbox' && (
          <div className="flex items-center gap-2 mt-1">
            <Checkbox checked={val === 'true'} onCheckedChange={v => setValue(field.id, v ? 'true' : 'false')} />
            <span className="text-sm text-muted-foreground">{field.help_text}</span>
          </div>
        )}
        {field.field_type === 'file' && (
          <div className="mt-1">
            <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed cursor-pointer hover:bg-secondary/50 transition-colors">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {files[field.id] ? files[field.id].name : 'Bestand kiezen...'}
              </span>
              <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => {
                const file = e.target.files?.[0];
                if (file) {
                  if (file.size > 10 * 1024 * 1024) {
                    setValidationErrors(errors => ({ ...errors, [field.id]: 'Bestand mag maximaal 10MB zijn' }));
                    return;
                  }
                  setFiles(f => ({ ...f, [field.id]: file }));
                  setValue(field.id, file.name);
                }
              }} />
            </label>
          </div>
        )}

        {field.help_text && field.field_type !== 'checkbox' && (
          <p className="text-xs text-muted-foreground mt-0.5">{field.help_text}</p>
        )}
        {err && <p className="text-xs text-destructive mt-0.5">{err}</p>}
      </div>
    );
  };

  const renderAddressGroup = (addressFields: ReturnType<typeof getAddressFields>) => {
    if (!addressFields.street || !addressFields.postal || !addressFields.city) return null;

    const clearAddressErrors = () => {
      setValidationErrors(errors => {
        const next = { ...errors };
        delete next[addressFields.street!.id];
        delete next[addressFields.postal!.id];
        delete next[addressFields.city!.id];
        return next;
      });
    };

    const addressErrors = [addressFields.street, addressFields.postal, addressFields.city]
      .map(field => validationErrors[field.id])
      .filter(Boolean);

    return (
      <div key="pdok-address" className="col-span-2">
        <AddressAutocomplete
          value={{
            street: values[addressFields.street.id] ?? '',
            postal: values[addressFields.postal.id] ?? '',
            city: values[addressFields.city.id] ?? '',
          }}
          onChange={(address) => {
            setValues(current => ({
              ...current,
              [addressFields.street!.id]: address.street,
              [addressFields.postal!.id]: address.postal,
              [addressFields.city!.id]: address.city,
            }));
            clearAddressErrors();
          }}
          gridClassName="grid-cols-2 gap-3"
          streetClassName="col-span-2"
          streetLabel={addressFields.street.label}
          postalLabel={addressFields.postal.label}
          cityLabel={addressFields.city.label}
          required={addressFields.street.is_required || addressFields.postal.is_required || addressFields.city.is_required}
        />
        {addressErrors.length > 0 && (
          <p className="text-xs text-destructive mt-1">{addressErrors[0]}</p>
        )}
      </div>
    );
  };

  const renderStepFields = (stepToRender: FormStep | undefined) => {
    if (!stepToRender) return null;

    const addressFields = getAddressFields(stepToRender.fields);
    const hasAddressGroup = !!addressFields.street && !!addressFields.postal && !!addressFields.city;
    let renderedAddress = false;

    return stepToRender.fields.map(field => {
      if (hasAddressGroup && isAddressField(field)) {
        if (renderedAddress) return null;
        renderedAddress = true;
        return renderAddressGroup(addressFields);
      }

      return renderField(field);
    });
  };

  // ── Status screens ──
  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full">
          <CardContent className="flex flex-col items-center py-12">
            <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-lg font-semibold mb-2">Link ongeldig</h2>
            <p className="text-sm text-muted-foreground text-center">{errorMsg}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'submitted') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full">
          <CardContent className="flex flex-col items-center py-12">
            <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Check className="h-8 w-8 text-stat-blue" />
            </div>
            <h2 className="text-lg font-semibold mb-2">Bedankt!</h2>
            <p className="text-sm text-muted-foreground text-center">Je gegevens zijn succesvol ingediend. Je kunt dit venster sluiten.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Fallback (old hardcoded form) ──
  if (useFallback) {
    return (
      <div className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-lg mx-auto space-y-6">
          <div className="text-center">
            <FileCheck className="h-10 w-10 text-stat-blue mx-auto mb-3" />
            <h1 className="text-2xl font-bold">Onboarding</h1>
            <p className="text-sm text-muted-foreground mt-1">Vul je persoonlijke gegevens in om je onboarding af te ronden</p>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Persoonlijke gegevens</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div><Label>BSN *</Label><Input value={fallbackForm.bsn} onChange={e => setFallback('bsn', e.target.value)} placeholder="123456789" /></div>
              <div><Label>IBAN *</Label><Input value={fallbackForm.iban} onChange={e => setFallback('iban', e.target.value)} placeholder="NL00BANK0123456789" /></div>
              <div><Label>Geboortedatum *</Label><Input type="date" value={fallbackForm.date_of_birth} onChange={e => setFallback('date_of_birth', e.target.value)} /></div>
              <div><Label>Nationaliteit</Label><Input value={fallbackForm.nationality} onChange={e => setFallback('nationality', e.target.value)} placeholder="Nederlands" /></div>
              <div><Label>Telefoonnummer</Label><Input value={fallbackForm.phone} onChange={e => setFallback('phone', e.target.value)} placeholder="+31 6 12345678" /></div>
              <div><Label>E-mail</Label><Input type="email" value={fallbackForm.email} onChange={e => setFallback('email', e.target.value)} /></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Adresgegevens</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <AddressAutocomplete
                value={{
                  street: fallbackForm.address_street,
                  postal: fallbackForm.address_postal,
                  city: fallbackForm.address_city,
                  country: fallbackForm.address_country,
                  lat: fallbackForm.address_lat,
                  lng: fallbackForm.address_lng,
                }}
                onChange={(address) => setFallbackForm((f) => ({
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
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Documenten uploaden</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>ID-bewijs (paspoort/identiteitskaart)</Label>
                <Input type="file" accept="image/*,.pdf" onChange={e => setDocFiles(prev => ({ ...prev, id_bewijs: e.target.files?.[0] ?? null }))} />
              </div>
              <div>
                <Label>Rijbewijs (optioneel)</Label>
                <Input type="file" accept="image/*,.pdf" onChange={e => setDocFiles(prev => ({ ...prev, rijbewijs: e.target.files?.[0] ?? null }))} />
              </div>
              <div>
                <Label>Certificaat (optioneel)</Label>
                <Input type="file" accept="image/*,.pdf" onChange={e => setDocFiles(prev => ({ ...prev, certificaat: e.target.files?.[0] ?? null }))} />
              </div>
              <p className="text-xs text-muted-foreground">Foto of PDF, max 10MB per bestand</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Reglement</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-start gap-3">
                <Checkbox id="reglement" checked={reglementAccepted} onCheckedChange={(v) => setReglementAccepted(v === true)} />
                <label htmlFor="reglement" className="text-sm leading-5">Ik heb het bedrijfsreglement gelezen en ga hiermee akkoord.</label>
              </div>
            </CardContent>
          </Card>

          <Button onClick={handleSubmitFallback} disabled={submitting} className="w-full" size="lg">
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Indienen...</> : 'Gegevens indienen'}
          </Button>
        </div>
      </div>
    );
  }

  // ── Dynamic form ──
  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center">
          <FileCheck className="h-10 w-10 text-stat-blue mx-auto mb-3" />
          <h1 className="text-2xl font-bold">Onboarding</h1>
          <p className="text-sm text-muted-foreground mt-1">Vul je gegevens in om je onboarding af te ronden</p>
        </div>

        {/* Step indicator */}
        {steps.length > 1 && (
          <div className="flex items-center justify-center gap-2">
            {steps.map((s, i) => (
              <div key={s.id} className={`h-2 rounded-full transition-all ${i === currentStep ? 'w-8 bg-primary' : i < currentStep ? 'w-4 bg-primary/40' : 'w-4 bg-muted'}`} />
            ))}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{step?.title}</CardTitle>
            {step?.description && <p className="text-sm text-muted-foreground">{step.description}</p>}
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {renderStepFields(step)}
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          {currentStep > 0 && (
            <Button variant="outline" onClick={() => setCurrentStep(s => s - 1)} className="flex-1">
              <ChevronLeft className="h-4 w-4 mr-1" /> Vorige
            </Button>
          )}
          {isLastStep ? (
            <Button onClick={handleSubmitDynamic} disabled={submitting} className="flex-1" size="lg">
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Indienen...</> : 'Gegevens indienen'}
            </Button>
          ) : (
            <Button onClick={handleNext} className="flex-1">
              Volgende <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
