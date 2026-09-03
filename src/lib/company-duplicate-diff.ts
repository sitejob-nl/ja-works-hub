/**
 * Vergelijkt de opdrachtgevers binnen een duplicaatgroep en bepaalt wat er te kiezen valt.
 *
 * Spiegelt `duplicate-diff.ts` (kandidaten-dedup) voor `companies`. `find_duplicate_companies`
 * groepeert op KVK-nummer, genormaliseerde bedrijfsnaam of genormaliseerd adres — drie heel
 * verschillende zekerheidsniveaus:
 *
 *  1. Zelfde KVK-nummer: een wettelijk uniek nummer. Dat kan geen toeval zijn, dus deze groep
 *     is altijd samen te voegen, ook als de bedrijfsnamen uiteenlopen (bijv. na een
 *     statutaire naamswijziging).
 *  2. Zelfde bedrijfsnaam: sterk signaal, maar een verschillend KVK-nummer aan beide kanten
 *     betekent twee losse rechtspersonen met toevallig dezelfde naam — dat moet een mens zien.
 *  3. Zelfde adres: net als het gedeelde telefoonnummer bij kandidaten kan dit een
 *     bedrijfsverzamelgebouw of hetzelfde boekhoudkantoor zijn — geen duplicaat. Bij deze
 *     groep telt de naamvergelijking dus wél mee.
 *
 * `merge_company_records` vult lege velden van de overlever aan met die van de verliezer
 * (`coalesce`), dus een veld dat maar aan één kant is ingevuld gaat niet verloren en telt hier
 * niet als verschil. Botsen doen alleen velden die aan beide kanten zijn ingevuld en van
 * elkaar afwijken.
 */

export interface DupCompany {
  company_id: string;
  name?: string | null;
  kvk_number?: string | null;
  address_street?: string | null;
  address_postal?: string | null;
  address_city?: string | null;
  phone?: string | null;
  email?: string | null;
  is_active?: boolean | null;
  created_at?: string;
  [key: string]: unknown;
}

