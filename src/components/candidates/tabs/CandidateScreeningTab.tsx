import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import TagInput from '@/components/ui/tag-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  Briefcase,
  CalendarClock,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  HeartHandshake,
  PhoneCall,
  Save,
  ShieldQuestion,
} from 'lucide-react';
import { toast } from 'sonner';
import { useModuleEnabled } from '@/hooks/useModuleEnabled';

type ScreeningStatus = 'niet_gestart' | 'in_gesprek' | 'concept_opgeslagen' | 'afgerond' | 'afgekeurd';

type ScreeningAnswer = {
  asked: boolean;
  notes: string;
};

interface ScreeningData {
  status: ScreeningStatus;
  current_step: string;
  answers: Record<string, ScreeningAnswer>;
  professional: {
    rating: string;
    questions_asked: string[];
    notes: string;
    skill_ratings: Record<string, number>;
  };
  personal: {
    risk_level: string;
    checklist: Record<string, { asked: boolean; notes: string }>;
    notes: string;
  };
  availability: {
    available_from: string;
    available_until: string;
    arrival_date: string;
  };
  result: string;
  summary: string;
  updated_at?: string | null;
  completed_at?: string | null;
  completed_by?: string | null;
}

type ProfileDraft = {
  phone: string;
  phone_nl: string;
  email: string;
  date_of_birth: string;
  nationality: string;
  address_street: string;
  address_postal: string;
  address_city: string;
  has_drivers_license: boolean;
  skills: string[];
  languages: string[];
  certifications: string[];
  availability_notes: string;
};

const PROFESSIONAL_RATINGS = [
  { value: 'niet_beoordeeld', label: 'Niet beoordeeld' },
  { value: 'onvoldoende', label: 'Onvoldoende' },
  { value: 'voldoende', label: 'Voldoende' },
  { value: 'goed', label: 'Goed' },
  { value: 'uitstekend', label: 'Uitstekend' },
];

const RISK_LEVELS = [
  { value: 'niet_beoordeeld', label: 'Niet beoordeeld' },
  { value: 'hoog_risico', label: 'Hoog risico' },
  { value: 'gemiddeld', label: 'Gemiddeld' },
  { value: 'laag_risico', label: 'Laag risico' },
];

const RESULT_OPTIONS = [
  { value: 'niet_gescreend', label: 'Niet gescreend' },
  { value: 'afgekeurd', label: 'Afgekeurd' },
  { value: 'goedgekeurd', label: 'Goedgekeurd' },
];

const SCREENING_STEPS = [
  { id: 'voorbereiding', label: 'Voorbereiding', icon: ShieldQuestion },
  { id: 'contact_identiteit', label: 'Contact & identiteit', icon: PhoneCall },
  { id: 'mobiliteit', label: 'Mobiliteit', icon: Car },
  { id: 'werkprofiel', label: 'Werkprofiel', icon: Briefcase },
  { id: 'voorwaarden', label: 'Beschikbaarheid', icon: CalendarClock },
  { id: 'persoonlijk', label: 'Persoonlijk', icon: HeartHandshake },
  { id: 'besluit', label: 'Besluit', icon: ClipboardCheck },
] as const;

