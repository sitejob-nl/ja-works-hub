import { useState, useCallback, useEffect, useMemo, type DragEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  Check, Loader2, AlertTriangle, FileCheck, Upload, ChevronLeft, ChevronRight,
  ShieldCheck, Clock, ListChecks, X, Phone,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import AddressAutocomplete from '@/components/shared/AddressAutocomplete';
import HelpDot from '@/components/shared/HelpDot';
import { resolveFieldHelp } from '@/lib/onboarding-help';
import { isValidBsn, isValidIban } from '@/lib/nl-validate';
import { resolveAddressCoordinates } from '@/lib/pdok';
import { allowFileDrop, getDroppedFiles } from '@/lib/file-input';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

type PageState = 'loading' | 'intro' | 'form' | 'submitted' | 'error';

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

type FormMeta = {
  firstName: string | null;
  orgName: string | null;
  orgLogo: string | null;
};

const ADDRESS_COLUMNS = ['address_street', 'address_postal', 'address_city'] as const;
// BSN/IBAN bewaren we bewust niet in localStorage (AVG): alleen niet-gevoelige velden in het concept.
const SENSITIVE_COLUMNS = ['bsn', 'iban'];
const SENSITIVE_LABEL = /\bbsn\b|burgerservice|\biban\b|rekeningnummer|bankrekening/i;

const draftKey = (token: string) => `ja-onboarding-${token.slice(0, 16)}`;

const formatFileSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;

// DB kent 'file_upload'; oudere formulieren kunnen 'file' bevatten — beide renderen als upload.
const isFileField = (field: FormField) => field.field_type === 'file' || field.field_type === 'file_upload';

const isSensitiveField = (field: FormField) =>
  (field.maps_to_column != null && SENSITIVE_COLUMNS.includes(field.maps_to_column)) ||
  SENSITIVE_LABEL.test(field.label);

const Onboarding = () => {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<PageState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [steps, setSteps] = useState<FormStep[]>([]);
  const [formId, setFormId] = useState('');
  const [meta, setMeta] = useState<FormMeta>({ firstName: null, orgName: null, orgLogo: null });
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [hasDraft, setHasDraft] = useState(false);

  // Fallback hardcoded fields if no dynamic form exists
  const [useFallback, setUseFallback] = useState(false);
  const [fallbackForm, setFallbackForm] = useState({
    bsn: '', iban: '', date_of_birth: '', nationality: '', phone: '', email: '',
    address_street: '', address_postal: '', address_city: '', address_country: 'NL',
    address_lat: null as number | null, address_lng: null as number | null,
  });
  const [fallbackErrors, setFallbackErrors] = useState<Record<string, string>>({});
  const [reglementAccepted, setReglementAccepted] = useState(false);
  const [docFiles, setDocFiles] = useState<{ id_bewijs: File | null; rijbewijs: File | null; certificaat: File | null }>({
    id_bewijs: null, rijbewijs: null, certificaat: null,
  });

  const loadForm = useCallback(async () => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setStatus('error');
      setErrorMsg('Configuratiefout. Neem contact op met je contactpersoon.');
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
        setErrorMsg(data.error || `Link ongeldig (${res.status}). Vraag je contactpersoon om een nieuwe link.`);
        return;
      }

      setMeta({
        firstName: data.candidate_first_name ?? null,
        orgName: data.organization_name ?? null,
        orgLogo: data.organization_logo ?? null,
      });

      if (data.form && data.form.steps && data.form.steps.length > 0) {
        setFormId(data.form.id);
        setSteps(data.form.steps);
        setUseFallback(false);
      } else {
        setUseFallback(true);
      }

      // Eerder opgeslagen concept terugzetten (zonder gevoelige velden)
      try {
        const raw = localStorage.getItem(draftKey(token!));
        if (raw) {
          const draft = JSON.parse(raw);
          if (draft && typeof draft === 'object') {
            if (draft.values && typeof draft.values === 'object') {
              setValues(draft.values);
              setHasDraft(Object.keys(draft.values).length > 0);
            }
            if (typeof draft.step === 'number') setCurrentStep(draft.step);
            if (draft.fallback && typeof draft.fallback === 'object') {
              setFallbackForm(f => ({ ...f, ...draft.fallback }));
              setHasDraft(true);
            }
          }
        }
      } catch { /* corrupt concept negeren */ }

      setStatus('intro');
    } catch {
      setStatus('error');
      setErrorMsg('Kon de link niet openen. Controleer je internetverbinding en probeer opnieuw.');
    }
  }, [token]);

  useEffect(() => {
    if (!token) { setStatus('error'); setErrorMsg('Geen token opgegeven'); return; }
    loadForm();
  }, [loadForm, token]);

  // Concept automatisch bewaren zodat niets verloren gaat bij sluiten/refreshen
  useEffect(() => {
    if (status !== 'form' || !token) return;
    const timer = setTimeout(() => {
      try {
        const sensitiveIds = new Set(
          steps.flatMap(s => s.fields).filter(isSensitiveField).map(f => f.id),
        );
        const safeValues = Object.fromEntries(
          Object.entries(values).filter(([id]) => !sensitiveIds.has(id)),
        );
        const { bsn: _bsn, iban: _iban, ...safeFallback } = fallbackForm;
        localStorage.setItem(draftKey(token), JSON.stringify({
          values: safeValues,
          step: currentStep,
          fallback: useFallback ? safeFallback : undefined,
        }));
      } catch { /* opslag vol/geblokkeerd — geen probleem */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [values, fallbackForm, currentStep, status, steps, token, useFallback]);

  const clearDraft = () => {
    try { if (token) localStorage.removeItem(draftKey(token)); } catch { /* ignore */ }
  };

  const setValue = (fieldId: string, value: string) => {
    setValues(v => ({ ...v, [fieldId]: value }));
    setValidationErrors(e => { const n = { ...e }; delete n[fieldId]; return n; });
  };

  const selectDynamicFile = (fieldId: string, file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setValidationErrors(errors => ({ ...errors, [fieldId]: 'Bestand mag maximaal 10MB zijn' }));
      return;
    }
    setFiles(f => ({ ...f, [fieldId]: file }));
    setValue(fieldId, file.name);
  };

  const removeDynamicFile = (fieldId: string) => {
    setFiles(f => { const n = { ...f }; delete n[fieldId]; return n; });
    setValue(fieldId, '');
  };

  const handleDynamicFileDrop = (fieldId: string) => (event: DragEvent<HTMLLabelElement>) => {
    const [droppedFile] = getDroppedFiles(event);
    if (droppedFile) selectDynamicFile(fieldId, droppedFile);
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

  const scrollToField = (fieldId: string) => {
    requestAnimationFrame(() => {
      document.querySelector(`[data-field-id="${fieldId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  /** Slimme extra checks bovenop verplicht/regex: BSN-elfproef, IBAN-checksum, e-mail. */
  const smartFieldError = (field: FormField, val: string): string | null => {
    if (!val) return null;
    const col = field.maps_to_column ?? '';
    const label = field.label;
    if (col === 'bsn' || /\bbsn\b|burgerservice/i.test(label)) {
      if (!isValidBsn(val)) return 'Dit is geen geldig BSN. Controleer of je alle 9 cijfers goed hebt overgenomen.';
    }
    if (col === 'iban' || /\biban\b|rekeningnummer|bankrekening/i.test(label)) {
      if (!isValidIban(val)) return 'Dit is geen geldig IBAN. Controleer je rekeningnummer (bijv. NL12ABCD0123456789).';
    }
    if (field.field_type === 'email' && !/^\S+@\S+\.\S+$/.test(val)) {
      return 'Dit is geen geldig e-mailadres.';
    }
    if (field.field_type === 'tel' && val.replace(/\D/g, '').length < 8) {
      return 'Dit telefoonnummer lijkt te kort.';
    }
    return null;
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
        return;
      }

      if (val && field.validation_regex) {
        try {
          if (!new RegExp(field.validation_regex).test(val)) {
            errors[field.id] = field.validation_message || 'Ongeldige invoer';
            return;
          }
        } catch { /* invalid regex, skip */ }
      }

      const smart = smartFieldError(field, val);
      if (smart) errors[field.id] = smart;
    });

    setValidationErrors(errors);
    const firstError = step.fields.find(f => errors[f.id]);
    if (firstError) scrollToField(firstError.id);
    return Object.keys(errors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(s => Math.min(s + 1, steps.length - 1));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleBack = () => {
    setCurrentStep(s => Math.max(0, s - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
      const fileFields = steps.flatMap(step => step.fields).filter(isFileField);
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

      clearDraft();
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
    const errors: Record<string, string> = {};
    if (!fallbackForm.bsn) errors.bsn = 'Dit veld is verplicht';
    else if (!isValidBsn(fallbackForm.bsn)) errors.bsn = 'Dit is geen geldig BSN. Controleer of je alle 9 cijfers goed hebt overgenomen.';
    if (!fallbackForm.iban) errors.iban = 'Dit veld is verplicht';
    else if (!isValidIban(fallbackForm.iban)) errors.iban = 'Dit is geen geldig IBAN. Controleer je rekeningnummer.';
    if (!fallbackForm.date_of_birth) errors.date_of_birth = 'Dit veld is verplicht';
    if (fallbackForm.email && !/^\S+@\S+\.\S+$/.test(fallbackForm.email)) errors.email = 'Dit is geen geldig e-mailadres.';
    setFallbackErrors(errors);
    if (Object.keys(errors).length > 0) {
      const firstId = Object.keys(errors)[0];
      requestAnimationFrame(() => {
        document.querySelector(`[data-field-id="fb-${firstId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
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
      clearDraft();
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

  const setFallback = (k: string, v: string) => {
    setFallbackForm(f => ({ ...f, [k]: v }));
    setFallbackErrors(e => { const n = { ...e }; delete n[k]; return n; });
  };

  // ── Afgeleiden voor intro-scherm ──
  const allFields = useMemo(() => steps.flatMap(s => s.fields), [steps]);
  const neededDocs = useMemo(() => {
    if (useFallback) return ['Paspoort of ID-kaart', 'Bankpas of bank-app (voor je IBAN)', 'Rijbewijs en certificaten (als je die hebt)'];
    const docs = allFields.filter(isFileField).map(f => f.label);
    const needsBankInfo = allFields.some(f => f.maps_to_column === 'iban' || /\biban\b/i.test(f.label));
    return [...docs, ...(needsBankInfo ? ['Bankpas of bank-app (voor je IBAN)'] : [])];
  }, [allFields, useFallback]);
  const estimatedMinutes = useMemo(() => {
    const count = useFallback ? 12 : allFields.filter(f => f.field_type !== 'heading').length;
    return Math.max(2, Math.ceil((count * 25) / 60));
  }, [allFields, useFallback]);

  // ── Gedeelde bouwstenen ──
  const orgLabel = meta.orgName || 'je uitzendbureau';

  // Render-functie (géén component): een inline component-type zou bij elke render
  // remounten en daarmee de focus uit het actieve invoerveld slopen.
  const renderShell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-muted/30 py-6 px-4 sm:py-10">
      <div className="max-w-lg mx-auto space-y-5">
        <div className="flex items-center justify-center gap-3">
          {meta.orgLogo ? (
            <img src={meta.orgLogo} alt={orgLabel} className="h-10 max-w-[160px] object-contain" />
          ) : (
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <FileCheck className="h-5 w-5 text-primary" />
              </div>
              {meta.orgName && <span className="font-semibold">{meta.orgName}</span>}
            </div>
          )}
        </div>
        {children}
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground pb-4">
          <ShieldCheck className="h-3.5 w-3.5" />
          Beveiligde verbinding — je gegevens worden versleuteld opgeslagen
        </p>
      </div>
    </div>
  );

  const requiredLabel = (label: string, required: boolean, help: ReturnType<typeof resolveFieldHelp>) => (
    <Label className="text-sm inline-flex items-center gap-1.5">
      {label} {required && <span className="text-destructive">*</span>}
      {help && <HelpDot title={help.title}>{help.text}</HelpDot>}
    </Label>
  );

  // ── Render dynamic field ──
  const renderField = (field: FormField) => {
    if (field.field_type === 'heading') {
      return <h3 key={field.id} className="text-sm font-semibold text-foreground pt-2 sm:col-span-2">{field.label}</h3>;
    }

    const val = values[field.id] ?? '';
    const err = validationErrors[field.id];
    const help = resolveFieldHelp(field);
    const widthClass = field.width === 'half' ? 'sm:col-span-1' : 'sm:col-span-2';
    const inputClass = err ? 'border-destructive focus-visible:ring-destructive' : '';

    return (
      <div key={field.id} className={`space-y-1 ${widthClass}`} data-field-id={field.id}>
        {requiredLabel(field.label, field.is_required, help)}

        {field.field_type === 'text' && (
          <Input className={`h-11 ${inputClass}`} value={val} onChange={e => setValue(field.id, e.target.value)} placeholder={field.placeholder ?? ''} />
        )}
        {field.field_type === 'email' && (
          <Input className={`h-11 ${inputClass}`} type="email" inputMode="email" autoComplete="email" value={val} onChange={e => setValue(field.id, e.target.value)} placeholder={field.placeholder ?? ''} />
        )}
        {field.field_type === 'tel' && (
          <Input className={`h-11 ${inputClass}`} type="tel" inputMode="tel" autoComplete="tel" value={val} onChange={e => setValue(field.id, e.target.value)} placeholder={field.placeholder ?? ''} />
        )}
        {field.field_type === 'date' && (
          <Input className={`h-11 ${inputClass}`} type="date" value={val} onChange={e => setValue(field.id, e.target.value)} />
        )}
        {field.field_type === 'number' && (
          <Input className={`h-11 ${inputClass}`} type="number" inputMode="numeric" value={val} onChange={e => setValue(field.id, e.target.value)} placeholder={field.placeholder ?? ''} />
        )}
        {field.field_type === 'textarea' && (
          <Textarea className={inputClass} value={val} onChange={e => setValue(field.id, e.target.value)} placeholder={field.placeholder ?? ''} rows={3} />
        )}
        {field.field_type === 'select' && Array.isArray(field.options) && (
          <Select value={val} onValueChange={v => setValue(field.id, v)}>
            <SelectTrigger className={`h-11 ${inputClass}`}><SelectValue placeholder={field.placeholder || 'Selecteer...'} /></SelectTrigger>
            <SelectContent>
              {field.options.map((opt: string) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {field.field_type === 'checkbox' && (
          <div className="flex items-start gap-2 mt-1">
            <Checkbox checked={val === 'true'} onCheckedChange={v => setValue(field.id, v ? 'true' : 'false')} className="mt-0.5" />
            <span className="text-sm text-muted-foreground">{field.help_text}</span>
          </div>
        )}
        {isFileField(field) && (
          files[field.id] ? (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-primary/40 bg-primary/5">
              <FileCheck className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm truncate flex-1">{files[field.id].name}</span>
              <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(files[field.id].size)}</span>
              <button
                type="button"
                aria-label={`${field.label} verwijderen`}
                onClick={() => removeDynamicFile(field.id)}
                className="text-muted-foreground hover:text-destructive shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <label
              className={`flex items-center gap-2 px-3 py-3 rounded-md border border-dashed cursor-pointer hover:bg-secondary/50 transition-colors ${err ? 'border-destructive' : ''}`}
              onDragOver={allowFileDrop}
              onDrop={handleDynamicFileDrop(field.id)}
            >
              <Upload className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm text-muted-foreground">Maak een foto of kies een bestand…</span>
              <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => {
                const file = e.target.files?.[0];
                if (file) selectDynamicFile(field.id, file);
              }} />
            </label>
          )
        )}

        {field.help_text && field.field_type !== 'checkbox' && (
          <p className="text-xs text-muted-foreground">{field.help_text}</p>
        )}
        {err && <p className="text-xs text-destructive font-medium">{err}</p>}
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

    const help = resolveFieldHelp({ label: 'Adres', maps_to_column: 'address_street' });

    return (
      <div key="pdok-address" className="sm:col-span-2" data-field-id={addressFields.street.id}>
        <div className="mb-1">
          {help && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium">
              Adres <HelpDot title={help.title}>{help.text}</HelpDot>
            </span>
          )}
        </div>
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
          <p className="text-xs text-destructive font-medium mt-1">{addressErrors[0]}</p>
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
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Formulier laden…</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
        <Card className="max-w-md w-full">
          <CardContent className="flex flex-col items-center py-12">
            <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-lg font-semibold mb-2">Deze link werkt niet meer</h2>
            <p className="text-sm text-muted-foreground text-center">{errorMsg}</p>
            <p className="text-sm text-muted-foreground text-center mt-3 flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" />
              Neem contact op met je contactpersoon voor een nieuwe link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'submitted') {
    return renderShell(
        <Card>
          <CardContent className="flex flex-col items-center py-10 px-6">
            <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Check className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold mb-1">Bedankt{meta.firstName ? `, ${meta.firstName}` : ''}!</h2>
            <p className="text-sm text-muted-foreground text-center mb-6">Je gegevens zijn succesvol verstuurd.</p>
            <div className="w-full space-y-3 text-sm">
              <p className="font-medium">Wat gebeurt er nu?</p>
              <div className="flex gap-3">
                <span className="h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0">1</span>
                <p className="text-muted-foreground">Wij controleren je gegevens en documenten.</p>
              </div>
              <div className="flex gap-3">
                <span className="h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0">2</span>
                <p className="text-muted-foreground">Je contactpersoon neemt contact met je op over de volgende stap.</p>
              </div>
              <div className="flex gap-3">
                <span className="h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0">3</span>
                <p className="text-muted-foreground">Vragen? Bel of app je contactpersoon — die helpt je graag.</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-6">Je kunt dit venster nu sluiten.</p>
          </CardContent>
        </Card>
    );
  }

  // ── Intro / welkom ──
  if (status === 'intro') {
    return renderShell(
        <Card>
          <CardContent className="py-8 px-6 space-y-5">
            <div className="text-center space-y-1">
              <h1 className="text-2xl font-bold">
                Welkom{meta.firstName ? `, ${meta.firstName}` : ''}!
              </h1>
              <p className="text-sm text-muted-foreground">
                Leuk dat je bij {orgLabel} komt werken. Vul je gegevens in, dan regelen wij de rest.
              </p>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-primary shrink-0" />
                <span>Duurt ongeveer <strong>{estimatedMinutes} minuten</strong></span>
              </div>
              {neededDocs.length > 0 && (
                <div className="flex gap-3">
                  <ListChecks className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="mb-1">Houd dit bij de hand:</p>
                    <ul className="text-muted-foreground space-y-0.5">
                      {neededDocs.map(doc => <li key={doc}>• {doc}</li>)}
                    </ul>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                <span className="text-muted-foreground">Je gegevens worden versleuteld en veilig opgeslagen.</span>
              </div>
            </div>

            {hasDraft && (
              <p className="text-sm bg-primary/5 border border-primary/20 rounded-md px-3 py-2">
                We hebben je eerdere invoer bewaard — je gaat verder waar je was gebleven.
              </p>
            )}

            <Button onClick={() => setStatus('form')} className="w-full" size="lg">
              {hasDraft ? 'Verdergaan' : 'Beginnen'} <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Zie je een <HelpCircleInline /> bij een veld? Tik erop voor uitleg.
            </p>
          </CardContent>
        </Card>
    );
  }

  // ── Fallback (old hardcoded form) ──
  if (useFallback) {
    const bsnHelp = resolveFieldHelp({ label: 'BSN', maps_to_column: 'bsn' });
    const ibanHelp = resolveFieldHelp({ label: 'IBAN', maps_to_column: 'iban' });
    const natHelp = resolveFieldHelp({ label: 'Nationaliteit', maps_to_column: 'nationality' });
    const phoneHelp = resolveFieldHelp({ label: 'Telefoonnummer', maps_to_column: 'phone' });
    const emailHelp = resolveFieldHelp({ label: 'E-mail', maps_to_column: 'email' });
    const dobHelp = resolveFieldHelp({ label: 'Geboortedatum', maps_to_column: 'date_of_birth' });
    const idHelp = resolveFieldHelp({ label: 'ID-bewijs', document_type: 'id_bewijs' });
    const rijbewijsHelp = resolveFieldHelp({ label: 'Rijbewijs', document_type: 'rijbewijs' });
    const certHelp = resolveFieldHelp({ label: 'Certificaat', document_type: 'certificaat' });

    const fbField = (key: keyof typeof fallbackForm, label: string, help: ReturnType<typeof resolveFieldHelp>, input: React.ReactNode, required = false) => (
      <div className="space-y-1" data-field-id={`fb-${key}`}>
        {requiredLabel(label, required, help)}
        {input}
        {fallbackErrors[key] && <p className="text-xs text-destructive font-medium">{fallbackErrors[key]}</p>}
      </div>
    );

    return renderShell(
      <>
        <div className="text-center">
          <h1 className="text-xl font-bold">Je gegevens</h1>
          <p className="text-sm text-muted-foreground mt-1">Vul alles in en druk onderaan op versturen</p>
        </div>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Persoonlijke gegevens</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {fbField('bsn', 'BSN', bsnHelp,
              <Input className={`h-11 ${fallbackErrors.bsn ? 'border-destructive' : ''}`} inputMode="numeric" value={fallbackForm.bsn} onChange={e => setFallback('bsn', e.target.value)} placeholder="123456789" />, true)}
            {fbField('iban', 'IBAN', ibanHelp,
              <Input className={`h-11 ${fallbackErrors.iban ? 'border-destructive' : ''}`} value={fallbackForm.iban} onChange={e => setFallback('iban', e.target.value)} placeholder="NL00BANK0123456789" />, true)}
            {fbField('date_of_birth', 'Geboortedatum', dobHelp,
              <Input className={`h-11 ${fallbackErrors.date_of_birth ? 'border-destructive' : ''}`} type="date" value={fallbackForm.date_of_birth} onChange={e => setFallback('date_of_birth', e.target.value)} />, true)}
            {fbField('nationality', 'Nationaliteit', natHelp,
              <Input className="h-11" value={fallbackForm.nationality} onChange={e => setFallback('nationality', e.target.value)} placeholder="Nederlands" />)}
            {fbField('phone', 'Telefoonnummer', phoneHelp,
              <Input className="h-11" type="tel" inputMode="tel" value={fallbackForm.phone} onChange={e => setFallback('phone', e.target.value)} placeholder="+31 6 12345678" />)}
            {fbField('email', 'E-mail', emailHelp,
              <Input className={`h-11 ${fallbackErrors.email ? 'border-destructive' : ''}`} type="email" inputMode="email" value={fallbackForm.email} onChange={e => setFallback('email', e.target.value)} />)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Adresgegevens</CardTitle></CardHeader>
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
          <CardHeader className="pb-3"><CardTitle className="text-base">Documenten uploaden</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {(['id_bewijs', 'rijbewijs', 'certificaat'] as const).map((key) => {
              const label = key === 'id_bewijs' ? 'ID-bewijs (paspoort/identiteitskaart)' : key === 'rijbewijs' ? 'Rijbewijs (optioneel)' : 'Certificaat (optioneel)';
              const help = key === 'id_bewijs' ? idHelp : key === 'rijbewijs' ? rijbewijsHelp : certHelp;
              const file = docFiles[key];
              return (
                <div key={key} className="space-y-1">
                  {requiredLabel(label, false, help)}
                  {file ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-primary/40 bg-primary/5">
                      <FileCheck className="h-4 w-4 text-primary shrink-0" />
                      <span className="text-sm truncate flex-1">{file.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(file.size)}</span>
                      <button type="button" aria-label={`${label} verwijderen`} onClick={() => setDocFiles(prev => ({ ...prev, [key]: null }))} className="text-muted-foreground hover:text-destructive shrink-0">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 px-3 py-3 rounded-md border border-dashed cursor-pointer hover:bg-secondary/50 transition-colors">
                      <Upload className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm text-muted-foreground">Maak een foto of kies een bestand…</span>
                      <input type="file" accept="image/*,.pdf" className="hidden" onChange={e => setDocFiles(prev => ({ ...prev, [key]: e.target.files?.[0] ?? null }))} />
                    </label>
                  )}
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">Foto of PDF, max 10MB per bestand</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Reglement</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-start gap-3">
              <Checkbox id="reglement" checked={reglementAccepted} onCheckedChange={(v) => setReglementAccepted(v === true)} className="mt-0.5" />
              <label htmlFor="reglement" className="text-sm leading-5">Ik heb het bedrijfsreglement gelezen en ga hiermee akkoord.</label>
            </div>
          </CardContent>
        </Card>

        <Button onClick={handleSubmitFallback} disabled={submitting} className="w-full" size="lg">
          {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Versturen…</> : 'Gegevens versturen'}
        </Button>
      </>,
    );
  }

  // ── Dynamic form ──
  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;
  const progressPct = ((currentStep + 1) / steps.length) * 100;

  return renderShell(
    <>
      {steps.length > 1 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Stap {currentStep + 1} van {steps.length}</span>
            <span>{Math.round(progressPct)}%</span>
          </div>
          <Progress value={progressPct} className="h-2" />
        </div>
      )}

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">{step?.title}</CardTitle>
          {step?.description && <p className="text-sm text-muted-foreground">{step.description}</p>}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {renderStepFields(step)}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        {currentStep > 0 && (
          <Button variant="outline" onClick={handleBack} className="flex-1" size="lg">
            <ChevronLeft className="h-4 w-4 mr-1" /> Vorige
          </Button>
        )}
        {isLastStep ? (
          <Button onClick={handleSubmitDynamic} disabled={submitting} className="flex-1" size="lg">
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Versturen…</> : 'Gegevens versturen'}
          </Button>
        ) : (
          <Button onClick={handleNext} className="flex-1" size="lg">
            Volgende <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </>,
  );
};

/** Inline vraagteken-illustratie voor de introtekst (zelfde look als HelpDot). */
const HelpCircleInline = () => (
  <span className="inline-flex items-center justify-center align-middle mx-0.5 h-4 w-4 rounded-full border text-[10px] text-muted-foreground">?</span>
);

export default Onboarding;
