import { useState, useEffect } from 'react';
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

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

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
  });
  const [reglementAccepted, setReglementAccepted] = useState(false);
  const [docFiles, setDocFiles] = useState<{ id_bewijs: File | null; rijbewijs: File | null; certificaat: File | null }>({
    id_bewijs: null, rijbewijs: null, certificaat: null,
  });

  useEffect(() => {
    if (!token) { setStatus('error'); setErrorMsg('Geen token opgegeven'); return; }
    loadForm();
  }, [token]);

  const loadForm = async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/onboarding-submit?token=${token}`, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus('error');
        setErrorMsg(data.error || 'Link ongeldig');
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
    } catch {
      // If the GET endpoint doesn't exist yet, fall back
      setUseFallback(true);
      setStatus('ready');
    }
  };

  const setValue = (fieldId: string, value: string) => {
    setValues(v => ({ ...v, [fieldId]: value }));
    setValidationErrors(e => { const n = { ...e }; delete n[fieldId]; return n; });
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

  const handleSubmitDynamic = async () => {
    if (!validateStep(currentStep)) return;
    setSubmitting(true);

    try {
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
          documents_accepted: true,
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
  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

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

      const res = await fetch(`${SUPABASE_URL}/functions/v1/onboarding-submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ token, personal_data: fallbackForm, documents_accepted: reglementAccepted, documents }),
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
              <input type="file" className="hidden" onChange={e => {
                const file = e.target.files?.[0];
                if (file) {
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
              <Check className="h-8 w-8 text-primary" />
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
            <FileCheck className="h-10 w-10 text-primary mx-auto mb-3" />
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
              <div><Label>Straat + huisnummer</Label><Input value={fallbackForm.address_street} onChange={e => setFallback('address_street', e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Postcode</Label><Input value={fallbackForm.address_postal} onChange={e => setFallback('address_postal', e.target.value)} /></div>
                <div><Label>Stad</Label><Input value={fallbackForm.address_city} onChange={e => setFallback('address_city', e.target.value)} /></div>
              </div>
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
          <FileCheck className="h-10 w-10 text-primary mx-auto mb-3" />
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
              {step?.fields.map(renderField)}
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