const QUESTION_BANK: Record<string, Array<{ key: string; label: string; placeholder?: string }>> = {
  voorbereiding: [
    { key: 'prep_cv_check', label: 'CV en dossier doorgenomen', placeholder: 'Wat valt op, wat moet tijdens het gesprek bevestigd worden?' },
    { key: 'prep_missing_data', label: 'Ontbrekende kerngegevens benoemd', placeholder: 'Welke ontbrekende gegevens vraag je straks uit?' },
  ],
  contact_identiteit: [
    { key: 'phone_reachable', label: 'Telefoon/WhatsApp bereikbaar', placeholder: 'Nummer bevestigd, voorkeur kanaal, beste beltijd...' },
    { key: 'identity_work_right', label: 'Identiteit en werkdocumenten', placeholder: 'Nationaliteit, BSN-status, documenten aanwezig of nog aanvragen...' },
  ],
  mobiliteit: [
    { key: 'drivers_license_type', label: 'Rijbewijs type en geldigheid', placeholder: 'Geen / B / BE / C, geldig tot, bewijs beschikbaar...' },
    { key: 'own_car', label: 'Eigen auto en inzetbaarheid in Nederland', placeholder: 'Auto aanwezig, mag naar NL, vervoer naar werk...' },
    { key: 'housing_preference', label: 'Huisvesting nu en voorkeur', placeholder: 'Eigen accommodatie, JA Werkt accommodatie, single/shared...' },
  ],
  werkprofiel: [
    { key: 'experience_summary', label: 'Werkervaring en machines', placeholder: 'Concrete functies, jaren ervaring, machines, sectoren...' },
    { key: 'education_certificates', label: 'Opleiding en certificaten', placeholder: 'Diploma’s/certificaten, originele documenten beschikbaar...' },
    { key: 'countries_worked', label: 'Landen en werken in het buitenland', placeholder: 'Waar gewerkt, ervaring met uitzending/migratie...' },
  ],
  voorwaarden: [
    { key: 'availability_date', label: 'Beschikbaarheid bevestigd', placeholder: 'Bevestigd dat de datumvelden kloppen, inclusief opzegtermijn of onzekerheden...' },
    { key: 'salary_wish', label: 'Salarisindicatie en akkoord', placeholder: 'Gewenst loon, minimum, akkoord met aanbod...' },
    { key: 'overtime_shifts', label: 'Overwerk en ploegendiensten', placeholder: 'Bereidheid voor OT, 2/3/5 ploegen, weekend...' },
    { key: 'desired_stay', label: 'Gewenste verblijfsduur', placeholder: 'Seizoen, tijdelijk, lang verblijf...' },
  ],
  persoonlijk: [
    { key: 'family_context', label: 'Partner/kinderen/familiesituatie', placeholder: 'Context die planning/huisvesting raakt...' },
    { key: 'motivation_future', label: 'Motivatie en toekomstbeeld', placeholder: 'Waarom NL/JA Werkt, doelen, stabiliteit...' },
    { key: 'personal_risks', label: 'Aandachtspunten of risico’s', placeholder: 'Twijfels, onduidelijkheden, opvolging nodig...' },
  ],
  besluit: [
    { key: 'critical_unknowns', label: 'Kritieke onbekenden of bewuste overslagen', placeholder: 'Leg vast waarom ontbrekende gegevens toch akkoord zijn, of wat nog opgevolgd moet worden.' },
    { key: 'next_action', label: 'Volgende actie', placeholder: 'Matchen, taak aanmaken, documenten opvragen, afwijzen...' },
  ],
};

const CORE_PROFILE_FIELDS: Array<{ key: keyof ProfileDraft; label: string; isMissing: (candidate: any) => boolean; question: string }> = [
  { key: 'phone', label: 'Telefoonnummer', isMissing: (c) => !c.phone && !c.phone_nl, question: 'Wat is je actuele telefoonnummer en ben je daarop via WhatsApp bereikbaar?' },
  { key: 'email', label: 'E-mailadres', isMissing: (c) => !c.email, question: 'Welk e-mailadres mogen we gebruiken voor documenten en planning?' },
  { key: 'date_of_birth', label: 'Geboortedatum', isMissing: (c) => !c.date_of_birth, question: 'Wat is je geboortedatum voor de personeelsadministratie?' },
  { key: 'nationality', label: 'Nationaliteit', isMissing: (c) => !c.nationality, question: 'Wat is je nationaliteit en heb je aanvullende werkdocumenten nodig?' },
  { key: 'address_city', label: 'Adres/verblijfplaats', isMissing: (c) => !c.address_street || !c.address_postal || !c.address_city, question: 'Wat is je huidige woonadres en verblijfplaats?' },
  { key: 'languages', label: 'Talen', isMissing: (c) => !Array.isArray(c.languages) || c.languages.length === 0, question: 'Welke talen spreek je en op welk niveau?' },
  { key: 'skills', label: 'Vaardigheden', isMissing: (c) => !Array.isArray(c.skills) || c.skills.length === 0, question: 'Welke concrete vaardigheden of machines beheers je?' },
  { key: 'certifications', label: 'Certificaten', isMissing: (c) => !Array.isArray(c.certifications) || c.certifications.length === 0, question: 'Welke certificaten heb je en zijn die nog geldig?' },
];

const STATUS_META: Record<ScreeningStatus, { label: string; className: string }> = {
  niet_gestart: { label: 'Niet gestart', className: 'bg-muted text-muted-foreground border-0' },
  in_gesprek: { label: 'In gesprek', className: 'bg-blue-100 text-blue-700 border-0' },
  concept_opgeslagen: { label: 'Concept opgeslagen', className: 'bg-amber-100 text-amber-800 border-0' },
  afgerond: { label: 'Afgerond', className: 'bg-stat-green/10 text-stat-green border-0' },
  afgekeurd: { label: 'Afgekeurd', className: 'bg-red-100 text-red-600 border-0' },
};

