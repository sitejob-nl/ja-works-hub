export const PROPOSAL_PAGE_SECTION_KEYS = [
  'summary',
  'skills',
  'certifications',
  'languages',
  'targetFunctions',
  'availability',
  'positiveSignals',
  'riskFactors',
  'history',
  'cv',
  'contact',
] as const;

export type ProposalPageSectionKey = typeof PROPOSAL_PAGE_SECTION_KEYS[number];

export type ProposalPageSectionContent = {
  title: string;
  body: string;
};

export type ProposalPageConfig = {
  title: string;
  intro: string;
  sections: Record<ProposalPageSectionKey, boolean>;
  content: Record<ProposalPageSectionKey, ProposalPageSectionContent>;
};

export const PROPOSAL_PAGE_SECTION_META: Array<{
  key: ProposalPageSectionKey;
  label: string;
  description: string;
  contentKind: 'text' | 'list' | 'supporting';
}> = [
  { key: 'summary', label: 'Samenvatting', description: 'Korte, gerichte introductie van de kandidaat.', contentKind: 'text' },
  { key: 'skills', label: 'Vaardigheden', description: 'Eén vaardigheid per regel.', contentKind: 'list' },
  { key: 'certifications', label: 'Certificaten', description: 'Eén certificaat per regel.', contentKind: 'list' },
  { key: 'languages', label: 'Talen', description: 'Eén taal per regel.', contentKind: 'list' },
  { key: 'targetFunctions', label: 'Passende functies', description: 'Eén passende functie per regel.', contentKind: 'list' },
  { key: 'availability', label: 'Beschikbaarheid', description: 'Vrije toelichting op beschikbaarheid en mobiliteit.', contentKind: 'text' },
  { key: 'positiveSignals', label: 'Sterke punten', description: 'Eén sterk punt per regel.', contentKind: 'list' },
  { key: 'riskFactors', label: 'Aandachtspunten', description: 'Standaard verborgen; één punt per regel.', contentKind: 'list' },
  { key: 'history', label: 'Werkervaring', description: 'Toelichting boven de vastgelegde werkhistorie.', contentKind: 'supporting' },
  { key: 'cv', label: 'CV', description: 'Toelichting bij het CV dat de opdrachtgever kan bekijken.', contentKind: 'supporting' },
  { key: 'contact', label: 'Contact', description: 'Toelichting bij de contactgegevens van de recruiter.', contentKind: 'supporting' },
];

const DEFAULT_TITLES: Record<ProposalPageSectionKey, string> = {
  summary: 'Samenvatting',
  skills: 'Vaardigheden',
  certifications: 'Certificaten',
  languages: 'Talen',
  targetFunctions: 'Passende functies',
  availability: 'Beschikbaarheid',
  positiveSignals: 'Sterke punten',
  riskFactors: 'Aandachtspunten',
  history: 'Werkervaring',
  cv: 'CV',
  contact: 'Vragen over deze kandidaat?',
};

export const DEFAULT_PROPOSAL_PAGE_CONFIG: ProposalPageConfig = {
  title: 'Kandidaatvoorstel',
  intro: 'Bekijk hieronder het profiel en geef aan welke vervolgstap u wilt nemen.',
  sections: {
    summary: true,
    skills: true,
    certifications: true,
    languages: true,
    targetFunctions: true,
    availability: true,
    positiveSignals: true,
    riskFactors: false,
    history: true,
    cv: true,
    contact: true,
  },
  content: Object.fromEntries(
    PROPOSAL_PAGE_SECTION_KEYS.map((key) => [key, { title: DEFAULT_TITLES[key], body: '' }]),
  ) as Record<ProposalPageSectionKey, ProposalPageSectionContent>,
};

export function mergeProposalPageConfig(value: unknown): ProposalPageConfig {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<ProposalPageConfig>
    : {};
  const rawSections = raw.sections && typeof raw.sections === 'object' ? raw.sections : {};
  const rawContent = raw.content && typeof raw.content === 'object' ? raw.content : {};

  return {
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : DEFAULT_PROPOSAL_PAGE_CONFIG.title,
    intro: typeof raw.intro === 'string' && raw.intro.trim() ? raw.intro : DEFAULT_PROPOSAL_PAGE_CONFIG.intro,
    sections: Object.fromEntries(
      PROPOSAL_PAGE_SECTION_KEYS.map((key) => [
        key,
        typeof rawSections[key] === 'boolean' ? rawSections[key] : DEFAULT_PROPOSAL_PAGE_CONFIG.sections[key],
      ]),
    ) as Record<ProposalPageSectionKey, boolean>,
    content: Object.fromEntries(
      PROPOSAL_PAGE_SECTION_KEYS.map((key) => {
        const item = rawContent[key];
        return [key, {
          title: typeof item?.title === 'string' && item.title.trim()
            ? item.title
            : DEFAULT_PROPOSAL_PAGE_CONFIG.content[key].title,
          body: typeof item?.body === 'string' ? item.body : '',
        }];
      }),
    ) as Record<ProposalPageSectionKey, ProposalPageSectionContent>,
  };
}

export function proposalListFromText(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n|;/)
    .map((item) => item.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
}
