// Per-record voorvertoning van een Carerix-import.
//
// Een dry-run schrijft voor elk record dat hij zou aanmaken (action='create')
// óf waarvan Carerix afwijkende gegevens heeft (action='update', met veld-diff)
// een regel weg in `carerix_import_previews`. De gebruiker vinkt daar records
// aan of uit; een daaropvolgende live run leest die selectie: uitgevinkte
// creates worden overgeslagen, aangevinkte updates worden toegepast. Zo is
// elke import vooraf te controleren in plaats van achteraf op te ruimen.

import { phoneKey } from './mappers.ts';

// Bewust géén esm.sh-import voor het client-type: dit bestand wordt ook door
// de vitest-suite (tsc) geïmporteerd en die kan URL-imports niet resolven.
// De echte SupabaseClient is structureel toewijsbaar aan dit minimum.
// deno-lint-ignore no-explicit-any
type SupabaseClient = { from(table: string): any };

export interface PreviewRow {
  entity: string;
  carerix_id: string;
  action: 'create' | 'update';
  label: string | null;
  details: Record<string, unknown> | null;
  // Alleen bij action='update': { veld: { van, naar } }.
  diff: Record<string, { van: unknown; naar: unknown }> | null;
  // Alleen bij action='update': het bestaande platform-record.
  existing_id: string | null;
  spam_reason: string | null;
  excluded: boolean;
}

export interface PreviewDecision {
  excluded: boolean;
  spamReason: string | null;
}

export type PreviewSelection = Map<string, PreviewDecision>;

export function selectionKey(entity: string, carerixId: string): string {
  return `${entity}:${carerixId}`;
}

const PAGE_SIZE = 1000;

// =====================================================================
// Enrichment-begrippen — gedeeld met runner.ts
// =====================================================================
// Deze constanten horen inhoudelijk bij de enrichment in runner.ts, maar de
// diff-berekening hieronder moet wéten welke velden een live run toch al
// automatisch vult (die horen niet in een update-voorvertoning thuis). Ze
// staan hier zodat runner.ts ze kan importeren zonder importcyclus.

// Velden die bulkEnrichCandidates automatisch vult wanneer ze lokaal leeg zijn.
export const ENRICH_FIELDS = [
  'employee_number',
  'email',
  'phone',
  'phone_nl',
  'date_of_birth',
  'nationality',
  'languages',
  'address_street',
  'address_city',
  'address_postal',
  'address_country',
  'birth_country',
  // 'notes' hoort hier bewust NIET meer bij: dezelfde Carerix-vrijetekst wordt al
  // opgeknipt als losse notitierijen geïmporteerd (processCREmployeeProfileNotes),
  // dus verrijken van candidates.notes zette elk dossier dubbel op het scherm én
  // liet een opschoning bij de volgende sync terugkomen.
];

// Velden die naast NULL óók bij hun kolom-default als "leeg" gelden: de
// migratie-default 'NL' is geen echte data en mag door Carerix overschreven
// worden. 'Dossier' is vervuiling van de oude label-fallback-bug (zie
// mappers.ts dataNodeValue). Geldt alleen voor Carerix-gemapte kandidaten.
export const ENRICH_DEFAULT_AS_BLANK: Record<string, unknown[]> = {
  address_country: ['NL'],
  birth_country: ['NL'],
  nationality: ['Dossier'],
};

export function isBlankValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function isEnrichableValue(field: string, value: unknown): boolean {
  if (isBlankValue(value)) return true;
  const defaults = ENRICH_DEFAULT_AS_BLANK[field];
  return Boolean(defaults?.includes(value));
}

