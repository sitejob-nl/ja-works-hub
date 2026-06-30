import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDecryptedCandidate } from '@/hooks/useDecryptedCandidate';
import { logAudit } from '@/lib/audit';
import { deriveCallQuestions } from '@/lib/callQuestions';
import { extractFunctionErrorMessage } from '@/lib/functionError';
import { InlineSensitiveField } from '@/components/shared/InlineFields';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import TagInput from '@/components/ui/tag-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import NationalitySelect from '@/components/shared/NationalitySelect';
import SkillMultiSelect from '@/components/shared/SkillMultiSelect';
import LanguageMultiSelect from '@/components/shared/LanguageMultiSelect';
import WorkHistoryTimeline from '@/components/candidates/WorkHistoryTimeline';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  ArrowDownToLine,
  Briefcase,
  CalendarClock,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  HeartHandshake,
  Info,
  MapPin,
  PhoneCall,
  Save,
  ShieldQuestion,
  Sparkles,
  Target,
  TrendingUp,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { useModuleEnabled } from '@/hooks/useModuleEnabled';
import { mergeCandidatePhoneFields } from '@/lib/phone';

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
  drivers_license_expiry: string;
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

// Bouwt de standaardantwoorden en vult — waar de kandidaatdata al bekend is —
// het checkpunt vooraf in (aangevinkt + startnotitie "...bevestigen"), zodat de
// recruiter tijdens het gesprek bevestigt i.p.v. overtypt. AI-belvragen komen als
// startnotitie bij de voorbereiding te staan.
const createDefaultAnswers = (candidate?: any) => {
  const answers: Record<string, ScreeningAnswer> = {};
  Object.values(QUESTION_BANK).flat().forEach((q) => {
    answers[q.key] = { asked: false, notes: '' };
  });
  if (!candidate) return answers;

  const prefill = (key: string, notes: string) => {
    if (answers[key]) answers[key] = { asked: true, notes };
  };

  const phoneParts = [candidate.phone, candidate.phone_nl && `NL ${candidate.phone_nl}`].filter(Boolean);
  if (phoneParts.length > 0) {
    prefill('phone_reachable', `Bekend: ${phoneParts.join(' / ')} — bevestigen + voorkeurskanaal/beltijd vragen`);
  }
  if (candidate.nationality) {
    prefill('identity_work_right', `Nationaliteit: ${candidate.nationality} — identiteits-/werkdocumenten bevestigen`);
  }
  if (candidate.has_drivers_license) {
    const exp = candidate.drivers_license_expiry ? `, geldig tot ${candidate.drivers_license_expiry}` : '';
    prefill('drivers_license_type', `Rijbewijs geregistreerd${exp} — type en bewijs bevestigen`);
  }
  const skills: string[] = Array.isArray(candidate.skills) ? candidate.skills : [];
  if (skills.length > 0) {
    prefill('experience_summary', `Bekend uit dossier: ${skills.join(', ')} — ervaring/jaren en machines toelichten`);
  }
  const certs: string[] = Array.isArray(candidate.certifications) ? candidate.certifications : [];
  if (certs.length > 0) {
    prefill('education_certificates', `Certificaten: ${certs.join(', ')} — geldigheid/originelen bevestigen`);
  }
  if (candidate.available_from) {
    const until = candidate.available_until ? ` tot ${candidate.available_until}` : '';
    prefill('availability_date', `Beschikbaar vanaf ${candidate.available_from}${until} — bevestigen`);
  }

  const aiQuestions: string[] = Array.isArray(candidate.ai_interview_questions) ? candidate.ai_interview_questions : [];
  if (aiQuestions.length > 0 && answers['prep_cv_check']) {
    answers['prep_cv_check'] = {
      asked: false,
      notes: `AI-belvragen om te stellen:\n${aiQuestions.slice(0, 8).map((q) => `- ${q}`).join('\n')}`,
    };
  }

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
  drivers_license_expiry: candidate.drivers_license_expiry ?? '',
  skills: candidate.skills ?? [],
  languages: candidate.languages ?? [],
  certifications: candidate.certifications ?? [],
  availability_notes: stripGeneratedAvailabilityNotes(candidate.availability_notes),
});

const getInitialData = (candidate: any): ScreeningData => {
  const existing = candidate.screening_data as Partial<ScreeningData> | null;
  const existingAvailability = (existing?.availability ?? {}) as Partial<ScreeningData['availability']>;
  const answers = { ...createDefaultAnswers(candidate), ...(existing?.answers ?? {}) };
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

const uniqueStrings = (values: unknown[]): string[] => [
  ...new Set(values.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean)),
];

const aiLanguageLabel = (item: any): string => {
  if (typeof item === 'string') return item.trim();
  const taal = String(item?.taal ?? '').trim();
  if (!taal) return '';
  const niveau = item?.niveau && item.niveau !== 'onbekend' ? ` - ${item.niveau}` : '';
  return `${taal}${niveau}`;
};

const getAiProfileSuggestions = (candidate: any): Pick<ProfileDraft, 'skills' | 'languages' | 'certifications'> => {
  const analysis = candidate.ai_analysis as any;
  const hardSkills = (analysis?.competenties?.hard_skills ?? []).map((item: any) =>
    typeof item === 'string' ? item : item?.vaardigheid,
  );
  const softSkills = (analysis?.competenties?.soft_skills ?? []).map((item: any) =>
    typeof item === 'string' ? item : item?.vaardigheid,
  );
  const certifications = (analysis?.competenties?.certificaten ?? []).map((item: any) =>
    typeof item === 'string' ? item : item?.naam,
  );
  const languages = (analysis?.competenties?.talen ?? []).map(aiLanguageLabel);
  return {
    skills: uniqueStrings([...hardSkills, ...softSkills]),
    languages: uniqueStrings(languages),
    certifications: uniqueStrings(certifications),
  };
};

