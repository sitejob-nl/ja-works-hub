/**
 * Vergelijkt de profielen binnen een duplicaatgroep en bepaalt wat er te kiezen valt.
 *
 * Achtergrond: `find_duplicate_candidates` groepeert op telefoonnummer of op
 * geboortedatum + achternaam. Dat levert drie heel verschillende situaties op, die op
 * het scherm ook echt uit elkaar moeten:
 *
 *  1. Hetzelfde persoon, net anders opgeschreven ("Adrian" vs "Adrian Ilie").
 *  2. Hetzelfde persoon, maar met botsende gegevens (twee geboortedata, twee
 *     personeelsnummers) — daar moet een mens naar kijken.
 *  3. Verschillende mensen die toevallig één telefoonnummer delen. In productie zit
 *     een nummer met tien verschillende namen eronder; dat is een kantoornummer, geen
 *     duplicaat. Zulke groepen samenvoegen zou tien dossiers vernietigen.
 *
 * `merge_candidate_records` vult lege velden van de overlever aan met die van de
 * verliezer (`coalesce`), dus een veld dat maar aan één kant is ingevuld gaat niet
 * verloren en telt hier niet als verschil. Botsen doen alleen velden die aan beide
 * kanten zijn ingevuld en van elkaar afwijken.
 */

export interface DupCandidate {
  candidate_id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  date_of_birth?: string | null;
  status?: string | null;
  created_at?: string;
  has_employee?: boolean;
  [key: string]: unknown;
}

const stripAccents = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Kleine letters, zonder accenten en leestekens, spaties samengetrokken. */
export const normalizeText = (value: unknown): string =>
  stripAccents(String(value ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Alleen de cijfers, laatste negen — zelfde sleutel als de detectie in de database. */
export const normalizePhone = (value: unknown): string => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : digits;
};

const arrayValue = (value: unknown): string => {
  if (!Array.isArray(value)) return '';
  return [...value].map((v) => normalizeText(v)).filter(Boolean).sort().join(', ');
};

type Compare = (value: unknown) => string;

export interface DiffField {
  key: string;
  label: string;
  /** Botsing hierop betekent: niet automatisch samenvoegen. */
  blocking?: boolean;
  compare?: Compare;
  /** Weergave in de vergelijkingstabel; standaard de ruwe waarde. */
  display?: (value: unknown) => string;
}

/**
 * De geboortedatum is de enige veldbotsing die tegenhoudt: twee geboortedata onder één
 * telefoonnummer betekent bijna altijd twee verschillende mensen. De rest — mailadres,
 * adres, status — verschilt bij dezelfde persoon regelmatig gewoon omdat het ene profiel
 * ouder is dan het andere.
 *
 * Het personeelsnummer telt bewust *niet* mee als blokkeerder, hoe verleidelijk dat ook
 * lijkt. Carerix gaf elk record een eigen nummer, dus twee nummers is precies wat je
 * verwacht bij een dubbel profiel: het is het symptoom, niet het tegenbewijs. Zou het
 * blokkeren, dan valt 75 van de 78 naamgelijke groepen in productie uit de automatische
 * afhandeling en is er niets gewonnen. Het verschil blijft wel in de vergelijking staan,
 * en het nummer van het profiel dat blijft is dat van het rijkste dossier.
 */
export const DIFF_FIELDS: DiffField[] = [
  { key: 'first_name', label: 'Voornaam', compare: normalizeText },
  { key: 'last_name', label: 'Achternaam', compare: normalizeText },
  { key: 'date_of_birth', label: 'Geboortedatum', blocking: true },
  { key: 'employee_number', label: 'Personeelsnummer', compare: normalizeText },
  { key: 'email', label: 'E-mail', compare: normalizeText },
  { key: 'phone', label: 'Telefoon', compare: normalizePhone },
  { key: 'nationality', label: 'Nationaliteit', compare: normalizeText },
  { key: 'address_street', label: 'Straat', compare: normalizeText },
  { key: 'address_postal', label: 'Postcode', compare: normalizeText },
  { key: 'address_city', label: 'Plaats', compare: normalizeText },
  { key: 'id_document_number', label: 'ID-nummer', compare: normalizeText },
  { key: 'status', label: 'Status', compare: normalizeText },
  { key: 'employee_status', label: 'Dienstverband', compare: normalizeText },
  { key: 'source', label: 'Bron', compare: normalizeText },
  { key: 'skills', label: 'Vaardigheden', compare: arrayValue, display: (v) => (Array.isArray(v) ? v.join(', ') : '') },
  { key: 'languages', label: 'Talen', compare: arrayValue, display: (v) => (Array.isArray(v) ? v.join(', ') : '') },
  { key: 'certifications', label: 'Certificaten', compare: arrayValue, display: (v) => (Array.isArray(v) ? v.join(', ') : '') },
  { key: 'notes', label: 'Profielnotities', compare: normalizeText },
];

export interface FieldDiff {
  key: string;
  label: string;
  blocking: boolean;
  /** Waarde per kandidaat-id, in de volgorde van de groep. */
  values: Array<{ candidateId: string; display: string; filled: boolean }>;
}

const displayValue = (field: DiffField, row: DupCandidate): string => {
  const raw = row[field.key];
  if (field.display) return field.display(raw);
  if (raw == null) return '';
  return String(raw);
};

const comparableValue = (field: DiffField, row: DupCandidate): string => {
  const raw = row[field.key];
  if (raw == null) return '';
  return (field.compare ?? ((v: unknown) => String(v).trim()))(raw);
};

/** Velden waar minstens twee profielen een ingevulde, afwijkende waarde hebben. */
export function diffFields(rows: DupCandidate[], fields: DiffField[] = DIFF_FIELDS): FieldDiff[] {
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
        return { candidateId: row.candidate_id, display: displayValue(field, row), filled: compare !== '' };
      }),
    });
  }
  return out;
}