// =====================================================================
// Vergelijkingsvelden per entiteit
// =====================================================================
// Dit is tegelijk de whitelist voor het TOEPASSEN van updates: een live run
// schrijft nooit een veld buiten deze lijst, wat er ook in de opgeslagen diff
// staat. Bewust uitgesloten:
//   - bsn/iban (encrypted kolommen; BSN loopt via het aparte enrich-pad),
//   - status/compliance_status (lokale workflow is leidend, Carerix is bevroren),
//   - notes (wordt als losse notities geïmporteerd),
//   - FK's zoals company_id (re-parenting is geen "veldje bijwerken"),
//   - vacancy.description (lokaal opgeschoond; zou elke run als diff terugkomen),
//   - languages: het platform draagt AI-verrijkte niveau-annotaties ("Engels -
//     B1", "Roemeens - moedertaal"); Carerix heeft alleen kale taalnamen en
//     valt soms terug op de accounttaal. Carerix kan hier nooit beter zijn —
//     de dry-run van 2026-08-11 gaf 1.645 van 1.655 kandidaat-diffs op alléén
//     dit veld. Lege taallijsten vult het enrich-pad al automatisch.
export const COMPARE_FIELDS: Record<string, string[]> = {
  candidate: [
    'first_name',
    'last_name',
    'email',
    'phone',
    'phone_nl',
    'date_of_birth',
    'nationality',
    'employee_number',
    'address_street',
    'address_city',
    'address_postal',
    'address_country',
    'birth_country',
  ],
  company: ['name'],
  contact: ['first_name', 'last_name', 'full_name', 'email'],
  vacancy: ['title', 'hourly_rate', 'start_date', 'end_date'],
};

// Runner-entiteitsnaam (meervoud) → mapping-type + tabel voor het toepassen
// van aangevinkte updates in een live run.
export const UPDATE_TARGETS: Record<string, { entityType: string; table: string }> = {
  candidates: { entityType: 'candidate', table: 'candidates' },
  companies: { entityType: 'company', table: 'companies' },
  contacts: { entityType: 'contact', table: 'company_contacts' },
  vacancies: { entityType: 'vacancy', table: 'vacancies' },
};

// Mapper-fallbacks die geen echte Carerix-data zijn; een payload met zo'n
// waarde mag nooit een lokale (echte) waarde als "afwijkend" aanmerken.
const PLACEHOLDER_VALUES = new Set([
  'onbekend',
  'onbekend bedrijf',
  'onbekende vacature',
  'onbekende functie',
]);

const DATE_FIELDS = new Set(['date_of_birth', 'start_date', 'end_date']);
const PHONE_FIELDS = new Set(['phone', 'phone_nl']);
const EMAIL_FIELDS = new Set(['email']);
const NUMERIC_FIELDS = new Set(['hourly_rate']);

// Normaliseert een waarde tot een vergelijkingssleutel, zodat puur cosmetische
// verschillen (spaties, hoofdletters in e-mail, telefoonnotatie, tijdstempel
// achter een datum) niet als "andere info" tellen. Null = leeg.
export function normalizeForCompare(field: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const set = value
      .map((v) => String(v).trim().toLowerCase())
      .filter((v) => v !== '')
      .sort();
    return set.length > 0 ? JSON.stringify(set) : null;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;

  const s = String(value).trim();
  if (s === '') return null;
  if (DATE_FIELDS.has(field)) return s.slice(0, 10);
  if (PHONE_FIELDS.has(field)) return phoneKey(s) || s;
  if (EMAIL_FIELDS.has(field)) return s.toLowerCase();
  if (NUMERIC_FIELDS.has(field)) {
    const n = Number(s.replace(',', '.'));
    if (Number.isFinite(n)) return String(n);
  }
  return s;
}

/**
 * Veld-diff tussen de Carerix-payload en het bestaande platformrecord.
 *
 * Regels:
 * - Alleen velden uit COMPARE_FIELDS[entityType].
 * - Carerix leeg of een mapper-placeholder ("Onbekend") → geen diff; we
 *   stellen nooit voor om echte data door niets te vervangen.
 * - Kandidaat + lokaal leeg (of een enrich-default zoals 'NL') → geen diff:
 *   de live run vult dat via het enrich-pad toch al automatisch.
 * - Andere entiteiten kennen geen enrichment, dus daar telt lokaal-leeg →
 *   Carerix-waarde wél als (aanvullende) update.
 */