const hasArrayDiff = (current: string[], suggested: string[]) => {
  if (suggested.length === 0) return false;
  const currentSet = new Set(current.map((v) => v.trim().toLowerCase()));
  return suggested.some((value) => !currentSet.has(value.trim().toLowerCase()));
};

const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const normalizeCompare = (value: unknown) =>
  clean(value).toLowerCase().replace(/\s+/g, ' ');

const displayList = (values: string[]) => values.length > 0 ? values.join(', ') : 'Nog leeg';

const aiSkillLabel = (item: any): string => {
  if (typeof item === 'string') return item.trim();
  return clean(item?.vaardigheid ?? item?.naam ?? item?.label);
};

const aiCertLabel = (item: any): string => {
  if (typeof item === 'string') return item.trim();
  return clean(item?.naam);
};

const uniqueCleanStrings = (values: unknown[]): string[] => [
  ...new Set(values.map(clean).filter(Boolean)),
];

type ProfileSuggestion =
  | { kind: 'text'; key: keyof ProfileDraft; label: string; current: string; suggested: string }
  | { kind: 'list'; key: 'skills' | 'languages' | 'certifications'; label: string; current: string[]; suggested: string[] };

const isDutchMobileCandidate = (value: string) => /^(?:\+31|0031|0)\s*6/.test(value.replace(/[()\-.]/g, ' ').trim());

const getAiProfileDiffs = (candidate: any, draft: ProfileDraft): ProfileSuggestion[] => {
  const analysis = candidate.ai_analysis as any;
  const personalia = analysis?.personalia ?? {};
  const suggestions = getAiProfileSuggestions(candidate);
  const diffs: ProfileSuggestion[] = [];

  const addText = (key: keyof ProfileDraft, label: string, suggestedRaw: unknown) => {
    const suggested = clean(suggestedRaw);
    if (!suggested) return;
    const current = clean(draft[key]);
    if (normalizeCompare(current) === normalizeCompare(suggested)) return;
    diffs.push({ kind: 'text', key, label, current, suggested });
  };

  const addList = (key: 'skills' | 'languages' | 'certifications', label: string, suggestedRaw: string[]) => {
    const suggested = uniqueCleanStrings(suggestedRaw);
    if (!hasArrayDiff(draft[key], suggested)) return;
    diffs.push({ kind: 'list', key, label, current: draft[key], suggested });
  };

  const foundPhone = clean(personalia.telefoon_gevonden);
  if (foundPhone) {
    addText(isDutchMobileCandidate(foundPhone) ? 'phone_nl' : 'phone', isDutchMobileCandidate(foundPhone) ? 'Telefoon NL' : 'Telefoon EU/buitenland', foundPhone);
  }
  addText('email', 'E-mailadres', personalia.email_gevonden);
  addText('nationality', 'Nationaliteit', personalia.nationaliteit);
  addText('address_city', 'Woonplaats', personalia.woonplaats);
  addList('skills', 'Vaardigheden', suggestions.skills);
  addList('certifications', 'Certificaten', suggestions.certifications);
  addList('languages', 'Talen', suggestions.languages);

  return diffs;
};

const aiWorkFunctions = (analysis: any): string[] => uniqueCleanStrings([
  ...(analysis?.doelgroep?.functies ?? []),
  ...(analysis?.werkhistorie?.werkgevers ?? []).map((w: any) => w?.functie),
]).slice(0, 8);

const aiHardSkillLabels = (analysis: any): string[] =>
  uniqueCleanStrings((analysis?.competenties?.hard_skills ?? []).map(aiSkillLabel)).slice(0, 12);

const aiLanguageLabels = (analysis: any): string[] =>
  uniqueCleanStrings((analysis?.competenties?.talen ?? []).map(aiLanguageLabel)).slice(0, 8);

const aiCertLabels = (analysis: any): string[] =>
  uniqueCleanStrings((analysis?.competenties?.certificaten ?? []).map(aiCertLabel)).slice(0, 8);

const workDurationMonths = (entry: any): number | null => {
  const raw = Number(entry?.duur_maanden);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
};

const formatWorkDuration = (months: number | null) => {
  if (!months) return 'Duur onbekend';
  if (months < 12) return `${months} mnd`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (rest === 0) return `${years} jaar`;
  return `${years}j ${rest}m`;
};

const durationToneClass = (months: number | null) => {
  if (!months) return 'bg-muted text-muted-foreground border-0';
  if (months >= 24) return 'bg-stat-green/10 text-stat-green border-0';
  if (months >= 12) return 'bg-blue-100 text-blue-700 border-0';
  if (months >= 6) return 'bg-amber-100 text-amber-800 border-0';
  return 'bg-red-100 text-red-700 border-0';
};

const durationRailClass = (months: number | null) => {
  if (!months) return 'bg-muted-foreground/30';
  if (months >= 24) return 'bg-stat-green';
  if (months >= 12) return 'bg-blue-500';
  if (months >= 6) return 'bg-amber-500';
  return 'bg-red-500';
};

