type MatchInput = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  status?: string | null;
  skills?: string[] | null;
  canonical_skills?: string[] | null;
  certifications?: string[] | null;
  has_drivers_license?: boolean | null;
  address_city?: string | null;
  availability_notes?: string | null;
  ai_function_group?: string | null;
  ai_target_functions?: string[] | null;
  ai_reliability_score?: number | null;
};

type VacancyInput = {
  title?: string | null;
  location?: string | null;
  required_skills?: string[] | null;
  canonical_required_skills?: string[] | null;
  required_certifications?: string[] | null;
  requires_drivers_license?: boolean | null;
};

export type MatchDistance = {
  distanceKm?: number | null;
  durationMin?: number | null;
  status?: 'ok' | 'missing_coords' | 'provider_error' | 'unknown' | string | null;
};

export type MatchBreakdown = {
  matchPercent: number;
  label: 'groen' | 'oranje' | 'rood';
  hardBlocks: string[];
  positives: string[];
  missing: string[];
  skillMatches: string[];
  certificationMatches: string[];
  distance: MatchDistance;
  componentScores: {
    skills: number;
    certifications: number;
    functionGroup: number;
    distance: number;
    availability: number;
    reliability: number;
  };
  reasoning: string;
};

const SKILL_ALIAS_ENTRIES: Array<[string, string]> = [
  ['mig', 'mig mag lassen'],
  ['mag', 'mig mag lassen'],
  ['migmag', 'mig mag lassen'],
  ['mig mag', 'mig mag lassen'],
  ['mig mag lasser', 'mig mag lassen'],
  ['mig mag lassen', 'mig mag lassen'],
  ['mig-mag', 'mig mag lassen'],
  ['mig-mag lasser', 'mig mag lassen'],
  ['mig/mag', 'mig mag lassen'],
  ['mig/mag lasser', 'mig mag lassen'],
  ['migmag lassen', 'mig mag lassen'],
  ['lassen mig mag', 'mig mag lassen'],
  ['co2 lasser', 'mig mag lassen'],
  ['co2 lassen', 'mig mag lassen'],
  ['tig lasser', 'tig lassen'],
  ['tig welding', 'tig lassen'],
  ['heftruck chauffeur', 'heftruck'],
  ['heftruck rijden', 'heftruck'],
  ['heftruck bestuurder', 'heftruck'],
  ['heftruck certificaat', 'heftruck'],
  ['heftruck certificatie', 'heftruck'],
  ['heftruckchauffeur', 'heftruck'],
  ['heftruckcertificaat', 'heftruck'],
  ['heftruckcertificatie', 'heftruck'],
  ['forklift', 'heftruck'],
  ['forklift driver', 'heftruck'],
  ['forklift operator', 'heftruck'],
  ['reachtruck chauffeur', 'reachtruck'],
  ['reachtruck rijden', 'reachtruck'],
  ['reachtruck certificaat', 'reachtruck'],
  ['reachtruckchauffeur', 'reachtruck'],
  ['reachtruckcertificaat', 'reachtruck'],
  ['reach truck', 'reachtruck'],
  ['electro pallet truck', 'ept'],
  ['elektrische pallet truck', 'ept'],
  ['elektrische pallettruck', 'ept'],
  ['pompwagen elektrisch', 'ept'],
  ['order picking', 'orderpicken'],
  ['order picken', 'orderpicken'],
  ['orderpicker', 'orderpicken'],
  ['orders picken', 'orderpicken'],
  ['productie medewerker', 'productiewerk'],
  ['productiemedewerker', 'productiewerk'],
  ['productie werk', 'productiewerk'],
  ['productiekracht', 'productiewerk'],
  ['production worker', 'productiewerk'],
  ['inpakker', 'inpakken'],
  ['inpakwerk', 'inpakken'],
  ['packer', 'inpakken'],
  ['packing', 'inpakken'],
  ['verpakken', 'inpakken'],
  ['qc', 'kwaliteitscontrole'],
  ['quality control', 'kwaliteitscontrole'],
  ['kwaliteits controle', 'kwaliteitscontrole'],
  ['controle kwaliteit', 'kwaliteitscontrole'],
  ['scannen', 'scanner werken'],
  ['scanner', 'scanner werken'],
  ['scannerwerk', 'scanner werken'],
  ['handscanner', 'scanner werken'],
  ['rf scanner', 'scanner werken'],
  ['rf-scanner', 'scanner werken'],
  ['tekening lezen', 'technische tekening lezen'],
  ['technische tekeningen lezen', 'technische tekening lezen'],
  ['technisch tekening lezen', 'technische tekening lezen'],
  ['technical drawing', 'technische tekening lezen'],
  ['blueprint reading', 'technische tekening lezen'],
  ['vca basis', 'vca'],
  ['vca vol', 'vca'],
  ['vca certificaat', 'vca'],
  ['vca diploma', 'vca'],
  ['basisveiligheid vca', 'vca'],
  ['veiligheid checklist aannemers', 'vca'],
  ['haccp certificaat', 'haccp'],
  ['haccp diploma', 'haccp'],
  ['food safety', 'haccp'],
  ['voedselveiligheid', 'haccp'],
];

const normalizeAliasKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const SKILL_ALIASES: Record<string, string> = Object.fromEntries(
  SKILL_ALIAS_ENTRIES.map(([alias, canonical]) => [normalizeAliasKey(alias), normalizeAliasKey(canonical)]),
);

export const normalizeSkillName = (value: string) => {
  const normalized = normalizeAliasKey(value);
  return SKILL_ALIASES[normalized] ?? normalized;
};

const asStrings = (values: unknown): string[] =>
  Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0) : [];

const matchRequiredValues = (candidateValues: unknown, requiredValues: unknown) => {
  const candidates = asStrings(candidateValues);
  const normalizedCandidates = new Set(candidates.map(normalizeSkillName));

  return asStrings(requiredValues).filter((required) => normalizedCandidates.has(normalizeSkillName(required)));
};

const missingRequiredValues = (candidateValues: unknown, requiredValues: unknown) => {
  const matches = new Set(matchRequiredValues(candidateValues, requiredValues).map(normalizeSkillName));
  return asStrings(requiredValues).filter((required) => !matches.has(normalizeSkillName(required)));
};

const ratioScore = (matches: number, total: number, weight: number) => {
  if (total === 0) return weight;
  return Math.round((matches / total) * weight);
};

const hasFunctionSignal = (candidate: MatchInput, vacancy: VacancyInput) => {
  const title = normalizeSkillName(vacancy.title ?? '');
  if (!title) return false;

  const signals = [
    candidate.ai_function_group,
    ...(candidate.ai_target_functions ?? []),
    ...(candidate.skills ?? []),
    ...(candidate.canonical_skills ?? []),
  ]
    .filter(Boolean)
    .map((value) => normalizeSkillName(String(value)));

  return signals.some((signal) => signal.length >= 3 && (title.includes(signal) || signal.includes(title)));
};

const reliabilityScore = (candidate: MatchInput) => {
  if (typeof candidate.ai_reliability_score !== 'number') return 5;
  const reliability = candidate.ai_reliability_score <= 10 ? candidate.ai_reliability_score * 10 : candidate.ai_reliability_score;
  if (reliability >= 80) return 10;
  if (reliability >= 60) return 7;
  if (reliability >= 40) return 4;
  return 1;
};

const distanceScore = (distance?: MatchDistance) => {
  if (!distance || distance.status !== 'ok' || typeof distance.durationMin !== 'number') return 6;
  if (distance.durationMin <= 30) return 12;
  if (distance.durationMin <= 45) return 10;
  if (distance.durationMin <= 60) return 7;
  if (distance.durationMin <= 90) return 4;
  return 1;
};

const distanceText = (distance?: MatchDistance) => {
  if (!distance || distance.status !== 'ok' || typeof distance.durationMin !== 'number') return 'Reistijd onbekend';
  const km = typeof distance.distanceKm === 'number' ? `, ${Math.round(distance.distanceKm)} km` : '';
  return `${Math.round(distance.durationMin)} min reistijd${km}`;
};

