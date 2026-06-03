// Frontend skill-normalisatie + match-types.
//
// LET OP: de SCORING-logica leeft niet meer hier maar in de gedeelde, server-side kern
// `supabase/functions/_shared/matching-core.ts` (gebruikt door calculate-match en
// rank-candidates). De frontend scoort niet langer client-side; de vacature-shortlist komt
// van de `rank-candidates` edge function. Dit bestand houdt alleen de normalisatie-helper
// (voor o.a. SkillCatalogSettings) + de gedeelde types over.
//
// De alias-lijst hieronder is bewust een spiegel van die in matching-core.ts. Houd ze gelijk;
// de canonieke org-aliassen leven in de `skill_aliases`-tabel en sturen de echte matching aan.

export type MatchDistance = {
  km?: number | null;
  distanceKm?: number | null;
  durationMin?: number | null;
  status?: 'ok' | 'estimated' | 'missing_coords' | 'provider_error' | 'unknown' | string | null;
};

export type MatchBreakdown = {
  matchPercent: number;
  candidateQuality?: number | null;
  label: 'groen' | 'oranje' | 'rood';
  hardBlocks: string[];
  positives: string[];
  missing: string[];
  bonuses?: string[];
  skillMatches: string[];
  certificationMatches: string[];
  distance: MatchDistance;
  componentScores: Record<string, number>;
  reasoning: string;
};

const SKILL_ALIAS_ENTRIES: Array<[string, string]> = [
  ['mig', 'mig mag lassen'], ['mag', 'mig mag lassen'], ['migmag', 'mig mag lassen'],
  ['mig mag', 'mig mag lassen'], ['mig mag lasser', 'mig mag lassen'], ['mig-mag', 'mig mag lassen'],
  ['mig-mag lasser', 'mig mag lassen'], ['mig/mag', 'mig mag lassen'], ['mig/mag lasser', 'mig mag lassen'],
  ['migmag lassen', 'mig mag lassen'], ['lassen mig mag', 'mig mag lassen'],
  ['co2 lasser', 'mig mag lassen'], ['co2 lassen', 'mig mag lassen'],
  ['tig lasser', 'tig lassen'], ['tig welding', 'tig lassen'],
  ['heftruck chauffeur', 'heftruck'], ['heftruck rijden', 'heftruck'], ['heftruck bestuurder', 'heftruck'],
  ['heftruck certificaat', 'heftruck'], ['heftruck certificatie', 'heftruck'], ['heftruckchauffeur', 'heftruck'],
  ['heftruckcertificaat', 'heftruck'], ['heftruckcertificatie', 'heftruck'],
  ['forklift', 'heftruck'], ['forklift driver', 'heftruck'], ['forklift operator', 'heftruck'],
  ['reachtruck chauffeur', 'reachtruck'], ['reachtruck rijden', 'reachtruck'], ['reachtruck certificaat', 'reachtruck'],
  ['reachtruckchauffeur', 'reachtruck'], ['reachtruckcertificaat', 'reachtruck'], ['reach truck', 'reachtruck'],
  ['electro pallet truck', 'ept'], ['elektrische pallet truck', 'ept'], ['elektrische pallettruck', 'ept'],
  ['pompwagen elektrisch', 'ept'],
  ['order picking', 'orderpicken'], ['order picken', 'orderpicken'], ['orderpicker', 'orderpicken'],
  ['orders picken', 'orderpicken'],
  ['productie medewerker', 'productiewerk'], ['productiemedewerker', 'productiewerk'], ['productie werk', 'productiewerk'],
  ['productiekracht', 'productiewerk'], ['production worker', 'productiewerk'], ['productie', 'productiewerk'],
  ['inpakker', 'inpakken'], ['inpakwerk', 'inpakken'], ['packer', 'inpakken'], ['packing', 'inpakken'],
  ['verpakken', 'inpakken'],
  ['qc', 'kwaliteitscontrole'], ['quality control', 'kwaliteitscontrole'], ['kwaliteits controle', 'kwaliteitscontrole'],
  ['controle kwaliteit', 'kwaliteitscontrole'],
  ['scannen', 'scanner werken'], ['scanner', 'scanner werken'], ['scannerwerk', 'scanner werken'],
  ['handscanner', 'scanner werken'], ['rf scanner', 'scanner werken'], ['rf-scanner', 'scanner werken'],
  ['tekening lezen', 'technische tekening lezen'], ['technische tekeningen lezen', 'technische tekening lezen'],
  ['technisch tekening lezen', 'technische tekening lezen'], ['technical drawing', 'technische tekening lezen'],
  ['blueprint reading', 'technische tekening lezen'],
  ['vca basis', 'vca'], ['vca vol', 'vca'], ['vca certificaat', 'vca'], ['vca diploma', 'vca'],
  ['basisveiligheid vca', 'vca'], ['veiligheid checklist aannemers', 'vca'],
  ['haccp certificaat', 'haccp'], ['haccp diploma', 'haccp'], ['food safety', 'haccp'], ['voedselveiligheid', 'haccp'],
  ['schoonmaak', 'schoonmaken'], ['schoonmaker', 'schoonmaken'], ['cleaning', 'schoonmaken'], ['cleaner', 'schoonmaken'],
];

const normalizeAliasKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const SKILL_ALIASES: Record<string, string> = Object.fromEntries(
  SKILL_ALIAS_ENTRIES.map(([alias, canonical]) => [normalizeAliasKey(alias), normalizeAliasKey(canonical)]),
);

export const normalizeSkillName = (value: string) => {
  const normalized = normalizeAliasKey(value);
  return SKILL_ALIASES[normalized] ?? normalized;
};