// Bouwt de tekst voor de "Screening voltooid"-notitie: resultaat + samenvatting,
// gevolgd door alle vragen met hun antwoorden, plus de eindbeoordeling.
const buildScreeningNoteContent = (data: ScreeningData): string => {
  const resultLabel = RESULT_OPTIONS.find((r) => r.value === data.result)?.label ?? data.result;
  const lines: string[] = [`Screening voltooid — ${resultLabel}`];

  if (data.summary.trim()) {
    lines.push('', 'Samenvatting:', data.summary.trim());
  }

  lines.push('', 'Vragen en antwoorden:');
  SCREENING_STEPS.forEach((step) => {
    const qs = QUESTION_BANK[step.id] ?? [];
    if (qs.length === 0) return;
    lines.push('', `${step.label}:`);
    qs.forEach((q) => {
      const answer = data.answers[q.key] ?? { asked: false, notes: '' };
      const mark = answer.asked ? '[x]' : '[ ]';
      const notes = answer.notes.trim() ? answer.notes.trim() : '—';
      lines.push(`${mark} ${q.label}: ${notes}`);
    });
  });

  const profRating = PROFESSIONAL_RATINGS.find((r) => r.value === data.professional.rating)?.label;
  const riskLabel = RISK_LEVELS.find((r) => r.value === data.personal.risk_level)?.label;
  const evaluation: string[] = [];
  if (profRating && data.professional.rating !== 'niet_beoordeeld') {
    evaluation.push(`Vakinhoudelijk: ${profRating}${data.professional.notes.trim() ? ` — ${data.professional.notes.trim()}` : ''}`);
  }
  if (riskLabel && data.personal.risk_level !== 'niet_beoordeeld') {
    evaluation.push(`Risico: ${riskLabel}${data.personal.notes.trim() ? ` — ${data.personal.notes.trim()}` : ''}`);
  }
  if (evaluation.length > 0) {
    lines.push('', 'Beoordeling:', ...evaluation);
  }

  return lines.join('\n').trim();
};

