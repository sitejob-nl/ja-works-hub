// Frontend-spiegel van de 16 recruitervragen uit de masterprompt. De sleutels zijn
// identiek aan `_shared/vacancy-generate.ts → VACANCY_ANSWER_FIELDS` in de edge function,
// zodat het formulier 1-op-1 op de generator aansluit.

export interface VacancyAnswerField {
  key: string;
  label: string;
  internal?: boolean; // alleen interne context — nooit gepubliceerd
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
}

export const VACANCY_ANSWER_FIELDS: VacancyAnswerField[] = [
  { key: 'functietitel', label: 'Functietitel', placeholder: 'Bijv. CNC Frezer' },
  { key: 'plaats', label: 'Plaats of regio', placeholder: 'Bijv. Eindhoven' },
  { key: 'sector', label: 'Sector', placeholder: 'metaal, techniek, productie, logistiek, bouw, food…' },
  { key: 'opdrachtgever_naam', label: 'Opdrachtgever (naam)', internal: true, hint: 'Alleen interne context — wordt nooit in de vacaturetekst genoemd.' },
  { key: 'opdrachtgever_web_kvk', label: 'Website / bedrijfsnaam / KvK', internal: true, hint: 'Alleen interne context — wordt nooit gepubliceerd.' },
  { key: 'werkzaamheden', label: 'Belangrijkste werkzaamheden', multiline: true },
  { key: 'machines_materialen', label: 'Machines, materialen, gereedschappen, voertuigen of systemen', multiline: true },
  { key: 'werkweek', label: 'Werkweek', placeholder: 'uren, dagdienst/ploegendienst, weekend, overwerk' },
  { key: 'salaris_uur', label: 'Salaris per uur', placeholder: 'Bijv. €17 – €20 (zonder bruto/netto)' },
  { key: 'toeslagen_vergoedingen', label: 'Toeslagen / reiskosten / vergoedingen', multiline: true },
  { key: 'huisvesting_vervoer', label: 'Huisvesting of vervoer via JA Werkt', placeholder: 'Bijv. huisvesting mogelijk; vervoer n.v.t.' },
  { key: 'dienstverband', label: 'Tijdelijk, langdurig of kans op overname' },
  { key: 'harde_eisen', label: 'Harde eisen', multiline: true },
  { key: 'taaleisen', label: 'Taaleisen', placeholder: 'Bijv. Nederlands of Engels voldoende' },
  { key: 'certificaten_rijbewijzen', label: 'Certificaten, rijbewijzen of diploma’s', multiline: true },
  { key: 'zware_kanten', label: 'Zware, minder leuke of realistische kanten van het werk', multiline: true },
];

export type VacancyAnswers = Record<string, string>;

// ---------------------------------------------------------------------------
// Mapping van vrije AI-termen (harde criteria / zoekwoorden) → org-skillcatalogus.
// Token-gebaseerd met stopwoorden en prefix-matching, zodat woordvarianten matchen
// ("technische tekening lezen" → "Technisch tekening lezen", "2-ploegendienst" →
// "Ploegendiensten") zonder ruwe AI-termen door te laten: het resultaat bevat
// uitsluitend bestaande catalogus-schrijfwijzen. De recruiter controleert de
// selectie altijd nog in een catalogus-gebonden picker.
// ---------------------------------------------------------------------------

const normalizeMatchTerm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Nederlandse voorzetsel-/vulwoorden die geen skill-betekenis dragen.
const SKILL_STOPWORDS = new Set([
  'de', 'het', 'een', 'en', 'of', 'in', 'op', 'met', 'van', 'voor', 'naar', 'bij',
  'werken', 'kunnen', 'ervaring', 'als', 'is', 'zijn', 'je', 'jij',
]);

const tokenizeSkill = (s: string): string[] =>
  normalizeMatchTerm(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !SKILL_STOPWORDS.has(t));

