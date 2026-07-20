import type { MatchBreakdown } from '@/lib/matching';
import { mergeCandidatePhoneFields } from '@/lib/phone';

export type ScreeningStatus = 'niet_gestart' | 'in_gesprek' | 'concept_opgeslagen' | 'afgerond' | 'afgekeurd';

export type ScreeningAnswer = {
  asked: boolean;
  notes: string;
};

export interface ScreeningData {
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

export type ProfileDraft = {
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

export type ProfileSuggestion =
  | { kind: 'text'; key: keyof ProfileDraft; label: string; current: string; suggested: string }
  | { kind: 'list'; key: 'skills' | 'languages' | 'certifications'; label: string; current: string[]; suggested: string[] };

export type SensitiveCandidateField = 'bsn' | 'iban';

export type CandidateScreeningCandidate = {
  id: string;
  organization_id: string;
  first_name?: string | null;
  last_name?: string | null;
  status?: string | null;
  screened_at?: string | null;
  screened_by?: string | null;
  screening_data?: Partial<ScreeningData> | null;
  [key: string]: any;
};

export type CandidateScreeningCompletionNote = {
  body: string;
  is_internal: true;
  related_entity_id: string;
  related_entity_type: 'kandidaat';
  created_by: string;
  organization_id: string;
};

export type CandidateScreeningFollowupTask = {
  organization_id: string;
  assigned_to: string | null;
  title: string;
  description: string;
  priority: 'high' | 'medium';
  category: 'opvolging';
  status: 'open';
  related_entity_type: 'kandidaat';
  related_entity_id: string;
  ai_generated: false;
};

export interface CandidateScreeningSavePorts {
  updateCandidate(candidateId: string, updates: Record<string, unknown>): Promise<void>;
  insertCompletionNote?(note: CandidateScreeningCompletionNote): Promise<void>;
}

export interface CandidateScreeningFollowupTaskPorts {
  insertFollowupTask(task: CandidateScreeningFollowupTask): Promise<void>;
}

export interface CandidateScreeningSensitivePorts {
  updateSensitiveField(candidateId: string, field: SensitiveCandidateField, value: string | null): Promise<void>;
}

export interface CandidateScreeningReanalysisPorts {
  getCandidateAiStatus(candidateId: string): Promise<string | null | undefined>;
  startCandidateAnalysis(candidateId: string): Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface GeneratedCallQuestionsResult {
  questions: string[];
  costCents?: number;
  balanceCents?: number;
}

export const PROFESSIONAL_RATINGS = [
  { value: 'niet_beoordeeld', label: 'Niet beoordeeld' },
  { value: 'onvoldoende', label: 'Onvoldoende' },
  { value: 'voldoende', label: 'Voldoende' },
  { value: 'goed', label: 'Goed' },
  { value: 'uitstekend', label: 'Uitstekend' },
];

export const RISK_LEVELS = [
  { value: 'niet_beoordeeld', label: 'Niet beoordeeld' },
  { value: 'hoog_risico', label: 'Hoog risico' },
  { value: 'gemiddeld', label: 'Gemiddeld' },
  { value: 'laag_risico', label: 'Laag risico' },
];

export const RESULT_OPTIONS = [
  { value: 'niet_gescreend', label: 'Niet gescreend' },
  { value: 'afgekeurd', label: 'Afgekeurd' },
  { value: 'goedgekeurd', label: 'Goedgekeurd' },
];

export const SCREENING_STEPS = [
  { id: 'voorbereiding', label: 'Voorbereiding' },
  { id: 'contact_identiteit', label: 'Contact & identiteit' },
  { id: 'mobiliteit', label: 'Mobiliteit' },
  { id: 'werkprofiel', label: 'Werkprofiel' },
  { id: 'voorwaarden', label: 'Beschikbaarheid' },
  { id: 'persoonlijk', label: 'Persoonlijk' },
  { id: 'besluit', label: 'Besluit' },
] as const;

export type ScreeningStepId = typeof SCREENING_STEPS[number]['id'];

export const QUESTION_BANK: Record<string, Array<{ key: string; label: string; placeholder?: string }>> = {
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

export const CORE_PROFILE_FIELDS: Array<{ key: keyof ProfileDraft; label: string; isMissing: (candidate: CandidateScreeningCandidate) => boolean; question: string }> = [
  { key: 'phone', label: 'Telefoonnummer', isMissing: (c) => !c.phone && !c.phone_nl, question: 'Wat is je actuele telefoonnummer en ben je daarop via WhatsApp bereikbaar?' },
  { key: 'email', label: 'E-mailadres', isMissing: (c) => !c.email, question: 'Welk e-mailadres mogen we gebruiken voor documenten en planning?' },
  { key: 'date_of_birth', label: 'Geboortedatum', isMissing: (c) => !c.date_of_birth, question: 'Wat is je geboortedatum voor de personeelsadministratie?' },
  { key: 'nationality', label: 'Nationaliteit', isMissing: (c) => !c.nationality, question: 'Wat is je nationaliteit en heb je aanvullende werkdocumenten nodig?' },
  { key: 'address_city', label: 'Adres/verblijfplaats', isMissing: (c) => !c.address_street || !c.address_postal || !c.address_city, question: 'Wat is je huidige woonadres en verblijfplaats?' },
  { key: 'languages', label: 'Talen', isMissing: (c) => !Array.isArray(c.languages) || c.languages.length === 0, question: 'Welke talen spreek je en op welk niveau?' },
  { key: 'skills', label: 'Vaardigheden', isMissing: (c) => !Array.isArray(c.skills) || c.skills.length === 0, question: 'Welke concrete vaardigheden of machines beheers je?' },
  { key: 'certifications', label: 'Certificaten', isMissing: (c) => !Array.isArray(c.certifications) || c.certifications.length === 0, question: 'Welke certificaten heb je en zijn die nog geldig?' },
];

export const STATUS_META: Record<ScreeningStatus, { label: string; className: string }> = {
  niet_gestart: { label: 'Niet gestart', className: 'bg-muted text-muted-foreground border-0' },
  in_gesprek: { label: 'In gesprek', className: 'bg-blue-100 text-blue-700 border-0' },
  concept_opgeslagen: { label: 'Concept opgeslagen', className: 'bg-amber-100 text-amber-800 border-0' },
  afgerond: { label: 'Afgerond', className: 'bg-stat-green/10 text-stat-green border-0' },
  afgekeurd: { label: 'Afgekeurd', className: 'bg-red-100 text-red-600 border-0' },
};

export function createDefaultAnswers(candidate?: CandidateScreeningCandidate): Record<string, ScreeningAnswer> {
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
}

export function createDefaultPersonalChecklist() {
  return {
    woonsituatie: { asked: false, notes: '' },
    familiesituatie: { asked: false, notes: '' },
    werkervaring_nl: { asked: false, notes: '' },
    reisbereidheid: { asked: false, notes: '' },
    beschikbaarheid: { asked: false, notes: '' },
    taalvaardigheid: { asked: false, notes: '' },
    motivatie: { asked: false, notes: '' },
  };
}

export const stripGeneratedAvailabilityNotes = (notes?: string | null) =>
  String(notes ?? '')
    .split('\n')
    .filter((line) => !/^\s*(Beschikbaar vanaf|Beschikbaar tot|Aankomst\/check-in):/i.test(line))
    .join('\n')
    .trim();

export const buildAvailabilityNotes = (
  availability: ScreeningData['availability'],
  notes?: string | null,
) => [
  availability.available_from ? `Beschikbaar vanaf: ${availability.available_from}` : null,
  availability.available_until ? `Beschikbaar tot: ${availability.available_until}` : null,
  availability.arrival_date ? `Aankomst/check-in: ${availability.arrival_date}` : null,
  stripGeneratedAvailabilityNotes(notes),
].filter(Boolean).join('\n').trim();

export const getProfileDraft = (candidate: CandidateScreeningCandidate): ProfileDraft => ({
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

export const getInitialData = (candidate: CandidateScreeningCandidate): ScreeningData => {
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

export const getMissingProfileFields = (candidate: CandidateScreeningCandidate) =>
  CORE_PROFILE_FIELDS.filter((field) => field.isMissing(candidate));

export const importantMissingFields = (draft: ProfileDraft, availability?: ScreeningData['availability']) => {
  const missing: string[] = [];
  if (!draft.phone && !draft.phone_nl) missing.push('telefoonnummer');
  if (!draft.email) missing.push('e-mailadres');
  if (!draft.date_of_birth) missing.push('geboortedatum');
  if (!draft.nationality) missing.push('nationaliteit');
  if (draft.skills.length === 0) missing.push('vaardigheden');
  if (!availability?.available_from) missing.push('beschikbaar vanaf');
  return missing;
};

export const askedCount = (data: ScreeningData) =>
  Object.values(data.answers).filter((answer) => answer.asked || answer.notes.trim()).length;

export const buildSnapshot = (data: ScreeningData, profile: ProfileDraft) => JSON.stringify({ data, profile });

const uniqueStrings = (values: unknown[]): string[] => [
  ...new Set(values.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean)),
];

export const aiLanguageLabel = (item: any): string => {
  if (typeof item === 'string') return item.trim();
  const taal = String(item?.taal ?? '').trim();
  if (!taal) return '';
  const niveau = item?.niveau && item.niveau !== 'onbekend' ? ` - ${item.niveau}` : '';
  return `${taal}${niveau}`;
};

export const getAiProfileSuggestions = (candidate: CandidateScreeningCandidate): Pick<ProfileDraft, 'skills' | 'languages' | 'certifications'> => {
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

/**
 * De AI krijgt het dossier gepseudonimiseerd binnen (AVG): naam, e-mail, NL-telefoon,
 * BSN en IBAN zijn vervangen door [KANDIDAAT], [EMAIL], [TELEFOON], [BSN], [IBAN].
 * Die tokens komen dus terug in `ai_analysis` en mogen nooit als suggestie worden
 * aangeboden of in het profiel belanden — anders staat er letterlijk "[TELEFOON]"
 * in het telefoonveld van de kandidaat.
 *
 * We controleren op *bevatten*, niet op gelijkheid: een gedeeltelijk gemaskeerde
 * waarde als "t.[KANDIDAAT]@example.com" is net zo onbruikbaar.
 */
const PSEUDONYM_PLACEHOLDERS = ['[KANDIDAAT]', '[EMAIL]', '[TELEFOON]', '[BSN]', '[IBAN]'];

export const containsPseudonymPlaceholder = (value: unknown): boolean =>
  typeof value === 'string' && PSEUDONYM_PLACEHOLDERS.some((token) => value.includes(token));

const stripPlaceholder = (value: string) => (containsPseudonymPlaceholder(value) ? '' : value);

const normalizeCompare = (value: unknown) =>
  clean(value).toLowerCase().replace(/\s+/g, ' ');

export const displayList = (values: string[]) => values.length > 0 ? values.join(', ') : 'Nog leeg';

export const aiSkillLabel = (item: any): string => {
  if (typeof item === 'string') return item.trim();
  return clean(item?.vaardigheid ?? item?.naam ?? item?.label);
};

export const aiCertLabel = (item: any): string => {
  if (typeof item === 'string') return item.trim();
  return clean(item?.naam);
};

const uniqueCleanStrings = (values: unknown[]): string[] => [
  ...new Set(values.map(clean).filter((v) => Boolean(v) && !containsPseudonymPlaceholder(v))),
];

const isDutchMobileCandidate = (value: string) => /^(?:\+31|0031|0)\s*6/.test(value.replace(/[()\-.]/g, ' ').trim());

export const getAiProfileDiffs = (candidate: CandidateScreeningCandidate, draft: ProfileDraft): ProfileSuggestion[] => {
  const analysis = candidate.ai_analysis as any;
  const personalia = analysis?.personalia ?? {};
  const suggestions = getAiProfileSuggestions(candidate);
  const diffs: ProfileSuggestion[] = [];

  const addText = (key: keyof ProfileDraft, label: string, suggestedRaw: unknown) => {
    const suggested = clean(suggestedRaw);
    if (!suggested || containsPseudonymPlaceholder(suggested)) return;
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

export const aiWorkFunctions = (analysis: any): string[] => uniqueCleanStrings([
  ...(analysis?.doelgroep?.functies ?? []),
  ...(analysis?.werkhistorie?.werkgevers ?? []).map((w: any) => w?.functie),
]).slice(0, 8);

export const aiHardSkillLabels = (analysis: any): string[] =>
  uniqueCleanStrings((analysis?.competenties?.hard_skills ?? []).map(aiSkillLabel)).slice(0, 12);

export const aiLanguageLabels = (analysis: any): string[] =>
  uniqueCleanStrings((analysis?.competenties?.talen ?? []).map(aiLanguageLabel)).slice(0, 8);

export const aiCertLabels = (analysis: any): string[] =>
  uniqueCleanStrings((analysis?.competenties?.certificaten ?? []).map(aiCertLabel)).slice(0, 8);

export const workDurationMonths = (entry: any): number | null => {
  const raw = Number(entry?.duur_maanden);
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
};

export const formatWorkDuration = (months: number | null) => {
  if (!months) return 'Duur onbekend';
  if (months < 12) return `${months} mnd`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (rest === 0) return `${years} jaar`;
  return `${years}j ${rest}m`;
};

/**
 * Kleurschaal van de werkhistorie: de kleur zegt hoe láng iemand ergens bleef,
 * niet welke baan het is. Drie dienstverbanden van 2+ jaar krijgen dus dezelfde
 * kleur — dat is de bedoeling (stabiliteitssignaal), maar het vraagt wel om een
 * legenda, anders leest een recruiter de kleur als een categorie.
 *
 * Eén bron voor drempel, label, balkkleur en badgekleur, zodat de legenda niet
 * uit de pas kan lopen met wat er getekend wordt.
 */
export interface DurationBand {
  /** Ondergrens in maanden (inclusief). */
  minMonths: number;
  label: string;
  railClass: string;
  toneClass: string;
}

export const DURATION_BANDS: DurationBand[] = [
  { minMonths: 24, label: '2 jaar of langer', railClass: 'bg-stat-green', toneClass: 'bg-stat-green/10 text-stat-green border-0' },
  { minMonths: 12, label: '1 tot 2 jaar', railClass: 'bg-blue-500', toneClass: 'bg-blue-100 text-blue-700 border-0' },
  { minMonths: 6, label: '6 tot 12 maanden', railClass: 'bg-amber-500', toneClass: 'bg-amber-100 text-amber-800 border-0' },
  { minMonths: 0, label: 'korter dan 6 maanden', railClass: 'bg-red-500', toneClass: 'bg-red-100 text-red-700 border-0' },
];

export const durationBand = (months: number | null): DurationBand | null =>
  months ? DURATION_BANDS.find((band) => months >= band.minMonths) ?? null : null;

export const durationToneClass = (months: number | null) =>
  durationBand(months)?.toneClass ?? 'bg-muted text-muted-foreground border-0';

export const durationRailClass = (months: number | null) =>
  durationBand(months)?.railClass ?? 'bg-muted-foreground/30';

export const buildScreeningNoteContent = (data: ScreeningData): string => {
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

/**
 * Bewaart een bestaande waarde wanneer het concept leeg is.
 *
 * Contactgegevens zijn het enige kanaal naar een kandidaat; ze stil kwijtraken is
 * duurder dan ze niet vanaf dit tabblad kunnen legen. Een leeg conceptveld (nog niet
 * geladen, of per ongeluk gewist) mag daarom nooit een gevuld telefoonnummer of
 * e-mailadres op `null` zetten. Legen kan wel via het kandidaatprofiel zelf.
 */
const keepIfBlank = (next: string | null, current: unknown): string | null => {
  if (next) return next;
  return typeof current === 'string' && current.trim() ? current : null;
};

export const buildCandidateScreeningProfilePayload = (
  draft: ProfileDraft,
  availability: ScreeningData['availability'],
  current?: CandidateScreeningCandidate | null,
) => {
  const phones = mergeCandidatePhoneFields({ phone: draft.phone, phone_nl: draft.phone_nl });
  return {
    phone: keepIfBlank(stripPlaceholder(phones.phone) || null, current?.phone),
    phone_nl: keepIfBlank(stripPlaceholder(phones.phone_nl) || null, current?.phone_nl),
    email: keepIfBlank(stripPlaceholder(draft.email.trim()) || null, current?.email),
    date_of_birth: draft.date_of_birth || null,
    nationality: stripPlaceholder(draft.nationality.trim()) || null,
    address_street: draft.address_street.trim() || null,
    address_postal: draft.address_postal.trim() || null,
    address_city: stripPlaceholder(draft.address_city.trim()) || null,
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
};

export function prepareCandidateScreeningSave({
  candidate,
  data,
  profileDraft,
  complete = false,
  userId = null,
  timestamp = new Date().toISOString(),
}: {
  candidate: CandidateScreeningCandidate;
  data: ScreeningData;
  profileDraft: ProfileDraft;
  complete?: boolean;
  userId?: string | null;
  timestamp?: string;
}) {
  const screeningStatus: ScreeningStatus = complete
    ? (data.result === 'afgekeurd' ? 'afgekeurd' : 'afgerond')
    : data.status === 'niet_gestart'
      ? 'niet_gestart'
      : data.status === 'afgerond' || data.status === 'afgekeurd'
        ? data.status
        : 'concept_opgeslagen';
  const screeningData: ScreeningData = {
    ...data,
    status: screeningStatus,
    updated_at: timestamp,
    completed_at: complete ? timestamp : data.completed_at ?? null,
    completed_by: complete ? userId ?? null : data.completed_by ?? null,
  };
  const updates: Record<string, unknown> = {
    ...buildCandidateScreeningProfilePayload(profileDraft, screeningData.availability, candidate),
    screening_data: screeningData as any,
  };

  if (data.status !== 'niet_gestart' && !candidate.screened_at && candidate.status !== 'werkzoekend' && candidate.status !== 'geplaatst') {
    updates.status = complete
      ? (data.result === 'goedgekeurd' ? 'werkzoekend' : 'afgewezen')
      : 'in_screening';
  } else if (complete && data.result === 'goedgekeurd' && !candidate.screened_at) {
    updates.status = 'werkzoekend';
  } else if (complete && data.result === 'afgekeurd' && !candidate.screened_at) {
    updates.status = 'afgewezen';
  }

  if (complete) {
    updates.screened_at = timestamp;
    updates.screened_by = userId ?? null;
  }

  const completionNote: CandidateScreeningCompletionNote | null = complete && userId
    ? {
        body: buildScreeningNoteContent(screeningData),
        is_internal: true,
        related_entity_id: candidate.id,
        related_entity_type: 'kandidaat',
        created_by: userId,
        organization_id: candidate.organization_id,
      }
    : null;

  return { screeningData, updates, completionNote, savedAt: timestamp };
}

export async function saveCandidateScreening({
  ports,
  candidate,
  data,
  profileDraft,
  complete = false,
  userId = null,
  timestamp,
}: {
  ports: CandidateScreeningSavePorts;
  candidate: CandidateScreeningCandidate;
  data: ScreeningData;
  profileDraft: ProfileDraft;
  complete?: boolean;
  userId?: string | null;
  timestamp?: string;
}) {
  const prepared = prepareCandidateScreeningSave({ candidate, data, profileDraft, complete, userId, timestamp });
  await ports.updateCandidate(candidate.id, prepared.updates);

  let completionNoteCreated = false;
  let completionNoteError: unknown = null;
  if (prepared.completionNote && ports.insertCompletionNote) {
    try {
      await ports.insertCompletionNote(prepared.completionNote);
      completionNoteCreated = true;
    } catch (error) {
      completionNoteError = error;
    }
  }

  return { ...prepared, completionNoteCreated, completionNoteError };
}

export function getCandidateScreeningOpenItems(
  data: ScreeningData,
  missingProfileFields: Array<{ label: string }>,
): string[] {
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
}

export function buildCandidateScreeningFollowupTask({
  candidate,
  userId = null,
  openItems,
}: {
  candidate: CandidateScreeningCandidate;
  userId?: string | null;
  openItems: string[];
}): CandidateScreeningFollowupTask {
  return {
    organization_id: candidate.organization_id,
    assigned_to: userId ?? null,
    title: `Screening opvolgen: ${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim(),
    description: openItems.length > 0
      ? `Openstaande screeningpunten:\n${openItems.map((item) => `- ${item}`).join('\n')}`
      : 'Geen openstaande screeningpunten gevonden; controleer de samenvatting.',
    priority: openItems.length >= 6 ? 'high' : 'medium',
    category: 'opvolging',
    status: 'open',
    related_entity_type: 'kandidaat',
    related_entity_id: candidate.id,
    ai_generated: false,
  };
}

export async function createCandidateScreeningFollowupTask({
  ports,
  candidate,
  userId = null,
  openItems,
}: {
  ports: CandidateScreeningFollowupTaskPorts;
  candidate: CandidateScreeningCandidate;
  userId?: string | null;
  openItems: string[];
}) {
  const task = buildCandidateScreeningFollowupTask({ candidate, userId, openItems });
  await ports.insertFollowupTask(task);
  return task;
}

export function validateCandidateScreeningCompletion(data: ScreeningData, profileDraft: ProfileDraft) {
  const missing = importantMissingFields(profileDraft, data.availability);
  if (data.result === 'niet_gescreend') {
    return { ok: false as const, message: 'Kies eerst goedgekeurd of afgekeurd' };
  }
  if (data.summary.trim().length < 10) {
    return { ok: false as const, message: 'Vul een korte samenvatting in' };
  }
  if (missing.length > 0 && !data.answers.critical_unknowns?.notes?.trim()) {
    return {
      ok: false as const,
      message: `Leg bij Besluit vast waarom ontbrekend akkoord is: ${missing.join(', ')}`,
      focusStep: 'besluit',
    };
  }
  return { ok: true as const };
}

export const patchCandidateScreeningAnswer = (
  data: ScreeningData,
  key: string,
  patch: Partial<ScreeningAnswer>,
): ScreeningData => ({
  ...data,
  answers: {
    ...data.answers,
    [key]: { ...(data.answers[key] ?? { asked: false, notes: '' }), ...patch },
  },
});

export const patchCandidateScreeningProfessional = (
  data: ScreeningData,
  patch: Partial<ScreeningData['professional']>,
): ScreeningData => ({
  ...data,
  professional: { ...data.professional, ...patch },
});

export const patchCandidateScreeningPersonal = (
  data: ScreeningData,
  patch: Partial<ScreeningData['personal']>,
): ScreeningData => ({
  ...data,
  personal: { ...data.personal, ...patch },
});

export const startCandidateScreeningCall = (data: ScreeningData): ScreeningData => ({
  ...data,
  status: 'in_gesprek',
  current_step: data.current_step || 'voorbereiding',
});

export const goToCandidateScreeningStep = (data: ScreeningData, stepId: string): ScreeningData => ({
  ...data,
  current_step: stepId,
  status: data.status === 'niet_gestart' ? 'in_gesprek' : data.status,
});

export const applyCandidateScreeningAiSuggestion = (profileDraft: ProfileDraft, suggestion: ProfileSuggestion): ProfileDraft => ({
  ...profileDraft,
  [suggestion.key]: suggestion.kind === 'list' ? suggestion.suggested : suggestion.suggested,
});

export async function saveCandidateScreeningSensitiveField({
  ports,
  candidateId,
  field,
  value,
}: {
  ports: CandidateScreeningSensitivePorts;
  candidateId: string;
  field: SensitiveCandidateField;
  value: string | null;
}) {
  await ports.updateSensitiveField(candidateId, field, value);
  return { auditValues: { [field]: '***' } as Record<string, string> };
}

export async function waitForCandidateAnalysisSlot({
  ports,
  candidateId,
  timeoutMs = 180_000,
  intervalMs = 3_000,
}: {
  ports: CandidateScreeningReanalysisPorts;
  candidateId: string;
  timeoutMs?: number;
  intervalMs?: number;
}) {
  const now = ports.now ?? (() => Date.now());
  const sleep = ports.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const status = await ports.getCandidateAiStatus(candidateId);
    if (status !== 'analyzing') return;
    await sleep(intervalMs);
  }
  throw new Error('Er loopt nog een AI-analyse. Probeer over enkele minuten opnieuw.');
}

export async function startCandidateScreeningReanalysis({
  ports,
  candidateId,
}: {
  ports: CandidateScreeningReanalysisPorts;
  candidateId: string;
}) {
  await waitForCandidateAnalysisSlot({ ports, candidateId });
  try {
    await ports.startCandidateAnalysis(candidateId);
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes('analyse loopt al')) throw error;
  }

  await waitForCandidateAnalysisSlot({ ports, candidateId });
  await ports.startCandidateAnalysis(candidateId);
}

export function normalizeGeneratedCallQuestionsResponse(payload: unknown): GeneratedCallQuestionsResult {
  const data = (payload ?? {}) as any;
  if (data.error) throw new Error(String(data.error));
  return {
    questions: Array.isArray(data.questions) ? data.questions as string[] : [],
    costCents: typeof data.cost_cents === 'number' ? data.cost_cents : undefined,
    balanceCents: typeof data.balance_cents === 'number' ? data.balance_cents : undefined,
  };
}

function valueAfterColon(message: string): string {
  const idx = message.indexOf(':');
  return idx >= 0 ? message.slice(idx + 1).trim() : '';
}

export function deriveCandidateScreeningCallQuestions(breakdown: MatchBreakdown | null | undefined): string[] {
  if (!breakdown) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (q: string) => {
    const key = q.toLowerCase();
    if (q && !seen.has(key)) {
      seen.add(key);
      out.push(q);
    }
  };

  for (const gap of breakdown.missing ?? []) {
    const lower = gap.toLowerCase();
    if (lower.startsWith('ontbrekende vaardigheden')) {
      const skills = valueAfterColon(gap);
      if (skills) push(`Het CV bevestigt niet: ${skills}. Vraag naar concrete ervaring (waar, hoe lang, welke taken).`);
    } else if (lower.startsWith('ontbrekende certificaten')) {
      const certs = valueAfterColon(gap);
      if (certs) push(`Vereist certificaat ontbreekt: ${certs}. Vraag of de kandidaat dit geldig heeft.`);
    } else if (lower.includes('rijbewijs')) {
      push('Rijbewijs/eigen vervoer is vereist maar niet geregistreerd — vraag welk rijbewijs en of er vervoer is.');
    } else if (lower.includes('afstand')) {
      push('Reisafstand is onbekend — vraag woonplaats/postcode en of reizen naar de werklocatie lukt.');
    } else if (lower.includes('beschikbaar')) {
      push('Beschikbaarheid is onduidelijk — vraag vanaf wanneer en hoeveel uur de kandidaat kan werken.');
    } else {
      push(`Te verifiëren: ${gap}`);
    }
  }

  for (const block of breakdown.hardBlocks ?? []) {
    push(`Aandachtspunt (harde eis): ${block} — bespreek of dit echt een blokker is.`);
  }

  return out;
}