export function computeUpdateDiff(
  entityType: string,
  payload: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, { van: unknown; naar: unknown }> | null {
  const fields = COMPARE_FIELDS[entityType];
  if (!fields) return null;

  const diff: Record<string, { van: unknown; naar: unknown }> = {};
  for (const field of fields) {
    const payRaw = payload[field];
    const payNorm = normalizeForCompare(field, payRaw);
    if (payNorm === null) continue;
    if (typeof payRaw === 'string' && PLACEHOLDER_VALUES.has(payRaw.trim().toLowerCase())) continue;

    const curRaw = current[field];
    if (entityType === 'candidate' && isEnrichableValue(field, curRaw)) continue;

    const curNorm = normalizeForCompare(field, curRaw);
    if (curNorm === payNorm) continue;
    diff[field] = { van: curRaw ?? null, naar: payRaw };
  }

  return Object.keys(diff).length > 0 ? diff : null;
}

// Bestaand record dat in een dry-run kandidaat is voor een update-voorvertoning.
export interface UpdateQueueItem {
  table: string;
  entityType: string;
  carerixId: string;
  existingId: string;
  payload: Record<string, unknown>;
  label: string | null;
}

const SELECT_CHUNK = 200;

/**
 * Berekent voor een pagina bestaande records de update-voorvertoningen: haalt
 * de huidige platformwaarden in bulk op en geeft alleen de records met een
 * echte diff terug. Standaard uitgevinkt — een lokale waarde overschrijven is
 * per record opt-in.
 */
export async function buildUpdatePreviews(
  admin: SupabaseClient,
  items: UpdateQueueItem[],
  organizationId: string,
): Promise<PreviewRow[]> {
  const rows: PreviewRow[] = [];
  if (items.length === 0) return rows;

  // In de praktijk is een pagina homogeen (één entiteit), maar groepeer
  // defensief zodat een gemengde queue niet stilletjes misgaat.
  const groups = new Map<string, UpdateQueueItem[]>();
  for (const item of items) {
    if (!COMPARE_FIELDS[item.entityType]) continue;
    const key = `${item.table}:${item.entityType}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  for (const groupItems of groups.values()) {
    const { table, entityType } = groupItems[0];
    const fields = COMPARE_FIELDS[entityType];

    for (let from = 0; from < groupItems.length; from += SELECT_CHUNK) {
      const chunk = groupItems.slice(from, from + SELECT_CHUNK);
      const ids = [...new Set(chunk.map((i) => i.existingId))];
      // Service-role omzeilt RLS; het org-filter is defense-in-depth zodat een
      // (hoe dan ook) verkeerde existing_id nooit data van een andere tenant
      // in een previewregel kan trekken.
      const { data, error } = await admin
        .from(table)
        .select(`id, ${fields.join(', ')}`)
        .eq('organization_id', organizationId)
        .in('id', ids);
      if (error) {
        throw new Error(`update-voorvertoning: ${table} lezen mislukt: ${error.message}`);
      }

      const byId = new Map<string, Record<string, unknown>>();
      for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        if (typeof row.id === 'string') byId.set(row.id, row);
      }

      for (const item of chunk) {
        const current = byId.get(item.existingId);
        if (!current) continue;
        const diff = computeUpdateDiff(entityType, item.payload, current);
        if (!diff) continue;
        rows.push({
          entity: entityType,
          carerix_id: item.carerixId,
          action: 'update',
          label: item.label ?? deriveLabel(item.payload),
          details: null,
          diff,
          existing_id: item.existingId,
          spam_reason: null,
          excluded: true,
        });
      }
    }
  }

  return rows;
}

/**
 * Bouwt de daadwerkelijke UPDATE-patch uit een opgeslagen diff. De whitelist
 * (COMPARE_FIELDS) wordt hier opnieuw afgedwongen: de UI kan alleen `excluded`
 * omzetten (kolom-grant), maar ook een gemanipuleerde diff-jsonb kan zo nooit
 * buiten de vergelijkingsvelden schrijven.
 */
export function buildUpdatePatch(diff: unknown, entityType: string): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const allowed = COMPARE_FIELDS[entityType];
  if (!allowed || !diff || typeof diff !== 'object' || Array.isArray(diff)) return patch;

  for (const [field, change] of Object.entries(diff as Record<string, unknown>)) {
    if (!allowed.includes(field)) continue;
    if (!change || typeof change !== 'object' || Array.isArray(change)) continue;
    if (!('naar' in (change as Record<string, unknown>))) continue;
    patch[field] = (change as { naar: unknown }).naar;
  }
  return patch;
}

export interface ApplyUpdatesResult {
  applied: number;
  failures: Array<{ carerix_id: string; error: string }>;
}

/**
 * Stale-guard bij het toepassen: een veld wordt alléén overschreven als het
 * platform nog de waarde heeft die de gebruiker in de voorvertoning als "van"
 * te zien kreeg. Is het veld intussen lokaal gewijzigd (bv. door een collega
 * ná de dry-run), dan vervalt dat veld — de nieuwste handmatige waarde wint en
 * de regel wordt zichtbaar gerapporteerd in plaats van stil overschreven.
 */
export function dropStaleFields(
  diff: unknown,
  current: Record<string, unknown>,
  entityType: string,
): { patch: Record<string, unknown>; dropped: string[] } {
  const full = buildUpdatePatch(diff, entityType);
  const patch: Record<string, unknown> = {};
  const dropped: string[] = [];

  for (const [field, naar] of Object.entries(full)) {
    const van = (diff as Record<string, { van?: unknown }>)[field]?.van;
    const cur = normalizeForCompare(field, current[field]);
    if (cur === normalizeForCompare(field, naar)) {
      // Al toegepast (bv. retry na een crash): stil overslaan, geen ruis.
      continue;
    }
    if (cur === normalizeForCompare(field, van)) {
      patch[field] = naar;
    } else {
      dropped.push(field);
    }
  }
  return { patch, dropped };
}

/**
 * Past de door de gebruiker AANGEVINKTE update-regels uit de dry-run toe.
 * Draait één keer per entiteit, aan het begin van de live run. Idempotent:
 * dezelfde patch nogmaals toepassen verandert niets meer (en een al toegepast
 * veld matcht de stale-guard niet meer, dus een herhaalde run doet niets).
 */
export async function applyApprovedUpdates(
  admin: SupabaseClient,
  previewJobId: string,
  target: { entityType: string; table: string },
  organizationId: string,
): Promise<ApplyUpdatesResult> {
  let applied = 0;
  const failures: Array<{ carerix_id: string; error: string }> = [];
  const fields = COMPARE_FIELDS[target.entityType] ?? [];

  let from = 0;
  while (true) {
    const { data, error } = await admin
      .from('carerix_import_previews')
      .select('carerix_id, existing_id, diff')
      .eq('job_id', previewJobId)
      .eq('entity', target.entityType)
      .eq('action', 'update')
      .eq('excluded', false)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`goedgekeurde updates laden mislukt: ${error.message}`);
    if (!data || data.length === 0) break;

    const rows = data as Array<{ carerix_id: unknown; existing_id: unknown; diff: unknown }>;

    // Huidige platformwaarden in bulk ophalen voor de stale-guard.
    const ids = [...new Set(rows.map((r) => r.existing_id).filter((v): v is string => typeof v === 'string'))];
    const currentById = new Map<string, Record<string, unknown>>();
    for (let cFrom = 0; cFrom < ids.length; cFrom += SELECT_CHUNK) {
      const chunk = ids.slice(cFrom, cFrom + SELECT_CHUNK);
      const { data: currentRows, error: curErr } = await admin
        .from(target.table)
        .select(`id, ${fields.join(', ')}`)
        .eq('organization_id', organizationId)
        .in('id', chunk);
      if (curErr) throw new Error(`huidige waarden laden mislukt: ${curErr.message}`);
      for (const row of (currentRows ?? []) as unknown as Array<Record<string, unknown>>) {
        if (typeof row.id === 'string') currentById.set(row.id, row);
      }
    }

    const results = await Promise.all(
      rows.map(async (row) => {
        const carerixId = String(row.carerix_id);
        if (typeof row.existing_id !== 'string') {
          return { carerixId, error: null, applied: false, dropped: [] as string[] };
        }
        const current = currentById.get(row.existing_id);
        if (!current) {
          // Record bestaat niet (meer) binnen deze org — niets overschrijven.
          return { carerixId, error: 'record niet gevonden in deze organisatie', applied: false, dropped: [] as string[] };
        }
        const { patch, dropped } = dropStaleFields(row.diff, current, target.entityType);
        if (Object.keys(patch).length === 0) {
          return { carerixId, error: null, applied: false, dropped };
        }
        const { error: upErr } = await admin
          .from(target.table)
          .update(patch)
          .eq('id', row.existing_id)
          .eq('organization_id', organizationId);
        return { carerixId, error: upErr?.message ?? null, applied: !upErr, dropped };
      }),
    );

    for (const r of results) {
      if (r.error) failures.push({ carerix_id: r.carerixId, error: `update: ${r.error}` });
      else if (r.applied) applied++;
      if (r.dropped.length > 0) {
        failures.push({
          carerix_id: r.carerixId,
          error: `update deels overgeslagen: ${r.dropped.join(', ')} — lokaal gewijzigd sinds de dry-run`,
        });
      }
    }

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return { applied, failures };
}

/**
 * Laadt ALLE create-regels van de dry-run: de voorvertoning is een whitelist.
 * Een live run die aan een dry-run gekoppeld is importeert uitsluitend records
 * die in de voorvertoning stonden én aangevinkt zijn. Records die pas ná de
 * dry-run in Carerix ontstonden hebben geen regel en worden overgeslagen — die
 * zijn nooit beoordeeld en komen bij de volgende dry-run gewoon in beeld.
 * Update-regels lopen niet via deze map; die worden apart toegepast via
 * applyApprovedUpdates.
 *
 * Net als bij de id-mapper geldt: half laden is hier erger dan niet laden. Een
 * gemiste regel zou een aangevinkt record laten overslaan (of andersom), dus we
 * tellen vooraf en falen hard als we dat aantal niet halen.
 */
export async function loadPreviewSelection(
  admin: SupabaseClient,
  previewJobId: string,
): Promise<PreviewSelection> {
  const filter = (q: any) => q.eq('job_id', previewJobId).eq('action', 'create');

  const { count, error: countError } = await filter(
    admin.from('carerix_import_previews').select('id', { count: 'exact', head: true }),
  );
  if (countError) throw new Error(`preview-selectie tellen mislukt: ${countError.message}`);

  const expected = count ?? 0;
  const selection: PreviewSelection = new Map();
  if (expected === 0) return selection;

  let loaded = 0;
  for (let from = 0; from < expected; from += PAGE_SIZE) {
    const { data, error } = await filter(
      admin
        .from('carerix_import_previews')
        .select('entity, carerix_id, excluded, spam_reason')
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1),
    );
    if (error) throw new Error(`preview-selectie laden mislukt: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      selection.set(selectionKey(String(row.entity), String(row.carerix_id)), {
        excluded: row.excluded === true,
        spamReason: (row.spam_reason as string | null) ?? null,
      });
    }
    loaded += data.length;
  }

  if (loaded < expected) {
    throw new Error(
      `preview-selectie incompleet: ${loaded}/${expected} regels geladen. ` +
        'Import gestopt om te voorkomen dat uitgevinkte records alsnog binnenkomen.',
    );
  }

  return selection;
}