// Twee tokens matchen bij gelijkheid, of via prefix wanneer beide lang genoeg zijn
// ("technisch" ↔ "technische", "ploegendienst" ↔ "ploegendiensten").
const tokensMatch = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5) return a.startsWith(b) || b.startsWith(a);
  return false;
};

/** Map vrije AI-termen op de skillcatalogus. Een catalogus-skill matcht wanneer
 *  ál zijn betekenisvolle tokens terugkomen in de termen (of via hele-zin-substring).
 *  Retourneert unieke catalogus-schrijfwijzen. */
export function mapTermsToCatalog(terms: string[], catalog: string[]): string[] {
  const termTokens = new Set<string>();
  const normTerms: string[] = [];
  for (const term of terms) {
    const n = normalizeMatchTerm(String(term ?? ''));
    if (!n) continue;
    normTerms.push(n);
    for (const t of tokenizeSkill(n)) termTokens.add(t);
  }
  if (normTerms.length === 0) return [];

  const matched = new Set<string>();
  for (const name of catalog) {
    const nName = normalizeMatchTerm(name);
    if (!nName) continue;
    // 1. Hele-zin-substring (in beide richtingen) — de strengste, oude route.
    if (normTerms.some((t) => t.includes(nName) || nName.includes(t))) {
      matched.add(name);
      continue;
    }
    // 2. Token-dekking: alle betekenisvolle catalogus-tokens komen voor in de termen.
    const nameTokens = tokenizeSkill(nName);
    if (nameTokens.length === 0) continue;
    const covered = nameTokens.every((nt) => [...termTokens].some((tt) => tokensMatch(nt, tt)));
    if (covered) matched.add(name);
  }
  return [...matched];
}

interface PrefillVacancy {
  title?: string | null;
  location?: string | null;
  description?: string | null;
  hourly_rate?: number | null;
  salary_min?: number | null;
  salary_max?: number | null;
  required_skills?: string[] | null;
  required_certifications?: string[] | null;
  requires_drivers_license?: boolean | null;
}

interface PrefillCompany {
  name?: string | null;
  website?: string | null;
  kvk_number?: string | null;
  cao?: string | null;
}

const nl = (n: number) => n.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Vult de 16 antwoorden voor uit de vacature + gekoppelde opdrachtgever. Wat niet
// automatisch af te leiden is (werktijden, toeslagen, huisvesting, taaleisen, zware
// kanten) blijft leeg zodat de recruiter het aanvult.
export function buildVacancyPrefill(vacancy: PrefillVacancy, company?: PrefillCompany | null): VacancyAnswers {
  const skills = vacancy.required_skills ?? [];
  const certs = vacancy.required_certifications ?? [];

  const salaris = vacancy.hourly_rate != null
    ? `€${nl(vacancy.hourly_rate)} per uur`
    : (vacancy.salary_min != null && vacancy.salary_max != null)
      ? `€${nl(vacancy.salary_min)} – €${nl(vacancy.salary_max)}`
      : '';

  const web = [company?.website, company?.kvk_number ? `KvK ${company.kvk_number}` : '']
    .filter(Boolean)
    .join(' · ');

  const certLine = [...certs, vacancy.requires_drivers_license ? 'rijbewijs vereist' : '']
    .filter(Boolean)
    .join(', ');

  return {
    functietitel: vacancy.title ?? '',
    plaats: vacancy.location ?? '',
    sector: '',
    opdrachtgever_naam: company?.name ?? '',
    opdrachtgever_web_kvk: web,
    werkzaamheden: vacancy.description ?? '',
    machines_materialen: '',
    werkweek: '',
    salaris_uur: salaris,
    toeslagen_vergoedingen: company?.cao ? `Cao: ${company.cao}` : '',
    huisvesting_vervoer: '',
    dienstverband: '',
    harde_eisen: [...skills, ...certs].join(', '),
    taaleisen: '',
    certificaten_rijbewijzen: certLine,
    zware_kanten: '',
  };
}