const CandidateScreeningTab = ({
  candidate,
  vacancyId,
  onUpdate,
  onDirtyChange,
}: {
  candidate: any;
  vacancyId?: string | null;
  onUpdate: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: sensitive, isLoading: sensitiveLoading } = useDecryptedCandidate(candidate.id);
  const [data, setData] = useState<ScreeningData>(() => getInitialData(candidate));
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(() => getProfileDraft(candidate));
  const [saving, setSaving] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>((candidate.screening_data as any)?.updated_at ?? candidate.screened_at ?? null);
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState(() => buildSnapshot(getInitialData(candidate), getProfileDraft(candidate)));
  const saveSeq = useRef(0);
  const aiEnabled = useModuleEnabled('ai-analyse');

  // Vakinhoudelijke belvragen (hybride): geopend vanuit een match → ?vacancy=<id>.
  // Deterministische laag = gratis, uit match_breakdown.missing; AI-laag = Gemini (kost credits).
  const [aiCallQuestions, setAiCallQuestions] = useState<string[]>([]);
  const [aiCallLoading, setAiCallLoading] = useState(false);
  const [aiCallMeta, setAiCallMeta] = useState<{ cost: number; balance: number } | null>(null);

  const { data: screeningVacancy } = useQuery({
    queryKey: ['screening-vacancy', vacancyId],
    enabled: !!vacancyId,
    queryFn: async () => {
      const { data, error } = await supabase.from('vacancies').select('id, title').eq('id', vacancyId!).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: screeningMatch } = useQuery({
    queryKey: ['screening-match', candidate.id, vacancyId],
    enabled: !!vacancyId,
    queryFn: async () => {
      const { data } = await supabase
        .from('matches')
        .select('match_breakdown')
        .eq('candidate_id', candidate.id)
        .eq('vacancy_id', vacancyId!)
        .maybeSingle();
      return data ?? null;
    },
  });

  const deterministicCallQuestions = useMemo(
    () => deriveCallQuestions((screeningMatch?.match_breakdown as any) ?? null),
    [screeningMatch],
  );

  const generateAiCallQuestions = async () => {
    if (!vacancyId) return;
    setAiCallLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-call-questions', {
        body: { candidate_id: candidate.id, vacancy_id: vacancyId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const qs = Array.isArray((data as any)?.questions) ? (data as any).questions as string[] : [];
      setAiCallQuestions(qs);
      const cost = (data as any)?.cost_cents;
      if (typeof cost === 'number') setAiCallMeta({ cost, balance: (data as any)?.balance_cents ?? 0 });
      toast.success(`AI-vragen gegenereerd${typeof cost === 'number' ? ` (${(cost / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' })})` : ''}`);
    } catch (e) {
      toast.error(await extractFunctionErrorMessage(e, 'AI-vragen genereren mislukt'));
    } finally {
      setAiCallLoading(false);
    }
  };

  const currentStepIndex = Math.max(0, SCREENING_STEPS.findIndex((step) => step.id === data.current_step));
  const currentStep = SCREENING_STEPS[currentStepIndex] ?? SCREENING_STEPS[0];
  const questions = QUESTION_BANK[currentStep.id] ?? [];
  const CurrentStepIcon = currentStep.icon;
  const missingProfileFields = getMissingProfileFields(candidate);
  const interviewQuestions: string[] = candidate.ai_interview_questions ?? [];
  const riskFactors: string[] = candidate.ai_risk_factors ?? [];
  const positiveSignals: string[] = candidate.ai_positive_signals ?? [];
  const targetFunctions: string[] = candidate.ai_target_functions ?? [];
  const analysis = candidate.ai_analysis as any;
  const aiProfileDiffs = useMemo(() => getAiProfileDiffs(candidate, profileDraft), [candidate, profileDraft]);
  const aiFacts = Array.isArray(analysis?.datakwaliteit?.feiten) ? analysis.datakwaliteit.feiten : [];
  const aiUnknowns = Array.isArray(analysis?.datakwaliteit?.onbekend) ? analysis.datakwaliteit.onbekend : [];
  const aiAssumptions = Array.isArray(analysis?.datakwaliteit?.aannames) ? analysis.datakwaliteit.aannames : [];
  const aiFunctions = aiWorkFunctions(analysis);
  const aiHardSkills = aiHardSkillLabels(analysis);
  const aiLanguages = aiLanguageLabels(analysis);
  const aiCerts = aiCertLabels(analysis);
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

  const profilePayload = useCallback((draft: ProfileDraft, availability: ScreeningData['availability']) => {
    const phones = mergeCandidatePhoneFields({ phone: draft.phone, phone_nl: draft.phone_nl });
    return {
      phone: phones.phone || null,
      phone_nl: phones.phone_nl || null,
      email: draft.email.trim() || null,
      date_of_birth: draft.date_of_birth || null,
      nationality: draft.nationality.trim() || null,
      address_street: draft.address_street.trim() || null,
      address_postal: draft.address_postal.trim() || null,
      address_city: draft.address_city.trim() || null,
      has_drivers_license: draft.has_drivers_license,
      drivers_license_expiry: draft.has_drivers_license && draft.drivers_license_expiry ? draft.drivers_license_expiry : null,
      skills: draft.skills,
      languages: draft.languages,
      certifications: draft.certifications,
      available_from: availability.available_from || null,
      available_until: availability.available_until || null,
      arrival_date: availability.arrival_date || null,
      availability_notes: buildAvailabilityNotes(availability, draft.availability_notes) || null,
    };
  }, []);

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

      // Bij voltooiing: een notitie "Screening voltooid" met alle vragen + antwoorden
      // vastleggen op het kandidaatdossier. Non-kritisch: faalt het, dan blijft de
      // screening wel afgerond.
      if (complete && user?.id) {
        try {
          const { error: noteError } = await supabase.from('notes').insert({
            body: buildScreeningNoteContent(screeningData),
            is_internal: true,
            related_entity_id: candidate.id,
            related_entity_type: 'kandidaat',
            created_by: user.id,
            organization_id: candidate.organization_id,
          } as any);
          if (noteError) throw noteError;
          qc.invalidateQueries({ queryKey: ['notes', 'kandidaat', candidate.id] });
        } catch (noteErr) {
          console.warn('Screeningnotitie aanmaken mislukt (non-kritisch):', noteErr);
        }
      }

      if (manual) toast.success(complete ? 'Screening afgerond' : 'Concept opgeslagen');
      onUpdate();
    } catch (e: any) {
      if (manual) toast.error(e.message || 'Fout bij opslaan');
    } finally {
      setSaving(false);
      if (manual) setManualSaving(false);
    }
  }, [candidate.id, candidate.organization_id, candidate.screened_at, candidate.status, data, onUpdate, profileDraft, profilePayload, qc, user?.id]);

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

  // BSN/IBAN zijn versleuteld: apart opslaan (trigger versleutelt op write) en de
  // decrypt-cache invalideren, los van de screening-autosave.
  const saveSensitive = useCallback(async (field: 'bsn' | 'iban', value: string | null) => {
    const { error } = await supabase.from('candidates').update({ [field]: value } as any).eq('id', candidate.id);
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ['candidate-decrypted', candidate.id] });
    qc.invalidateQueries({ queryKey: ['candidate', candidate.id] });
    logAudit({ action: 'update', tableName: 'candidates', recordId: candidate.id, newValues: { [field]: '***' } });
    onUpdate();
  }, [candidate.id, qc, onUpdate]);

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

  const validateBeforeComplete = (): boolean => {
    const missing = importantMissingFields(profileDraft, data.availability);
    if (data.result === 'niet_gescreend') {
      toast.error('Kies eerst goedgekeurd of afgekeurd');
      return false;
    }
    if (data.summary.trim().length < 10) {
      toast.error('Vul een korte samenvatting in');
      return false;
    }
    if (missing.length > 0 && !data.answers.critical_unknowns?.notes?.trim()) {
      toast.error(`Leg bij Besluit vast waarom ontbrekend akkoord is: ${missing.join(', ')}`);
      setData((current) => ({ ...current, current_step: 'besluit' }));
      return false;
    }
    return true;
  };

  const handleComplete = async () => {
    if (!validateBeforeComplete()) return;
    await persistDraft({ complete: true, manual: true });
  };

  const takeAiSuggestion = (suggestion: ProfileSuggestion) => {
    setProfileDraft((current) => ({
      ...current,
      [suggestion.key]: suggestion.kind === 'list' ? suggestion.suggested : suggestion.suggested,
    }));
    toast.success('AI-suggestie overgenomen in het concept');
  };

  // Afronden + de AI opnieuw laten analyseren mét de screening erin (NS1, meeting 17-06):
  // de recruiter-screening weegt zwaarder dan het CV; het profiel wordt herzien.
  const handleCompleteAndReanalyze = async () => {
    if (!validateBeforeComplete()) return;
    setReanalyzing(true);
    try {
      await persistDraft({ complete: true, manual: true });
      const waitForCurrentAnalysis = async () => {
        const deadline = Date.now() + 180_000;
        while (Date.now() < deadline) {
          const { data: current, error } = await supabase
            .from('candidates')
            .select('ai_status')
            .eq('id', candidate.id)
            .single();
          if (error) throw error;
          if (current?.ai_status !== 'analyzing') return;
          await new Promise((resolve) => window.setTimeout(resolve, 3_000));
        }
        throw new Error('Er loopt nog een AI-analyse. Probeer over enkele minuten opnieuw.');
      };

      const startAnalysis = async (): Promise<void> => {
        await waitForCurrentAnalysis();
        const { error } = await supabase.functions.invoke('analyze-cv', { body: { candidate_id: candidate.id } });
        if (!error) return;

        const message = await extractFunctionErrorMessage(error, 'Heranalyse kon niet starten');
        if (message.toLowerCase().includes('analyse loopt al')) {
          await waitForCurrentAnalysis();
          const { error: retryError } = await supabase.functions.invoke('analyze-cv', { body: { candidate_id: candidate.id } });
          if (!retryError) return;
          throw new Error(await extractFunctionErrorMessage(retryError, 'Heranalyse kon niet starten'));
        }

        throw new Error(message);
      };

      await startAnalysis();
      await qc.invalidateQueries({ queryKey: ['candidate', candidate.id] });
      await qc.invalidateQueries({ queryKey: ['candidates'] });
      onUpdate();
      toast.success('Screening opgeslagen — AI heranalyseert met de screening (1-3 min)');
    } catch (e: any) {
      toast.error(e?.message || 'Heranalyse kon niet starten');
    } finally {
      setReanalyzing(false);
    }
  };

  const renderProfileFields = () => {
    if (currentStep.id === 'contact_identiteit') {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Telefoon EU/buitenland</Label><Input value={profileDraft.phone} onChange={(e) => setProfileDraft((p) => ({ ...p, phone: e.target.value }))} /></div>
          <div><Label>Telefoon NL</Label><Input value={profileDraft.phone_nl} onChange={(e) => setProfileDraft((p) => ({ ...p, phone_nl: e.target.value }))} /></div>
          <div><Label>E-mail</Label><Input value={profileDraft.email} onChange={(e) => setProfileDraft((p) => ({ ...p, email: e.target.value }))} /></div>
          <div><Label>Geboortedatum</Label><Input type="date" value={profileDraft.date_of_birth} onChange={(e) => setProfileDraft((p) => ({ ...p, date_of_birth: e.target.value }))} /></div>
          <div><Label>Nationaliteit</Label><NationalitySelect value={profileDraft.nationality} onChange={(nationality) => setProfileDraft((p) => ({ ...p, nationality }))} /></div>
          <div><Label>Woonplaats</Label><Input value={profileDraft.address_city} onChange={(e) => setProfileDraft((p) => ({ ...p, address_city: e.target.value }))} /></div>
          <div><Label>Straat</Label><Input value={profileDraft.address_street} onChange={(e) => setProfileDraft((p) => ({ ...p, address_street: e.target.value }))} /></div>
          <div><Label>Postcode</Label><Input value={profileDraft.address_postal} onChange={(e) => setProfileDraft((p) => ({ ...p, address_postal: e.target.value }))} /></div>
          <InlineSensitiveField
            id="screening_bsn"
            label="BSN"
            value={sensitive?.decrypted_bsn}
            loading={sensitiveLoading}
            placeholder="123456789"
            inputMode="numeric"
            onSave={(value) => saveSensitive('bsn', value)}
            onDirtyChange={() => {}}
          />
          <InlineSensitiveField
            id="screening_iban"
            label="IBAN"
            value={sensitive?.decrypted_iban}
            loading={sensitiveLoading}
            placeholder="NL00 BANK 0000 0000 00"
            onSave={(value) => saveSensitive('iban', value)}
            onDirtyChange={() => {}}
          />
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
          {profileDraft.has_drivers_license && (
            <div className="max-w-xs space-y-1.5">
              <Label>Verloopdatum rijbewijs</Label>
              <Input type="date" value={profileDraft.drivers_license_expiry} onChange={(e) => setProfileDraft((p) => ({ ...p, drivers_license_expiry: e.target.value }))} />
            </div>
          )}
        </div>
      );
    }

    if (currentStep.id === 'werkprofiel') {
      return (
        <div className="grid gap-3">
          <div><Label>Vaardigheden</Label><SkillMultiSelect value={profileDraft.skills} onChange={(skills) => setProfileDraft((p) => ({ ...p, skills }))} /></div>
          <div><Label>Certificaten</Label><TagInput value={profileDraft.certifications} onChange={(certifications) => setProfileDraft((p) => ({ ...p, certifications }))} placeholder="Typ certificaat + Enter" /></div>
          <div><Label>Talen</Label><LanguageMultiSelect value={profileDraft.languages} onChange={(languages) => setProfileDraft((p) => ({ ...p, languages }))} /></div>
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

  const chipList = (values: string[], empty = 'Nog niet bekend') => (
    <div className="flex flex-wrap gap-1.5">
      {values.length > 0
        ? values.map((value) => <Badge key={value} variant="outline" className="max-w-full truncate text-[11px]">{value}</Badge>)
        : <span className="text-xs text-muted-foreground">{empty}</span>}
    </div>
  );

  const renderKeywordSidebar = () => {
    const address = [profileDraft.address_street, profileDraft.address_postal, profileDraft.address_city].filter(Boolean).join(', ');
    const phone = profileDraft.phone_nl || profileDraft.phone || 'Geen telefoon';
    const availability = [
      data.availability.available_from ? `Vanaf ${data.availability.available_from}` : null,
      data.availability.available_until ? `tot ${data.availability.available_until}` : null,
      data.availability.arrival_date ? `aankomst ${data.availability.arrival_date}` : null,
    ].filter(Boolean).join(' · ');
    const missing = importantMissingFields(profileDraft, data.availability);

    return (
      <Card className="h-fit p-4 xl:sticky xl:top-4" data-testid="screening-key-profile">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Info className="h-4 w-4 text-muted-foreground" />
            Kernprofiel
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0">
                <h3 className="truncate font-semibold">{candidate.first_name} {candidate.last_name}</h3>
                <p className="truncate text-xs text-muted-foreground">{profileDraft.nationality || 'Nationaliteit onbekend'}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
              {analysis?.samenvatting?.plaatsbaarheid_score != null && (
                <Badge variant="outline">Plaatsbaarheid {analysis.samenvatting.plaatsbaarheid_score}/10</Badge>
              )}
              {candidate.ai_classification && <Badge variant="secondary">{candidate.ai_classification}</Badge>}
            </div>
            {data.status === 'concept_opgeslagen' && (
              <p className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                Concept: belnotities zijn opgeslagen, maar de screening is nog niet afgerond.
              </p>
            )}
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-start gap-2 text-muted-foreground">
              <PhoneCall className="mt-0.5 h-3.5 w-3.5" />
              <span className="break-all">{phone}</span>
            </div>
            <div className="flex items-start gap-2 text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5" />
              <span>{address || 'Adres/verblijfplaats onbekend'}</span>
            </div>
            <div className="flex items-start gap-2 text-muted-foreground">
              <CalendarClock className="mt-0.5 h-3.5 w-3.5" />
              <span>{availability || 'Beschikbaarheid nog controleren'}</span>
            </div>
          </div>

          <div className="border-t pt-3 space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">Functies / ervaring</p>
              {chipList(aiFunctions, 'Nog geen AI-functies')}
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">Competenties</p>
              {chipList(profileDraft.skills.length ? profileDraft.skills.slice(0, 10) : aiHardSkills.slice(0, 10))}
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">Talen</p>
              {chipList(profileDraft.languages.length ? profileDraft.languages.slice(0, 8) : aiLanguages)}
            </div>
            {aiCerts.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">Certificaten</p>
                {chipList(aiCerts)}
              </div>
            )}
          </div>

          <div className="border-t pt-3">
            <p className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">Nog navragen</p>
            <div className="space-y-1.5">
              {missing.slice(0, 5).map((item) => (
                <div key={item} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{item}</div>
              ))}
              {aiUnknowns.slice(0, 3).map((item: any, index: number) => (
                <div key={`${item?.veld ?? 'onbekend'}-${index}`} className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                  {item?.veld ?? 'Onbekend'}{item?.vervolgvraag ? `: ${item.vervolgvraag}` : ''}
                </div>
              ))}
              {missing.length === 0 && aiUnknowns.length === 0 && (
                <p className="text-xs text-muted-foreground">Geen kritieke open punten.</p>
              )}
            </div>
          </div>
        </div>
      </Card>
    );
  };

  const renderAiReviewPanel = () => (
    <Card className="p-4 space-y-4 border-l-4 border-l-amber-500">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-600" />
          <div>
            <h3 className="font-semibold text-sm">AI-feiten controleren</h3>
            <p className="text-xs text-muted-foreground">AI past profieldata niet direct aan; overnemen blijft recruiterkeuze.</p>
          </div>
        </div>
        <Badge variant="outline">{aiProfileDiffs.length} verschil{aiProfileDiffs.length === 1 ? '' : 'len'}</Badge>
      </div>

      {aiProfileDiffs.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {aiProfileDiffs.map((field) => (
            <div key={`${field.key}-${field.label}`} className="rounded-md border bg-background p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label>{field.label}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  onClick={() => takeAiSuggestion(field)}
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" /> Overnemen
                </Button>
              </div>
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Profiel</p>
                  <p className="break-words">{field.kind === 'list' ? displayList(field.current) : field.current || 'Nog leeg'}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">AI / screening</p>
                  <p className="break-words">{field.kind === 'list' ? displayList(field.suggested) : field.suggested}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Geen concrete profielverschillen gevonden in de AI-analyse.</p>
      )}

      {(aiFacts.length > 0 || aiAssumptions.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md bg-stat-green/5 p-3">
            <p className="mb-2 text-xs font-medium text-stat-green">Harde feiten</p>
            <div className="space-y-1.5">
              {aiFacts.slice(0, 5).map((item: any, index: number) => (
                <p key={`${item?.veld ?? 'feit'}-${index}`} className="text-xs">
                  <span className="font-medium">{item?.veld}</span>{item?.waarde ? `: ${item.waarde}` : ''}
                </p>
              ))}
              {aiFacts.length === 0 && <p className="text-xs text-muted-foreground">Geen harde feiten gemarkeerd.</p>}
            </div>
          </div>
          <div className="rounded-md bg-orange-50 p-3">
            <p className="mb-2 text-xs font-medium text-orange-700">Aannames</p>
            <div className="space-y-1.5">
              {aiAssumptions.slice(0, 5).map((item: any, index: number) => (
                <p key={`${item?.veld ?? 'aanname'}-${index}`} className="text-xs">
                  <span className="font-medium">{item?.veld}</span>{item?.aanname ? `: ${item.aanname}` : ''}
                </p>
              ))}
              {aiAssumptions.length === 0 && <p className="text-xs text-muted-foreground">Geen aannames gemarkeerd.</p>}
            </div>
          </div>
        </div>
      )}
    </Card>
  );

  const renderAiNarrativePanel = () => {
    if (!analysis) return null;
    const employers = Array.isArray(analysis?.werkhistorie?.werkgevers) ? analysis.werkhistorie.werkgevers : [];
    const gaps = Array.isArray(analysis?.werkhistorie?.gaten) ? analysis.werkhistorie.gaten : [];
    const totalYears = typeof analysis?.werkhistorie?.totale_werkervaring_jaren === 'number'
      ? analysis.werkhistorie.totale_werkervaring_jaren
      : undefined;

    return (
      <Card className="p-4 space-y-4 border-l-4 border-l-blue-500">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-blue-600" />
          <div>
            <h3 className="font-semibold text-sm">AI-beredenering</h3>
            <p className="text-xs text-muted-foreground">Langere analyse blijft beschikbaar, los van het belmenu.</p>
          </div>
        </div>

        {analysis?.samenvatting?.profiel && (
          <div className="rounded-md bg-muted/40 p-3">
            <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Profielschets</p>
            <p className="text-sm leading-relaxed">{analysis.samenvatting.profiel}</p>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {analysis?.samenvatting?.topkwaliteit && (
            <div className="rounded-md bg-stat-green/5 p-3">
              <p className="mb-1 text-xs font-medium text-stat-green">Sterkste signaal</p>
              <p className="text-sm">{analysis.samenvatting.topkwaliteit}</p>
            </div>
          )}
          {analysis?.samenvatting?.aandachtspunt && (
            <div className="rounded-md bg-orange-50 p-3">
              <p className="mb-1 text-xs font-medium text-orange-700">Aandachtspunt</p>
              <p className="text-sm">{analysis.samenvatting.aandachtspunt}</p>
            </div>
          )}
        </div>

        {analysis?.plaatsingsadvies?.onderbouwing && (
          <div className="rounded-md border p-3">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium"><Target className="h-3.5 w-3.5" /> Plaatsingsadvies</div>
            <p className="text-sm text-muted-foreground">{analysis.plaatsingsadvies.onderbouwing}</p>
          </div>
        )}

        {analysis?.eigenschappen?.toelichting && (
          <div className="rounded-md border p-3">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium"><TrendingUp className="h-3.5 w-3.5" /> Stabiliteit en profieltype</div>
            <p className="text-sm text-muted-foreground">{analysis.eigenschappen.toelichting}</p>
          </div>
        )}

        {(employers.length > 0 || gaps.length > 0) && (
          <div className="rounded-md border p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium"><Briefcase className="h-3.5 w-3.5" /> Werkervaring</div>
              {typeof totalYears === 'number' && (
                <Badge variant="secondary" className="text-xs">{totalYears} jaar totaal</Badge>
              )}
            </div>

            {employers.length > 0 && (
              <WorkHistoryTimeline
                werkgevers={employers}
                gaten={gaps}
                totaleJaren={totalYears}
                className="mb-3 rounded-md bg-muted/25 p-3"
              />
            )}

            <div className="grid gap-2 md:grid-cols-2">
              {employers.slice(0, 6).map((job: any, index: number) => {
                const months = workDurationMonths(job);
                const activities = Array.isArray(job?.kernactiviteiten) ? job.kernactiviteiten.slice(0, 3) : [];
                return (
                  <div key={`${job?.bedrijf ?? 'werk'}-${index}`} className="relative overflow-hidden rounded-md border bg-background p-3 text-sm">
                    <span className={cn('absolute inset-y-0 left-0 w-1', durationRailClass(months))} />
                    <div className="flex items-start justify-between gap-2 pl-2">
                      <div className="min-w-0">
                        <p className="line-clamp-2 font-medium leading-5">{job?.functie || 'Functie onbekend'}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{[job?.bedrijf, job?.periode].filter(Boolean).join(' · ') || 'Werkgever/periode onbekend'}</p>
                      </div>
                      <Badge className={cn('shrink-0 text-[11px]', durationToneClass(months))}>
                        {formatWorkDuration(months)}
                      </Badge>
                    </div>
                    {activities.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1 pl-2">
                        {activities.map((activity: string) => (
                          <span key={`${job?.bedrijf ?? 'werk'}-${activity}`} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            {activity}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {employers.length > 6 && (
                <div className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
                  +{employers.length - 6} eerdere werkgever{employers.length - 6 === 1 ? '' : 's'} in de AI-analyse.
                </div>
              )}
            </div>

            <div className="mt-2 space-y-1.5">
              {gaps.slice(0, 3).map((gap: any, index: number) => (
                <div key={`${gap?.periode ?? 'gat'}-${index}`} className="rounded bg-orange-50 px-2 py-1 text-xs text-orange-700">
                  Gat: {gap?.periode}{gap?.duur_maanden ? ` (${gap.duur_maanden} mnd)` : ''}{gap?.mogelijke_verklaring ? ` · ${gap.mogelijke_verklaring}` : ''}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
              <Badge variant="outline">{askedCount(data)}/{Object.values(QUESTION_BANK).flat().length} punten vastgelegd</Badge>
              {saving && <Badge variant="outline" className="gap-1"><Clock3 className="h-3 w-3 animate-pulse" /> Autosave</Badge>}
              {dirty && !saving && <Badge variant="outline" className="border-amber-200 text-amber-700">Onopgeslagen wijzigingen</Badge>}
            </div>
            <div>
              <h3 className="font-semibold">Screening-cockpit</h3>
              <p className="text-sm text-muted-foreground">
                Harde kerngegevens, AI-beredenering en belmenu gescheiden op één werkvlak.
              </p>
            </div>
            {lastSavedAt && (
              <p className="text-xs text-muted-foreground">
                Laatst opgeslagen: {new Date(lastSavedAt).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {data.status === 'niet_gestart' && (
              <Button onClick={startCall} className="gap-2" data-testid="screening-start-call">
                <PhoneCall className="h-4 w-4" /> Start gesprek
              </Button>
            )}
            <Button variant="outline" onClick={() => persistDraft({ manual: true })} disabled={manualSaving || data.status === 'niet_gestart'} className="gap-2" data-testid="screening-save-draft">
              <Save className="h-4 w-4" /> {manualSaving ? 'Opslaan...' : 'Concept opslaan'}
            </Button>
            <Button variant="outline" onClick={handleCreateFollowupTask} disabled={creatingTask} className="gap-2">
              <AlertTriangle className="h-4 w-4" /> {creatingTask ? 'Aanmaken...' : 'Maak taak'}
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        {renderKeywordSidebar()}

        <div className="min-w-0 space-y-4">
          {aiEnabled && renderAiReviewPanel()}
          {renderAiNarrativePanel()}

          {vacancyId && (
            <Card className="p-4 space-y-3 border-l-4 border-l-green-500">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-green-600" />
                  <h3 className="font-semibold text-sm">
                    Matchvragen{screeningVacancy?.title ? ` — ${screeningVacancy.title}` : ''}
                  </h3>
                </div>
                {aiEnabled && (
                  <Button size="sm" variant="outline" onClick={generateAiCallQuestions} disabled={aiCallLoading}>
                    <Sparkles className="mr-1 h-3.5 w-3.5" /> {aiCallLoading ? 'AI bezig...' : 'AI-vragen genereren'}
                  </Button>
                )}
              </div>
              {deterministicCallQuestions.length > 0 ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {deterministicCallQuestions.map((q, i) => (
                    <div key={`det-${i}`} className="rounded-md border bg-background px-3 py-2 text-sm">{q}</div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Geen openstaande gaten uit de match.</p>
              )}
              {aiCallQuestions.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-muted-foreground">AI-gegenereerd</Label>
                  <div className="grid gap-2 md:grid-cols-2">
                    {aiCallQuestions.map((q, i) => (
                      <div key={`ai-${i}`} className="rounded-md border bg-background px-3 py-2 text-sm">{q}</div>
                    ))}
                  </div>
                  {aiCallMeta && (
                    <p className="text-[11px] text-muted-foreground">
                      Kosten: {(aiCallMeta.cost / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' })} · resterend budget: {(aiCallMeta.balance / 100).toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' })}
                    </p>
                  )}
                </div>
              )}
            </Card>
          )}

          <Card className="overflow-hidden border-l-4 border-l-primary">
            <div className="border-b bg-muted/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <PhoneCall className="h-4 w-4 text-primary" />
                  <div>
                    <h3 className="font-semibold text-sm">Belmenu / callflow</h3>
                    <p className="text-xs text-muted-foreground">Vinkje = recruiter heeft dit besproken of bewust gecontroleerd.</p>
                  </div>
                </div>
                <Badge variant="outline">{currentStepIndex + 1}/{SCREENING_STEPS.length}</Badge>
              </div>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
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
                        'flex h-10 shrink-0 items-center gap-2 rounded-md border bg-background px-3 text-sm transition-colors',
                        active && 'border-primary bg-primary text-primary-foreground',
                      )}
                    >
                      <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[11px]', active ? 'bg-primary-foreground/20' : 'bg-muted')}>
                        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                      </span>
                      <Icon className="h-3.5 w-3.5" />
                      <span>{step.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CurrentStepIcon className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold">{currentStep.label}</h3>
                </div>
                {data.status === 'concept_opgeslagen' && (
                  <Badge className="bg-amber-100 text-amber-800 border-0 gap-1">
                    <Info className="h-3 w-3" /> Concept belnotities
                  </Badge>
                )}
              </div>

              {renderProfileFields()}

              {questions.length > 0 && (
                <div className="grid gap-3">
                  {questions.map((question) => {
                    const answer = data.answers[question.key] ?? { asked: false, notes: '' };
                    return (
                      <div key={question.key} className="rounded-md border bg-background p-3 space-y-2">
                        <label className="flex cursor-pointer items-start gap-2">
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
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={handleComplete} disabled={manualSaving || reanalyzing} className="gap-2" data-testid="screening-complete">
                      <ClipboardCheck className="h-4 w-4" /> {manualSaving ? 'Afronden...' : 'Screening afronden'}
                    </Button>
                    <Button variant="secondary" onClick={handleCompleteAndReanalyze} disabled={manualSaving || reanalyzing} className="gap-2" data-testid="screening-complete-reanalyze">
                      <Sparkles className="h-4 w-4" /> {reanalyzing ? 'Bezig...' : 'Afronden + opnieuw analyseren'}
                    </Button>
                  </div>
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
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default CandidateScreeningTab;