/** Naamdelen van minstens twee tekens, voor- en achternaam samen. */
export function nameTokens(row: DupCandidate): Set<string> {
  const parts = normalizeText(`${row.first_name ?? ''} ${row.last_name ?? ''}`).split(' ');
  return new Set(parts.filter((part) => part.length > 1));
}

/**
 * Namen zijn verenigbaar als één profiel alle naamdelen van de andere bevat.
 * "Adrian" past bij "Adrian Ilie", "Burai" past niet bij "Divid".
 */
export function namesCompatible(rows: DupCandidate[]): boolean {
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
  /** Meer dan één profiel met een payroll-record: de database weigert dit sowieso. */
  doubleEmployment: boolean;
  namesCompatible: boolean;
  /** Standaard te behouden profiel. */
  suggestedSurvivorId: string;
}

/** Rijkste profiel wint: eerst dienstverband, dan aantal gevulde velden, dan de nieuwste. */
export function suggestSurvivor(rows: DupCandidate[], fields: DiffField[] = DIFF_FIELDS): string {
  const score = (row: DupCandidate) => fields.filter((f) => comparableValue(f, row) !== '').length;
  return [...rows].sort((a, b) => {
    if (!!b.has_employee !== !!a.has_employee) return b.has_employee ? 1 : -1;
    const byScore = score(b) - score(a);
    if (byScore !== 0) return byScore;
    return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
  })[0]?.candidate_id;
}

export function analyzeGroup(rows: DupCandidate[], fields: DiffField[] = DIFF_FIELDS): GroupAnalysis {
  const diffs = diffFields(rows, fields);
  const blockingDiffs = diffs.filter((d) => d.blocking);
  const compatible = namesCompatible(rows);
  const doubleEmployment = rows.filter((r) => r.has_employee).length > 1;

  let verdict: DupVerdict;
  if (!compatible) verdict = 'not-duplicate';
  else if (blockingDiffs.length > 0 || doubleEmployment) verdict = 'review';
  else verdict = 'mergeable';

  return {
    verdict,
    diffs,
    blockingDiffs,
    doubleEmployment,
    namesCompatible: compatible,
    suggestedSurvivorId: suggestSurvivor(rows, fields),
  };
}