const createDefaultAnswers = () => {
  const answers: Record<string, ScreeningAnswer> = {};
  Object.values(QUESTION_BANK).flat().forEach((q) => {
    answers[q.key] = { asked: false, notes: '' };
  });
  return answers;
};

const createDefaultPersonalChecklist = () => ({
  woonsituatie: { asked: false, notes: '' },
  familiesituatie: { asked: false, notes: '' },
  werkervaring_nl: { asked: false, notes: '' },
  reisbereidheid: { asked: false, notes: '' },
  beschikbaarheid: { asked: false, notes: '' },
  taalvaardigheid: { asked: false, notes: '' },
  motivatie: { asked: false, notes: '' },
});

const stripGeneratedAvailabilityNotes = (notes?: string | null) =>
  String(notes ?? '')
    .split('\n')
    .filter((line) => !/^\s*(Beschikbaar vanaf|Beschikbaar tot|Aankomst\/check-in):/i.test(line))
    .join('\n')
    .trim();

const buildAvailabilityNotes = (
  availability: ScreeningData['availability'],
  notes?: string | null,
) => [
  availability.available_from ? `Beschikbaar vanaf: ${availability.available_from}` : null,
  availability.available_until ? `Beschikbaar tot: ${availability.available_until}` : null,
  availability.arrival_date ? `Aankomst/check-in: ${availability.arrival_date}` : null,
  stripGeneratedAvailabilityNotes(notes),
].filter(Boolean).join('\n').trim();

const getProfileDraft = (candidate: any): ProfileDraft => ({
  phone: candidate.phone ?? '',
  phone_nl: candidate.phone_nl ?? '',
  email: candidate.email ?? '',
  date_of_birth: candidate.date_of_birth ?? '',
  nationality: candidate.nationality ?? '',
  address_street: candidate.address_street ?? '',
  address_postal: candidate.address_postal ?? '',
  address_city: candidate.address_city ?? '',
  has_drivers_license: candidate.has_drivers_license ?? false,
  skills: candidate.skills ?? [],
  languages: candidate.languages ?? [],
  certifications: candidate.certifications ?? [],
  availability_notes: stripGeneratedAvailabilityNotes(candidate.availability_notes),
});

const getInitialData = (candidate: any): ScreeningData => {
  const existing = candidate.screening_data as Partial<ScreeningData> | null;
  const existingAvailability = (existing?.availability ?? {}) as Partial<ScreeningData['availability']>;
  const answers = { ...createDefaultAnswers(), ...(existing?.answers ?? {}) };
  const legacyProfessional = existing?.professional ?? {
    rating: 'niet_beoordeeld',
    questions_asked: [],
    notes: '',
    skill_ratings: {},
  };
  const legacyPersonal = existing?.personal ?? {
    risk_level: 'niet_beoordeeld',
    checklist: createDefaultPersonalChecklist(),
    notes: '',
  };

  return {
    status: existing?.status ?? (candidate.screened_at ? 'afgerond' : 'niet_gestart'),
    current_step: existing?.current_step ?? 'voorbereiding',
    answers,
    professional: {
      rating: legacyProfessional.rating ?? 'niet_beoordeeld',
      questions_asked: legacyProfessional.questions_asked ?? [],
      notes: legacyProfessional.notes ?? '',
      skill_ratings: legacyProfessional.skill_ratings ?? {},
    },
    personal: {
      risk_level: legacyPersonal.risk_level ?? 'niet_beoordeeld',
      checklist: { ...createDefaultPersonalChecklist(), ...(legacyPersonal.checklist ?? {}) },
      notes: legacyPersonal.notes ?? '',
    },
    availability: {
      available_from: candidate.available_from ?? existingAvailability.available_from ?? '',
      available_until: candidate.available_until ?? existingAvailability.available_until ?? '',
      arrival_date: candidate.arrival_date ?? existingAvailability.arrival_date ?? '',
    },
    result: existing?.result ?? 'niet_gescreend',
    summary: existing?.summary ?? '',
    updated_at: existing?.updated_at ?? null,
    completed_at: existing?.completed_at ?? candidate.screened_at ?? null,
    completed_by: existing?.completed_by ?? candidate.screened_by ?? null,
  };
};

const getMissingProfileFields = (candidate: any) =>
  CORE_PROFILE_FIELDS.filter((field) => field.isMissing(candidate));