// `carerix_name` staat in de mapping-metadata die plaatsingen meegeven; dat is
// daar de enige menselijk leesbare aanduiding.
const LABEL_KEYS = ['name', 'title', 'file_name', 'subject', 'carerix_name'];

/**
 * Menselijk leesbare aanduiding voor de previewlijst. Valt terug op de
 * foutmeta die de runners toch al meegeven, en uiteindelijk op het Carerix-ID —
 * een regel zonder label is nog altijd bruikbaar om op uit te vinken.
 */
export function deriveLabel(
  payload: Record<string, unknown>,
  meta?: Record<string, unknown>,
): string | null {
  const sources = [payload, meta ?? {}];

  for (const source of sources) {
    const first = str(source.first_name);
    const last = str(source.last_name);
    if (first || last) return [first, last].filter(Boolean).join(' ');
  }

  for (const source of sources) {
    for (const key of LABEL_KEYS) {
      const value = str(source[key]);
      if (value) return value;
    }
  }

  for (const source of sources) {
    const content = str(source.content);
    if (content) return content.length > 80 ? `${content.slice(0, 80)}…` : content;
  }

  return null;
}

// Beperkte set velden die helpt bij het beoordelen van een record, zonder de
// hele payload te bewaren (die bevat ook gevoelige velden zoals bsn/iban).
const DETAIL_KEYS = [
  'email',
  'phone',
  'address_city',
  'city',
  'status',
  'start_date',
  'end_date',
  'type',
];

export function deriveDetails(payload: Record<string, unknown>): Record<string, unknown> | null {
  const details: Record<string, unknown> = {};

  for (const key of DETAIL_KEYS) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim() !== '') details[key] = value.trim();
  }

  return Object.keys(details).length > 0 ? details : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