const stripAccents = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Kleine letters, zonder accenten en leestekens, spaties samengetrokken. */
export const normalizeText = (value: unknown): string =>
  stripAccents(String(value ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Alleen de cijfers — voor KVK-nummer en telefoon. */
export const normalizeDigits = (value: unknown): string => String(value ?? '').replace(/\D/g, '');

/** Zonder spaties, hoofdletters — voor IBAN. */
export const normalizeIban = (value: unknown): string => String(value ?? '').replace(/\s+/g, '').toUpperCase();

type Compare = (value: unknown) => string;

export interface DiffField {
  key: string;
  label: string;
  /** Botsing hierop betekent: niet automatisch samenvoegen. */
  blocking?: boolean;
  compare?: Compare;
}

/**
 * KVK-nummer en IBAN zijn de enige veldbotsingen die tegenhouden: twee verschillende
 * KVK-nummers betekent twee losse rechtspersonen, en twee verschillende bankrekeningen kan
 * een factuur naar de verkeerde rekening laten lopen. De rest — adres, telefoon, e-mail —
 * verschilt bij dezelfde opdrachtgever regelmatig gewoon omdat het ene profiel ouder is.
 */
export const DIFF_FIELDS: DiffField[] = [
  { key: 'name', label: 'Bedrijfsnaam', compare: normalizeText },
  { key: 'kvk_number', label: 'KVK-nummer', blocking: true, compare: normalizeDigits },
  { key: 'btw_number', label: 'BTW-nummer', compare: normalizeText },
  { key: 'legal_form', label: 'Rechtsvorm', compare: normalizeText },
  { key: 'address_street', label: 'Straat', compare: normalizeText },
  { key: 'address_postal', label: 'Postcode', compare: normalizeText },
  { key: 'address_city', label: 'Plaats', compare: normalizeText },
  { key: 'phone', label: 'Telefoon', compare: normalizeDigits },
  { key: 'email', label: 'E-mail', compare: normalizeText },
  { key: 'website', label: 'Website', compare: normalizeText },
  { key: 'iban', label: 'IBAN', blocking: true, compare: normalizeIban },
];

export interface FieldDiff {
  key: string;
  label: string;
  blocking: boolean;
  /** Waarde per opdrachtgever-id, in de volgorde van de groep. */
  values: Array<{ companyId: string; display: string; filled: boolean }>;
}

const displayValue = (field: DiffField, row: DupCompany): string => {
  const raw = row[field.key];
  return raw == null ? '' : String(raw);
};

const comparableValue = (field: DiffField, row: DupCompany): string => {
  const raw = row[field.key];
  if (raw == null) return '';
  return (field.compare ?? ((v: unknown) => String(v).trim()))(raw);
};

/** Velden waar minstens twee profielen een ingevulde, afwijkende waarde hebben. */
export function diffFields(rows: DupCompany[], fields: DiffField[] = DIFF_FIELDS): FieldDiff[] {
  const out: FieldDiff[] = [];
  for (const field of fields) {
    const filled = rows
      .map((row) => comparableValue(field, row))
      .filter((value) => value !== '');
    if (new Set(filled).size < 2) continue;
    out.push({
      key: field.key,
      label: field.label,
      blocking: !!field.blocking,
      values: rows.map((row) => {
        const compare = comparableValue(field, row);
        return { companyId: row.company_id, display: displayValue(field, row), filled: compare !== '' };
      }),
    });
  }
  return out;
}

/** Naamdelen van minstens twee tekens (rechtsvormafkortingen als "b.v." vallen er vanzelf uit). */
export function nameTokens(row: DupCompany): Set<string> {
  const parts = normalizeText(row.name ?? '').split(' ');
  return new Set(parts.filter((part) => part.length > 1));
}

/**
 * Namen zijn verenigbaar als één profiel alle naamdelen van de andere bevat.
 * "Jansen" past bij "Jansen Bouw B.V.", "Bakker" past niet bij "De Vries Transport".
 */
export function namesCompatible(rows: DupCompany[]): boolean {
  const sets = rows.map(nameTokens);
  if (sets.some((set) => set.size === 0)) return false;
  return sets.some((candidateSuperset) =>
    sets.every((other) => [...other].every((token) => candidateSuperset.has(token))),
  );
}

export type DupVerdict = 'mergeable' | 'review' | 'not-duplicate';

export interface GroupAnalysis {
  verdict: DupVerdict;
  diffs: FieldDiff[];
  blockingDiffs: FieldDiff[];
  namesCompatible: boolean;
  /** Standaard te behouden profiel. */
  suggestedSurvivorId: string;
}

/** Rijkste profiel wint: eerst actief, dan aantal gevulde velden, dan het nieuwste. */
export function suggestSurvivor(rows: DupCompany[], fields: DiffField[] = DIFF_FIELDS): string {
  const score = (row: DupCompany) => fields.filter((f) => comparableValue(f, row) !== '').length;
  return [...rows].sort((a, b) => {
    if (!!b.is_active !== !!a.is_active) return b.is_active ? 1 : -1;
    const byScore = score(b) - score(a);
    if (byScore !== 0) return byScore;
    return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
  })[0]?.company_id;
}

/**
 * `reason` bepaalt of naamongelijkheid tegenhoudt. Bij een KVK-match is het wettelijk
 * unieke nummer sterker dan de naam — dat mag nooit als "waarschijnlijk niet hetzelfde"
 * eindigen puur omdat de handelsnaam is gewijzigd.
 */
export function analyzeGroup(rows: DupCompany[], reason: string, fields: DiffField[] = DIFF_FIELDS): GroupAnalysis {
  const diffs = diffFields(rows, fields);
  const blockingDiffs = diffs.filter((d) => d.blocking);
  const compatible = reason === 'Zelfde KVK-nummer' || namesCompatible(rows);

  let verdict: DupVerdict;
  if (!compatible) verdict = 'not-duplicate';
  else if (blockingDiffs.length > 0) verdict = 'review';
  else verdict = 'mergeable';

  return {
    verdict,
    diffs,
    blockingDiffs,
    namesCompatible: compatible,
    suggestedSurvivorId: suggestSurvivor(rows, fields),
  };
}