const importantMissingFields = (draft: ProfileDraft, availability?: ScreeningData['availability']) => {
  const missing: string[] = [];
  if (!draft.phone && !draft.phone_nl) missing.push('telefoonnummer');
  if (!draft.email) missing.push('e-mailadres');
  if (!draft.date_of_birth) missing.push('geboortedatum');
  if (!draft.nationality) missing.push('nationaliteit');
  if (draft.skills.length === 0) missing.push('vaardigheden');
  if (!availability?.available_from) missing.push('beschikbaar vanaf');
  return missing;
};

const askedCount = (data: ScreeningData) =>
  Object.values(data.answers).filter((answer) => answer.asked || answer.notes.trim()).length;

const buildSnapshot = (data: ScreeningData, profile: ProfileDraft) => JSON.stringify({ data, profile });

const CandidateScreeningTab = ({
  candidate,
  onUpdate,
  onDirtyChange,
}: {
  candidate: any;
  onUpdate: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) => {
  const { user } = useAuth();
  const [data, setData] = useState<ScreeningData>(() => getInitialData(candidate));
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(() => getProfileDraft(candidate));
  const [saving, setSaving] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>((candidate.screening_data as any)?.updated_at ?? candidate.screened_at ?? null);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState(() => buildSnapshot(getInitialData(candidate), getProfileDraft(candidate)));
  const saveSeq = useRef(0);
  const aiEnabled = useModuleEnabled('ai-analyse');

  const currentStepIndex = Math.max(0, SCREENING_STEPS.findIndex((step) => step.id === data.current_step));
  const currentStep = SCREENING_STEPS[currentStepIndex] ?? SCREENING_STEPS[0];
  const questions = QUESTION_BANK[currentStep.id] ?? [];
  const CurrentStepIcon = currentStep.icon;
  const missingProfileFields = getMissingProfileFields(candidate);
  const interviewQuestions: string[] = candidate.ai_interview_questions ?? [];
  const riskFactors: string[] = candidate.ai_risk_factors ?? [];
  const positiveSignals: string[] = candidate.ai_positive_signals ?? [];
  const targetFunctions: string[] = candidate.ai_target_functions ?? [];
  const dirty = buildSnapshot(data, profileDraft) !== lastSavedSnapshot;
  const statusMeta = STATUS_META[data.status] ?? STATUS_META.niet_gestart;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const profilePayload = useCallback((draft: ProfileDraft, availability: ScreeningData['availability']) => ({
    phone: draft.phone.trim() || null,
    phone_nl: draft.phone_nl.trim() || null,
    email: draft.email.trim() || null,
    date_of_birth: draft.date_of_birth || null,
    nationality: draft.nationality.trim() || null,
    address_street: draft.address_street.trim() || null,
    address_postal: draft.address_postal.trim() || null,
    address_city: draft.address_city.trim() || null,
    has_drivers_license: draft.has_drivers_license,
    skills: draft.skills,
    languages: draft.languages,
    certifications: draft.certifications,
    available_from: availability.available_from || null,
    available_until: availability.available_until || null,
    arrival_date: availability.arrival_date || null,
    availability_notes: buildAvailabilityNotes(availability, draft.availability_notes) || null,
  }), []);

  const persistDraft = useCallback(async ({
    nextData,
    nextProfile,
    complete = false,
    manual = false,
  }: {
    nextData?: ScreeningData;
    nextProfile?: ProfileDraft;
    complete?: boolean;
    manual?: boolean;
  } = {}) => {
    const dataToSave = nextData ?? data;
    const profileToSave = nextProfile ?? profileDraft;
    const seq = ++saveSeq.current;
    const timestamp = new Date().toISOString();
    const screeningStatus: ScreeningStatus = complete
      ? (dataToSave.result === 'afgekeurd' ? 'afgekeurd' : 'afgerond')
      : dataToSave.status === 'niet_gestart'
        ? 'niet_gestart'
        : dataToSave.status === 'afgerond' || dataToSave.status === 'afgekeurd'
          ? dataToSave.status
          : 'concept_opgeslagen';
    const screeningData: ScreeningData = {
      ...dataToSave,
      status: screeningStatus,
      updated_at: timestamp,
      completed_at: complete ? timestamp : dataToSave.completed_at ?? null,
      completed_by: complete ? user?.id ?? null : dataToSave.completed_by ?? null,
    };
    const updates: any = {
      ...profilePayload(profileToSave, screeningData.availability),
      screening_data: screeningData as any,
    };

    if (dataToSave.status !== 'niet_gestart' && !candidate.screened_at && candidate.status !== 'werkzoekend' && candidate.status !== 'geplaatst') {
      updates.status = complete
        ? (dataToSave.result === 'goedgekeurd' ? 'werkzoekend' : 'afgewezen')
        : 'in_screening';
    } else if (complete && dataToSave.result === 'goedgekeurd' && !candidate.screened_at) {
      updates.status = 'werkzoekend';
    } else if (complete && dataToSave.result === 'afgekeurd' && !candidate.screened_at) {
      updates.status = 'afgewezen';
    }

    if (complete) {
      updates.screened_at = timestamp;
      updates.screened_by = user?.id ?? null;
    }

    if (manual) setManualSaving(true);
    setSaving(true);
    try {
      const { error } = await supabase
        .from('candidates')
        .update(updates)
        .eq('id', candidate.id);
      if (error) throw error;

      if (seq === saveSeq.current) {
        setData(screeningData);
        setLastSavedAt(timestamp);
        setLastSavedSnapshot(buildSnapshot(screeningData, profileToSave));
      }
      if (manual) toast.success(complete ? 'Screening afgerond' : 'Concept opgeslagen');
      onUpdate();
    } catch (e: any) {
      if (manual) toast.error(e.message || 'Fout bij opslaan');
    } finally {
      setSaving(false);
      if (manual) setManualSaving(false);
    }
  }, [candidate.id, candidate.screened_at, candidate.status, data, onUpdate, profileDraft, profilePayload, user?.id]);

  useEffect(() => {
    if (!dirty || data.status === 'niet_gestart') return;
    const timeout = window.setTimeout(() => {
      persistDraft().catch(() => {});
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [data, dirty, persistDraft, profileDraft]);

  const setAnswer = (key: string, patch: Partial<ScreeningAnswer>) => {
    setData((current) => ({
      ...current,
      answers: {
        ...current.answers,
        [key]: { ...(current.answers[key] ?? { asked: false, notes: '' }), ...patch },
      },
    }));
  };

  const setProfessional = (patch: Partial<ScreeningData['professional']>) =>
    setData((current) => ({ ...current, professional: { ...current.professional, ...patch } }));

  const setPersonal = (patch: Partial<ScreeningData['personal']>) =>
    setData((current) => ({ ...current, personal: { ...current.personal, ...patch } }));

  const startCall = () => {
    setData((current) => ({
      ...current,
      status: 'in_gesprek',
      current_step: current.current_step || 'voorbereiding',
    }));
  };

  const goToStep = (stepId: string) => {
    if (data.status === 'niet_gestart') startCall();
    setData((current) => ({ ...current, current_step: stepId, status: current.status === 'niet_gestart' ? 'in_gesprek' : current.status }));
  };

  const openItems = useMemo(() => {
    const items: string[] = [];
    missingProfileFields.forEach((field) => items.push(`Profiel: ${field.label}`));
    if (!data.availability.available_from) items.push('Beschikbaarheid: beschikbaar vanaf');
    SCREENING_STEPS.forEach((step) => {
      (QUESTION_BANK[step.id] ?? []).forEach((question) => {
        const answer = data.answers[question.key];
        if (!answer?.asked && !answer?.notes?.trim()) items.push(`${step.label}: ${question.label}`);
      });
    });
    return items;
  }, [data.answers, data.availability.available_from, missingProfileFields]);

  const handleCreateFollowupTask = async () => {
    setCreatingTask(true);
    try {
      const { error } = await supabase.from('recruiter_tasks' as any).insert({
        organization_id: candidate.organization_id,
        assigned_to: user?.id ?? null,
        title: `Screening opvolgen: ${candidate.first_name} ${candidate.last_name}`,
        description: openItems.length > 0
          ? `Openstaande screeningpunten:\n${openItems.map((item) => `- ${item}`).join('\n')}`
          : 'Geen openstaande screeningpunten gevonden; controleer de samenvatting.',
        priority: openItems.length >= 6 ? 'high' : 'medium',
        category: 'opvolging',
        status: 'open',
        related_entity_type: 'kandidaat',
        related_entity_id: candidate.id,
        ai_generated: false,
      });
      if (error) throw error;
      toast.success('Opvolgtaak aangemaakt');
    } catch (e: any) {
      toast.error(e.message || 'Kon opvolgtaak niet maken');
    } finally {
      setCreatingTask(false);
    }
  };

  const handleComplete = async () => {
    const missing = importantMissingFields(profileDraft, data.availability);
    if (data.result === 'niet_gescreend') {
      toast.error('Kies eerst goedgekeurd of afgekeurd');
      return;
    }
    if (data.summary.trim().length < 10) {
      toast.error('Vul een korte samenvatting in');
      return;
    }
    if (missing.length > 0 && !data.answers.critical_unknowns?.notes?.trim()) {
      toast.error(`Leg bij Besluit vast waarom ontbrekend akkoord is: ${missing.join(', ')}`);
      setData((current) => ({ ...current, current_step: 'besluit' }));
      return;
    }
    await persistDraft({ complete: true, manual: true });
  };

  const renderProfileFields = () => {
    if (currentStep.id === 'contact_identiteit') {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Telefoon EU/buitenland</Label><Input value={profileDraft.phone} onChange={(e) => setProfileDraft((p) => ({ ...p, phone: e.target.value }))} /></div>
          <div><Label>Telefoon NL</Label><Input value={profileDraft.phone_nl} onChange={(e) => setProfileDraft((p) => ({ ...p, phone_nl: e.target.value }))} /></div>
          <div><Label>E-mail</Label><Input value={profileDraft.email} onChange={(e) => setProfileDraft((p) => ({ ...p, email: e.target.value }))} /></div>
          <div><Label>Geboortedatum</Label><Input type="date" value={profileDraft.date_of_birth} onChange={(e) => setProfileDraft((p) => ({ ...p, date_of_birth: e.target.value }))} /></div>
          <div><Label>Nationaliteit</Label><Input value={profileDraft.nationality} onChange={(e) => setProfileDraft((p) => ({ ...p, nationality: e.target.value }))} /></div>
          <div><Label>Woonplaats</Label><Input value={profileDraft.address_city} onChange={(e) => setProfileDraft((p) => ({ ...p, address_city: e.target.value }))} /></div>
          <div><Label>Straat</Label><Input value={profileDraft.address_street} onChange={(e) => setProfileDraft((p) => ({ ...p, address_street: e.target.value }))} /></div>
          <div><Label>Postcode</Label><Input value={profileDraft.address_postal} onChange={(e) => setProfileDraft((p) => ({ ...p, address_postal: e.target.value }))} /></div>
        </div>
      );
    }

    if (currentStep.id === 'mobiliteit') {
      return (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={profileDraft.has_drivers_license} onCheckedChange={(checked) => setProfileDraft((p) => ({ ...p, has_drivers_license: checked === true }))} />
            Rijbewijs geregistreerd
          </label>
        </div>
      );
    }

    if (currentStep.id === 'werkprofiel') {
      return (
        <div className="grid gap-3">
          <div><Label>Vaardigheden</Label><TagInput value={profileDraft.skills} onChange={(skills) => setProfileDraft((p) => ({ ...p, skills }))} placeholder="Typ vaardigheid + Enter" /></div>
          <div><Label>Certificaten</Label><TagInput value={profileDraft.certifications} onChange={(certifications) => setProfileDraft((p) => ({ ...p, certifications }))} placeholder="Typ certificaat + Enter" /></div>
          <div><Label>Talen</Label><TagInput value={profileDraft.languages} onChange={(languages) => setProfileDraft((p) => ({ ...p, languages }))} placeholder="Typ taal/niveau + Enter" /></div>
        </div>
      );
    }

    if (currentStep.id === 'voorwaarden') {
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Beschikbaar vanaf</Label>
              <Input
                type="date"
                value={data.availability.available_from}
                onChange={(e) => setData((current) => ({
                  ...current,
                  availability: { ...current.availability, available_from: e.target.value },
                }))}
              />
            </div>
            <div>
              <Label>Beschikbaar tot</Label>
              <Input
                type="date"
                value={data.availability.available_until}
                onChange={(e) => setData((current) => ({
                  ...current,
                  availability: { ...current.availability, available_until: e.target.value },
                }))}
              />
            </div>
            <div>
              <Label>Aankomst/check-in</Label>
              <Input
                type="date"
                value={data.availability.arrival_date}
                onChange={(e) => setData((current) => ({
                  ...current,
                  availability: { ...current.availability, arrival_date: e.target.value },
                }))}
              />
            </div>
          </div>
          <div>
            <Label>Beschikbaarheidsnotities</Label>
            <Textarea
              value={profileDraft.availability_notes}
              onChange={(e) => setProfileDraft((p) => ({ ...p, availability_notes: e.target.value }))}
              placeholder="Opzegtermijn, onzekerheden, ploegendiensten, gewenste uren..."
              rows={3}
            />
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
              <Badge variant="outline">{askedCount(data)}/{Object.values(QUESTION_BANK).flat().length} punten vastgelegd</Badge>
              {saving && <Badge variant="outline" className="gap-1"><Clock3 className="h-3 w-3 animate-pulse" /> Autosave</Badge>}
              {dirty && !saving && <Badge variant="outline" className="text-amber-700 border-amber-200">Onopgeslagen wijzigingen</Badge>}
            </div>
            <div>
              <h3 className="font-semibold">Screening-callflow</h3>
              <p className="text-sm text-muted-foreground">
                {candidate.first_name} {candidate.last_name} · recruiter-belscript en matchdata in één verloop.
              </p>
            </div>
            {lastSavedAt && (
              <p className="text-xs text-muted-foreground">
                Laatst opgeslagen: {new Date(lastSavedAt).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {data.status === 'niet_gestart' && (
              <Button onClick={startCall} className="gap-2" data-testid="screening-start-call">
                <PhoneCall className="h-4 w-4" /> Start gesprek
              </Button>
            )}
            <Button variant="outline" onClick={() => persistDraft({ manual: true })} disabled={manualSaving || data.status === 'niet_gestart'} className="gap-2" data-testid="screening-save-draft">
              <Save className="h-4 w-4" /> {manualSaving ? 'Opslaan...' : 'Tussentijds opslaan'}
            </Button>
            <Button variant="outline" onClick={handleCreateFollowupTask} disabled={creatingTask} className="gap-2">
              <AlertTriangle className="h-4 w-4" /> {creatingTask ? 'Aanmaken...' : 'Maak taak'}
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="p-3 h-fit">
          <div className="space-y-1">
            {SCREENING_STEPS.map((step, index) => {
              const Icon = step.icon;
              const active = step.id === currentStep.id;
              const stepQuestions = QUESTION_BANK[step.id] ?? [];
              const done = stepQuestions.length > 0 && stepQuestions.every((q) => data.answers[q.key]?.asked || data.answers[q.key]?.notes?.trim());
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => goToStep(step.id)}
                  className={cn(
                    'w-full rounded-md px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors',
                    active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                  )}
                >
                  <span className={cn('h-6 w-6 rounded-full flex items-center justify-center text-xs', active ? 'bg-primary-foreground/20' : 'bg-muted')}>
                    {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                  </span>
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{step.label}</span>
                </button>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4 min-w-0">
          {aiEnabled && (
            <Card className="p-4 space-y-3 border-l-4 border-l-blue-500">
              <div className="flex items-center gap-2">
                <ShieldQuestion className="h-4 w-4 text-blue-600" />
                <h3 className="font-semibold text-sm">AI-context voor gesprek</h3>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Feiten/signalen</Label>
                  <div className="flex gap-1.5 flex-wrap">
                    {candidate.ai_classification && <Badge variant="secondary">{candidate.ai_classification}</Badge>}
                    {candidate.ai_function_group && <Badge variant="outline">{candidate.ai_function_group}</Badge>}
                    {positiveSignals.slice(0, 4).map((signal) => <Badge key={signal} variant="outline">{signal}</Badge>)}
                    {!candidate.ai_classification && !candidate.ai_function_group && positiveSignals.length === 0 && <span className="text-sm text-muted-foreground">Geen AI-signalen</span>}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Onbekend/aandacht</Label>
                  <div className="flex gap-1.5 flex-wrap">
                    {missingProfileFields.slice(0, 5).map((field) => <Badge key={field.label} className="bg-amber-100 text-amber-800 border-0">{field.label}</Badge>)}
                    {riskFactors.slice(0, 3).map((risk) => <Badge key={risk} className="bg-red-100 text-red-700 border-0">{risk}</Badge>)}
                    {missingProfileFields.length === 0 && riskFactors.length === 0 && <span className="text-sm text-muted-foreground">Geen open AI-punten</span>}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Passende functies</Label>
                  <div className="flex gap-1.5 flex-wrap">
                    {targetFunctions.slice(0, 5).map((target) => <Badge key={target} variant="outline">{target}</Badge>)}
                    {targetFunctions.length === 0 && <span className="text-sm text-muted-foreground">Nog niet bepaald</span>}
                  </div>
                </div>
              </div>
              {interviewQuestions.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">AI-belvragen</Label>
                  <div className="grid gap-2 md:grid-cols-2">
                    {interviewQuestions.slice(0, 4).map((question, i) => (
                      <div key={`${question}-${i}`} className="rounded-md border bg-background px-3 py-2 text-sm">
                        {question}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          {missingProfileFields.length > 0 && (
            <Card className="p-4 border-l-4 border-l-amber-500 bg-amber-50/40">
              <div className="flex gap-2 flex-wrap">
                {missingProfileFields.map((field) => (
                  <Badge key={field.label} className="bg-amber-100 text-amber-800 border-0">
                    {field.label}
                  </Badge>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-5 space-y-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <CurrentStepIcon className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold">{currentStep.label}</h3>
              </div>
              <Badge variant="outline">{currentStepIndex + 1}/{SCREENING_STEPS.length}</Badge>
            </div>

            {renderProfileFields()}

            {questions.length > 0 && (
              <div className="space-y-3">
                {questions.map((question) => {
                  const answer = data.answers[question.key] ?? { asked: false, notes: '' };
                  return (
                    <div key={question.key} className="rounded-md border bg-background p-3 space-y-2">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <Checkbox checked={answer.asked} onCheckedChange={(checked) => setAnswer(question.key, { asked: checked === true })} className="mt-0.5" />
                        <span className="font-medium text-sm">{question.label}</span>
                      </label>
                      <Textarea
                        value={answer.notes}
                        onChange={(e) => setAnswer(question.key, { notes: e.target.value })}
                        placeholder={question.placeholder ?? 'Antwoord of checkpunt...'}
                        className="min-h-[72px]"
                        data-testid={`screening-answer-${question.key}`}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {currentStep.id === 'werkprofiel' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Professionele beoordeling</Label>
                  <Select value={data.professional.rating} onValueChange={(value) => setProfessional({ rating: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PROFESSIONAL_RATINGS.map((rating) => <SelectItem key={rating.value} value={rating.value}>{rating.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Notities vakinhoudelijk</Label>
                  <Textarea value={data.professional.notes} onChange={(e) => setProfessional({ notes: e.target.value })} rows={3} />
                </div>
              </div>
            )}

            {currentStep.id === 'persoonlijk' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Risiconiveau</Label>
                  <Select value={data.personal.risk_level} onValueChange={(value) => setPersonal({ risk_level: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{RISK_LEVELS.map((risk) => <SelectItem key={risk.value} value={risk.value}>{risk.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Notities persoonlijk</Label>
                  <Textarea value={data.personal.notes} onChange={(e) => setPersonal({ notes: e.target.value })} rows={3} />
                </div>
              </div>
            )}

            {currentStep.id === 'besluit' && (
              <div className="space-y-4 border-t pt-4">
                <div className="space-y-1.5">
                  <Label>Eindresultaat</Label>
                  <Select value={data.result} onValueChange={(value) => setData((current) => ({ ...current, result: value }))}>
                    <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
                    <SelectContent>{RESULT_OPTIONS.map((result) => <SelectItem key={result.value} value={result.value}>{result.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Samenvatting</Label>
                  <Textarea
                    value={data.summary}
                    onChange={(e) => setData((current) => ({ ...current, summary: e.target.value }))}
                    placeholder="Korte recruiter-samenvatting en besluit..."
                    className="min-h-[110px]"
                    data-testid="screening-summary"
                  />
                </div>
                {importantMissingFields(profileDraft, data.availability).length > 0 && (
                  <p className="text-xs text-amber-700">
                    Kritieke velden ontbreken nog: {importantMissingFields(profileDraft, data.availability).join(', ')}. Leg bij “Kritieke onbekenden” vast waarom dit akkoord is.
                  </p>
                )}
                <Button onClick={handleComplete} disabled={manualSaving} className="gap-2" data-testid="screening-complete">
                  <ClipboardCheck className="h-4 w-4" /> {manualSaving ? 'Afronden...' : 'Screening afronden'}
                </Button>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 border-t pt-4">
              <Button
                variant="outline"
                onClick={() => goToStep(SCREENING_STEPS[Math.max(0, currentStepIndex - 1)].id)}
                disabled={currentStepIndex === 0}
                className="gap-2"
              >
                <ChevronLeft className="h-4 w-4" /> Vorige
              </Button>
              <Button
                variant="outline"
                onClick={() => goToStep(SCREENING_STEPS[Math.min(SCREENING_STEPS.length - 1, currentStepIndex + 1)].id)}
                disabled={currentStepIndex === SCREENING_STEPS.length - 1}
                className="gap-2"
              >
                Volgende <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default CandidateScreeningTab;
