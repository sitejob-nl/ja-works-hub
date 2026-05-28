import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, Briefcase, CheckCircle2, FileUp, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import TagInput from '@/components/ui/tag-input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type LinkState = 'loading' | 'invalid' | 'expired' | 'full' | 'form' | 'success';

type SignupConfig = {
  link: {
    title: string;
    description: string | null;
    source_tag: string | null;
    show_cv_upload: boolean;
    show_languages: boolean;
    show_nationality: boolean;
    show_drivers_license: boolean;
    show_availability: boolean;
  };
  organization: {
    name: string;
    logo_url: string | null;
    email: string | null;
    phone: string | null;
  };
  vacancy?: {
    id: string;
    title: string;
    company_name: string | null;
    status: string | null;
  } | null;
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const reasonToState = (reason?: string): LinkState => {
  if (reason === 'expired') return 'expired';
  if (reason === 'full') return 'full';
  return 'invalid';
};

const statusCopy: Record<'invalid' | 'expired' | 'full', { title: string; body: string }> = {
  invalid: {
    title: 'Ongeldige aanmeldlink',
    body: 'Deze link bestaat niet of is niet meer actief. Vraag je recruiter om een nieuwe link.',
  },
  expired: {
    title: 'Aanmeldlink verlopen',
    body: 'Deze aanmeldlink is verlopen. Neem contact op met je recruiter om opnieuw uitgenodigd te worden.',
  },
  full: {
    title: 'Aanmeldlink gesloten',
    body: 'Deze aanmeldlink heeft het maximale aantal aanmeldingen bereikt.',
  },
};

const PublicCandidateSignup = () => {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<LinkState>('loading');
  const [config, setConfig] = useState<SignupConfig | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    nationality: '',
    languages: [] as string[],
    skills: [] as string[],
    certifications: [] as string[],
    has_drivers_license: false,
    availability_notes: '',
  });

  const organizationName = config?.organization.name || 'JA Werkt';
  const sourceLabel = useMemo(() => config?.link.source_tag?.replace(/[_-]/g, ' ') ?? null, [config]);
  const vacancyLabel = config?.vacancy
    ? `${config.vacancy.title}${config.vacancy.company_name ? ` bij ${config.vacancy.company_name}` : ''}`
    : null;

  useEffect(() => {
    if (!slug) {
      setState('invalid');
      return;
    }

    const load = async () => {
      try {
        const response = await fetch(
          `${SUPABASE_URL}/functions/v1/candidate-signup?slug=${encodeURIComponent(slug)}`,
          { headers: { apikey: SUPABASE_KEY } },
        );
        const data = await response.json();

        if (!response.ok || !data.valid) {
          setState(reasonToState(data.reason));
          return;
        }

        setConfig(data as SignupConfig);
        setState('form');
      } catch {
        setState('invalid');
      }
    };

    load();
  }, [slug]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const readCvText = async () => {
    if (!cvFile) return '';
    if (cvFile.size > 2_000_000) return '';
    try {
      const text = await cvFile.text();
      return text.replace(/\s+/g, ' ').trim().slice(0, 200000);
    } catch {
      return '';
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!slug || !config) return;

    if (!form.first_name.trim() || !form.last_name.trim() || !form.email.trim()) {
      toast.error('Vul je naam en e-mailadres in');
      return;
    }

    if (!cvFile) {
      toast.error('Upload je CV om je aanmelding te versturen');
      return;
    }

    setSubmitting(true);
    try {
      const body = new FormData();
      body.append('slug', slug);
      body.append('first_name', form.first_name.trim());
      body.append('last_name', form.last_name.trim());
      body.append('email', form.email.trim());
      body.append('phone', form.phone.trim());
      body.append('nationality', form.nationality.trim());
      body.append('languages', JSON.stringify(form.languages));
      body.append('skills', JSON.stringify(form.skills));
      body.append('certifications', JSON.stringify(form.certifications));
      body.append('has_drivers_license', String(form.has_drivers_license));
      body.append('availability_notes', form.availability_notes.trim());
      body.append('cv', cvFile);

      const cvText = await readCvText();
      if (cvText.length >= 50) body.append('cv_text', cvText);

      const response = await fetch(`${SUPABASE_URL}/functions/v1/candidate-signup`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY },
        body,
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Aanmelding kon niet worden verstuurd');
      }

      setState('success');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Aanmelding kon niet worden verstuurd');
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'loading') {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (state === 'success') {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center px-4">
        <section className="w-full max-w-md rounded-lg border bg-card p-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-stat-green" />
          <h1 className="text-xl font-semibold text-heading">Aanmelding ontvangen</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Bedankt. Je CV staat klaar voor review door {organizationName}. {vacancyLabel ? `Je sollicitatie op ${vacancyLabel} is ontvangen.` : 'Een recruiter neemt contact met je op.'}
          </p>
        </section>
      </main>
    );
  }

  if (state === 'invalid' || state === 'expired' || state === 'full') {
    const copy = statusCopy[state];
    return (
      <main className="min-h-screen bg-background flex items-center justify-center px-4">
        <section className="w-full max-w-md rounded-lg border bg-card p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto mb-4 h-11 w-11 text-destructive" />
          <h1 className="text-xl font-semibold text-heading">{copy.title}</h1>
          <p className="mt-3 text-sm text-muted-foreground">{copy.body}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
        <header className="flex items-center gap-4">
          {config?.organization.logo_url ? (
            <img
              src={config.organization.logo_url}
              alt={organizationName}
              className="h-12 w-12 rounded-md border object-contain"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
              {organizationName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-sm text-muted-foreground">{organizationName}</p>
            <h1 className="text-2xl font-semibold text-heading">{config?.link.title ?? 'Aanmelden'}</h1>
          </div>
        </header>

        {config?.link.description ? (
          <p className="text-sm leading-6 text-muted-foreground">{config.link.description}</p>
        ) : null}

        {vacancyLabel ? (
          <div className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-sm">
            <Briefcase className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
            <div>
              <div className="font-medium text-foreground">Sollicitatie op vacature</div>
              <div className="text-muted-foreground">{vacancyLabel}</div>
            </div>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="rounded-lg border bg-card p-5 shadow-sm sm:p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="first_name">Voornaam *</Label>
              <Input
                id="first_name"
                value={form.first_name}
                onChange={(event) => set('first_name', event.target.value)}
                autoComplete="given-name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Achternaam *</Label>
              <Input
                id="last_name"
                value={form.last_name}
                onChange={(event) => set('last_name', event.target.value)}
                autoComplete="family-name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mailadres *</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(event) => set('email', event.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Telefoonnummer</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(event) => set('phone', event.target.value)}
                autoComplete="tel"
              />
            </div>

            {config?.link.show_nationality ? (
              <div className="space-y-2">
                <Label htmlFor="nationality">Nationaliteit</Label>
                <Input
                  id="nationality"
                  value={form.nationality}
                  onChange={(event) => set('nationality', event.target.value)}
                />
              </div>
            ) : null}

            {config?.link.show_drivers_license ? (
              <div className="flex items-center gap-3 pt-7">
                <Checkbox
                  id="has_drivers_license"
                  checked={form.has_drivers_license}
                  onCheckedChange={(checked) => set('has_drivers_license', checked === true)}
                />
                <Label htmlFor="has_drivers_license" className="text-sm font-normal">
                  Ik heb een rijbewijs
                </Label>
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid gap-5">
            {config?.link.show_languages ? (
              <div className="space-y-2">
                <Label>Talen</Label>
                <TagInput
                  value={form.languages}
                  onChange={(tags) => set('languages', tags)}
                  placeholder="Bijv. Nederlands, Engels, Pools"
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Skills</Label>
              <TagInput
                value={form.skills}
                onChange={(tags) => set('skills', tags)}
                placeholder="Bijv. heftruck, orderpicken, lassen"
              />
            </div>

            <div className="space-y-2">
              <Label>Certificaten</Label>
              <TagInput
                value={form.certifications}
                onChange={(tags) => set('certifications', tags)}
                placeholder="Bijv. VCA, heftruckcertificaat"
              />
            </div>

            {config?.link.show_availability ? (
              <div className="space-y-2">
                <Label htmlFor="availability_notes">Beschikbaarheid</Label>
                <Textarea
                  id="availability_notes"
                  value={form.availability_notes}
                  onChange={(event) => set('availability_notes', event.target.value)}
                  rows={4}
                  placeholder="Wanneer kun je starten en hoeveel uur wil je werken?"
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="cv">CV uploaden *</Label>
              <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed bg-background px-4 py-6 text-center transition-colors hover:border-primary">
                <FileUp className="mb-2 h-7 w-7 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {cvFile ? cvFile.name : 'Kies je CV-bestand'}
                </span>
                <span className="mt-1 text-xs text-muted-foreground">PDF, DOC, DOCX, TXT, JPG, PNG of ODT, maximaal 15 MB</span>
                <Input
                  id="cv"
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.odt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,image/jpeg,image/png,application/vnd.oasis.opendocument.text"
                  className="sr-only"
                  onChange={(event) => setCvFile(event.target.files?.[0] ?? null)}
                  required
                />
              </label>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {sourceLabel ? `Bron: ${sourceLabel}. ` : ''}Je gegevens worden alleen gebruikt voor recruitmentopvolging.
            </p>
            <Button type="submit" disabled={submitting} className="sm:min-w-44">
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Versturen...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  {vacancyLabel ? 'Solliciteren' : 'Aanmelden'}
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
};

export default PublicCandidateSignup;