export function calculateCandidateVacancyMatch(candidate: MatchInput, vacancy: VacancyInput, distance?: MatchDistance): MatchBreakdown {
  const candidateSkills = asStrings(candidate.canonical_skills).length > 0 ? candidate.canonical_skills : candidate.skills;
  const requiredSkills = asStrings(vacancy.canonical_required_skills).length > 0 ? vacancy.canonical_required_skills : vacancy.required_skills;
  const requiredCertifications = asStrings(vacancy.required_certifications);
  const skillMatches = matchRequiredValues(candidateSkills, requiredSkills);
  const certificationMatches = matchRequiredValues(candidate.certifications, requiredCertifications);
  const missingSkills = missingRequiredValues(candidateSkills, requiredSkills);
  const missingCertifications = missingRequiredValues(candidate.certifications, requiredCertifications);
  const hardBlocks: string[] = [];
  const positives: string[] = [];
  const missing: string[] = [];

  if (requiredSkills.length > 0 && skillMatches.length === 0) {
    hardBlocks.push('Geen match op verplichte vaardigheden');
  }
  if (missingCertifications.length > 0) {
    hardBlocks.push(`Mist certificaat: ${missingCertifications.join(', ')}`);
  }
  if (vacancy.requires_drivers_license && !candidate.has_drivers_license) {
    hardBlocks.push('Rijbewijs vereist, maar niet aanwezig');
  }

  if (skillMatches.length > 0) positives.push(`Vaardigheden: ${skillMatches.join(', ')}`);
  if (certificationMatches.length > 0) positives.push(`Certificaten: ${certificationMatches.join(', ')}`);
  if (vacancy.requires_drivers_license && candidate.has_drivers_license) positives.push('Rijbewijs aanwezig');
  if (distance?.status === 'ok' && typeof distance.durationMin === 'number') positives.push(distanceText(distance));
  if (candidate.availability_notes) positives.push('Beschikbaarheid ingevuld');

  if (missingSkills.length > 0) missing.push(`Ontbrekende vaardigheden: ${missingSkills.join(', ')}`);
  if (missingCertifications.length > 0) missing.push(`Ontbrekende certificaten: ${missingCertifications.join(', ')}`);
  if (vacancy.location && distance?.status !== 'ok') missing.push('Reistijd nog controleren');
  if (distance?.status === 'ok' && typeof distance.durationMin === 'number' && distance.durationMin > 60) missing.push(`Lange reistijd: ${distanceText(distance)}`);
  if (!candidate.availability_notes) missing.push('Beschikbaarheid nog controleren');

  const componentScores = {
    skills: ratioScore(skillMatches.length, requiredSkills.length, 35),
    certifications: ratioScore(certificationMatches.length, requiredCertifications.length, 20),
    functionGroup: hasFunctionSignal(candidate, vacancy) ? 15 : 0,
    distance: distanceScore(distance),
    availability: candidate.availability_notes ? 10 : 3,
    reliability: reliabilityScore(candidate),
  };

  const rawScore = Object.values(componentScores).reduce((sum, score) => sum + score, 0);
  const blockedPenalty = hardBlocks.length > 0 ? 20 : 0;
  const matchPercent = Math.max(0, Math.min(100, rawScore - blockedPenalty));
  const label = hardBlocks.length > 0 || matchPercent < 45 ? 'rood' : matchPercent >= 75 ? 'groen' : 'oranje';
  const reasoningParts = [
    `${matchPercent}% match`,
    positives.length ? positives.join('; ') : 'Geen sterke matchsignalen gevonden',
    missing.length ? missing.join('; ') : 'Geen ontbrekende Fase 1-eisen zichtbaar',
    hardBlocks.length ? `Blokkers: ${hardBlocks.join('; ')}` : '',
  ].filter(Boolean);

  return {
    matchPercent,
    label,
    hardBlocks,
    positives,
    missing,
    skillMatches,
    certificationMatches,
    distance: {
      distanceKm: distance?.distanceKm ?? null,
      durationMin: distance?.durationMin ?? null,
      status: distance?.status ?? 'unknown',
    },
    componentScores,
    reasoning: reasoningParts.join('. '),
  };
}

export function shouldShowCandidateForVacancy(
  candidate: MatchInput,
  vacancy: VacancyInput,
  includeWeakMatches = false,
) {
  const score = calculateCandidateVacancyMatch(candidate, vacancy);
  if (includeWeakMatches) return { show: true, score };
  return {
    show: score.hardBlocks.length === 0 && score.matchPercent >= 45,
    score,
  };
}
