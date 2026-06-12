// Carerix → JA Werkt insert payload mappers.
//
// v1 mappers (mapCompany/mapContact/mapCandidate/mapVacancy) take the minimal
// CX*-types. CR mappers take the richer CR*-types and populate more fields.
// All mappers leave unknown fields NULL so JA Werkt staff can fill them in later.

import type {
  CRAttachment,
  CREmployee,
  CRJob,
  CRMatch,
  CRNote,
  CRTodo,
  CRWorkHistory,
  CXCandidate,
  CXCompany,
  CXContact,
  CXVacancy,
} from './types.ts';
import { isCvType, mapDocumentType, mapStatus, statusMaps } from './status-maps.ts';

function firstValue(container: { items?: Array<{ value?: string }> } | undefined): string | null {
  const items = container?.items;
  if (!items || items.length === 0) return null;
  return items[0]?.value ?? null;
}

const firstEmail = firstValue;
const firstPhone = firstValue;

function statusValue(node: { value?: string } | undefined): string | undefined {
  return node?.value;
}

function isoDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function isoDay(raw: string | undefined | null): string | null {
  // Returns YYYY-MM-DD only (Postgres `date` type), or null.
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function cleanText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  return value.length > 0 ? value : null;
}

// CRDataNode-waarde uitlezen. BELANGRIJK: `label` is in Carerix de NAAM VAN DE
// CATEGORIE (bv. "Dossier"), niet de waarde — en een niet-ingevuld node komt
// terug als `{ _id: "0", value: null, label: "Dossier" }`. Een label-fallback
// zette daardoor 1934 kandidaten op nationaliteit "Dossier". Daarom: alleen
// `value` (en optioneel `tag` als code), en `_id === "0"` is leeg.
function isEmptyDataNode(node: { _id?: string | number } | undefined | null): boolean {
  return !node || String(node._id) === '0';
}

function dataNodeValue(
  node: { _id?: string; value?: string; tag?: string } | undefined | null,
): string | null {
  if (isEmptyDataNode(node)) return null;
  return cleanText(node?.value);
}

// ISO-landcode (tag) van een country-datanode, met value als fallback.
function dataNodeCountryCode(
  node: { _id?: string; value?: string; tag?: string } | undefined | null,
): string | null {
  if (isEmptyDataNode(node)) return null;
  return cleanText(node?.tag) || cleanText(node?.value);
}

// =====================================================================
// Telefoonnummers — NL vs buitenlands
// =====================================================================

const NL_PHONE_PREFIX = /^(\+31|0031|0[1-9])/;

function cleanPhone(raw: unknown): string | null {
  const value = cleanText(raw);
  if (!value) return null;
  return value.replace(/\s+/g, ' ').trim();
}

export function isDutchPhone(raw: string): boolean {
  return NL_PHONE_PREFIX.test(raw.replace(/[\s\-().]/g, ''));
}

export function phoneKey(raw: string): string {
  // Vergelijkingssleutel: alleen cijfers, internationaal 00… → landcode,
  // nationaal NL 0… → 31…
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `31${digits.slice(1)}`;
  return digits;
}

export interface SplitPhones {
  phone: string | null;
  phone_nl: string | null;
}

// Carerix-kandidaten hebben regelmatig twee nummers (NL + buitenlands), meestal
// in mobileNumber + mobileNumberBusiness. Regel: het buitenlandse nummer is het
// primaire contactnummer (`phone`), het NL-nummer gaat naar `phone_nl`. Bij twee
// NL-nummers: eerste → phone, tweede → phone_nl. Eén nummer → altijd `phone`.
export function splitCarerixPhones(
  e: Pick<CREmployee, 'phoneNumber' | 'mobileNumber' | 'phoneNumberBusiness' | 'mobileNumberBusiness'>,
): SplitPhones {
  const ordered = [e.mobileNumber, e.phoneNumber, e.mobileNumberBusiness, e.phoneNumberBusiness]
    .map(cleanPhone)
    .filter((n): n is string => Boolean(n));

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const n of ordered) {
    const key = phoneKey(n);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(n);
  }
  if (unique.length === 0) return { phone: null, phone_nl: null };

  const nl = unique.filter((n) => isDutchPhone(n));
  const foreign = unique.filter((n) => !isDutchPhone(n));

  if (foreign.length > 0) {
    return { phone: foreign[0], phone_nl: nl[0] ?? null };
  }
  return { phone: nl[0], phone_nl: nl[1] ?? null };
}

// =====================================================================
// BSN — elfproef
// =====================================================================

export function isValidBsn(raw: unknown): boolean {
  const value = cleanText(raw);
  if (!value) return false;
  // Alleen puur numerieke waarden van 8-9 cijfers (filtert "Yes " e.d. uit).
  if (!/^\d{8,9}$/.test(value)) return false;
  const padded = value.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(padded[i]) * (9 - i);
  sum -= Number(padded[8]);
  return sum !== 0 && sum % 11 === 0;
}

function normalizeLanguage(raw: unknown): string | null {
  const value = cleanText(raw);
  if (!value) return null;
  const lower = value.toLowerCase();
  const known: Record<string, string> = {
    dutch: 'Nederlands',
    nederlands: 'Nederlands',
    nl: 'Nederlands',
    english: 'Engels',
    engels: 'Engels',
    en: 'Engels',
    polish: 'Pools',
    pools: 'Pools',
    pl: 'Pools',
    romanian: 'Roemeens',
    roemeens: 'Roemeens',
    ro: 'Roemeens',
    portuguese: 'Portugees',
    portugees: 'Portugees',
    pt: 'Portugees',
    spanish: 'Spaans',
    spaans: 'Spaans',
    es: 'Spaans',
  };
  return known[lower] ?? value;
}

function splitLanguageValues(raw: unknown): Array<string | null> {
  if (Array.isArray(raw)) return raw.map((value) => normalizeLanguage(value));
  const value = cleanText(raw);
  if (!value) return [];
  return value.split(/[,;/|]+/).map((part) => normalizeLanguage(part));
}

function compactUnique(values: Array<string | null>): string[] | null {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out.length > 0 ? out : null;
}

function normalizeKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function additionalInfoValue(
  info: Record<string, unknown> | undefined,
  candidates: string[],
): unknown {
  if (!info) return null;
  const wanted = new Set(candidates.map(normalizeKey));
  for (const [key, rawValue] of Object.entries(info)) {
    if (!wanted.has(normalizeKey(key))) continue;
    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      const objectValue = rawValue as Record<string, unknown>;
      return objectValue.value ?? objectValue.label ?? objectValue.name ?? objectValue.displayName ?? rawValue;
    }
    return rawValue;
  }
  return null;
}

export interface CarerixProfileNoteEntry {
  body: string;
  createdAt: string | null;
  marker: string | null;
  index: number;
}

const PROFILE_NOTE_MARKER = /\[([A-Z]{1,6})\s+(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})\]/g;

function lastSundayOfMonth(year: number, monthIndex: number): number {
  const d = new Date(Date.UTC(year, monthIndex + 1, 0));
  return d.getUTCDate() - d.getUTCDay();
}

function amsterdamOffset(year: number, month: number, day: number, hour: number): '+01:00' | '+02:00' {
  if (month < 3 || month > 10) return '+01:00';
  if (month > 3 && month < 10) return '+02:00';

  if (month === 3) {
    const dstStart = lastSundayOfMonth(year, 2);
    return day > dstStart || (day === dstStart && hour >= 2) ? '+02:00' : '+01:00';
  }

  const dstEnd = lastSundayOfMonth(year, 9);
  return day < dstEnd || (day === dstEnd && hour < 3) ? '+02:00' : '+01:00';
}

function markerToAmsterdamIso(match: RegExpMatchArray): string | null {
  const [, , dd, mm, yyyy, hh, min] = match;
  const year = Number(yyyy);
  const month = Number(mm);
  const day = Number(dd);
  const hour = Number(hh);
  const minute = Number(min);
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) return null;

  const offset = amsterdamOffset(year, month, day, hour);
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:00${offset}`;
}

export function splitCREmployeeProfileNotes(raw: string | undefined | null): CarerixProfileNoteEntry[] {
  const text = raw?.trim();
  if (!text) return [];

  const entries: CarerixProfileNoteEntry[] = [];
  const matcher = new RegExp(PROFILE_NOTE_MARKER);
  let start = 0;
  let index = 0;

  for (const match of text.matchAll(PROFILE_NOTE_MARKER)) {
    const matchIndex = match.index ?? 0;
    const end = matchIndex + match[0].length;
    const body = text.slice(start, end).trim();
    if (body) {
      entries.push({
        body,
        createdAt: markerToAmsterdamIso(match),
        marker: match[0],
        index,
      });
      index++;
    }
    start = end;
  }

  const tail = text.slice(start).trim();
  if (tail) {
    const tailMatch = matcher.exec(tail);
    entries.push({
      body: tail,
      createdAt: tailMatch ? markerToAmsterdamIso(tailMatch) : null,
      marker: tailMatch?.[0] ?? null,
      index,
    });
  }

  return entries.length > 0
    ? entries
    : [{ body: text, createdAt: null, marker: null, index: 0 }];
}

// =====================================================================
// v1 public schema mappers
// =====================================================================

export function mapCompany(c: CXCompany, orgId: string) {
  return {
    name: c.name || c.displayName || 'Onbekend bedrijf',
    organization_id: orgId,
    is_active: true,
  };
}

export function mapContact(c: CXContact, companyId: string, orgId: string) {
  const firstName = c.firstName ?? null;
  const lastName = c.lastName ?? null;
  const fullName =
    c.displayName || [firstName, lastName].filter(Boolean).join(' ').trim() || 'Onbekend';

  return {
    company_id: companyId,
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
    email: firstEmail(c.emailAddresses),
    organization_id: orgId,
    is_primary: false,
  };
}

export function mapCandidate(c: CXCandidate, orgId: string): Record<string, unknown> {
  return {
    first_name: c.firstName || 'Onbekend',
    last_name: c.lastName || 'Onbekend',
    email: firstEmail(c.emailAddresses),
    status: 'nieuw',
    source: 'carerix',
    compliance_status: 'incompleet',
    organization_id: orgId,
  };
}

export function mapVacancyV1(v: CXVacancy, orgId: string) {
  return {
    title: v.jobTitle || v.displayName || 'Onbekende vacature',
    status: 'gesloten',
    hourly_rate: 0,
    organization_id: orgId,
  };
}

// =====================================================================
// CR* mappers — richer fields available
// =====================================================================

// JA Werkt-tenant custom fields in additionalInfo (datanode-ids geverifieerd
// via crDataNode-introspectie op 2026-06-12):
//   _10235 = "BSN NR" (string)
//   _10232 = "Eigen huisvesting" (checkbox; ["10230"] = Ja, ["10231"] = Nee)
//   _10233 = "Indien Nee, adres:" (NL-verblijfadres als geen eigen huisvesting)
const AI_KEY_BSN = ['_10235', 'bsn', 'bsn nr', 'sofinummer', 'sofi nummer', 'social security number'];
const AI_KEY_OWN_HOUSING = '_10232';
const OWN_HOUSING_YES = '10230';
const OWN_HOUSING_NO = '10231';

function additionalInfoOwnHousing(info: Record<string, unknown> | undefined): boolean | null {
  const raw = info?.[AI_KEY_OWN_HOUSING];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = String(raw[0]);
  if (first === OWN_HOUSING_YES) return true;
  if (first === OWN_HOUSING_NO) return false;
  return null;
}

export function mapCREmployee(e: CREmployee, orgId: string): Record<string, unknown> {
  // Adres opbouwen: street + nummer + suffix
  const addressStreet = [e.homeStreet, e.homeNumber, e.homeNumberSuffix]
    .filter(Boolean)
    .join(' ')
    .trim() || null;
  const status = mapStatus(statusMaps.candidate, statusValue(e.toStatusNode), 'nieuw');
  const additionalBsn = additionalInfoValue(e.additionalInfo, AI_KEY_BSN);
  const additionalLanguages = additionalInfoValue(e.additionalInfo, [
    'languages',
    'language',
    'talen',
    'taal',
    'spreektalen',
  ]);
  const language = normalizeLanguage(dataNodeValue(e.toLanguageNode) || e.systemLanguage || e.language);
  // Nationaliteit komt uit toNationalityNode (waardes zijn al NL-talig: "Pools",
  // "Roemeens", …). GEEN fallback op toIdentificationCountryNode (dat is het land
  // van het ID-bewijs) en nooit het node-label (= categorienaam "Dossier").
  const nationality =
    dataNodeValue(e.toNationalityNode) ||
    cleanText(additionalInfoValue(e.additionalInfo, ['nationality', 'nationaliteit', 'nationaliteit kandidaat']));
  const phones = splitCarerixPhones(e);
  const bsnCandidates = [cleanText(e.sofiNumber), cleanText(e.adminSofiNumber), cleanText(additionalBsn)];
  const bsn = bsnCandidates.find((value) => isValidBsn(value)) ?? null;
  const lastName = [cleanText(e.lastNamePrefix), cleanText(e.lastName)].filter(Boolean).join(' ') || 'Onbekend';
  const ownHousing = additionalInfoOwnHousing(e.additionalInfo);

  const payload: Record<string, unknown> = {
    first_name: e.firstName || e.fullFirstNames || 'Onbekend',
    last_name: lastName,
    employee_number: cleanText(e.employeeID),
    email: e.emailAddress || e.emailAddressBusiness || null,
    phone: phones.phone,
    phone_nl: phones.phone_nl,
    date_of_birth: isoDay(e.birthDate),
    nationality,
    bsn,
    languages: compactUnique([language, ...splitLanguageValues(additionalLanguages)]),
    address_street: addressStreet,
    address_city: e.homeCity ?? null,
    address_postal: e.homePostalCode ?? null,
    address_country: dataNodeCountryCode(e.toHomeCountryNode),
    birth_country: dataNodeCountryCode(e.toBirthCountryNode),
    notes: e.notes?.trim() || null,
    status,
    source: 'carerix',
    compliance_status: 'incompleet',
    organization_id: orgId,
  };
  // Alleen meesturen wanneer Carerix het expliciet weet — kolom heeft default false.
  if (ownHousing !== null) payload.has_dutch_address = ownHousing;
  // address_country/birth_country hebben DB-default 'NL'; bij insert alleen
  // meesturen als Carerix een echte waarde heeft (anders default laten gelden).
  if (payload.address_country === null) delete payload.address_country;
  if (payload.birth_country === null) delete payload.birth_country;
  return payload;
}

export function mapCRJobToVacancy(job: CRJob, companyId: string, orgId: string) {
  const status = mapStatus(statusMaps.vacancy, job.statusDisplay, 'gesloten');
  return {
    company_id: companyId,
    title: job.name || job.templateName || 'Onbekende vacature',
    description: job.jobInformation || job.memoGeneral || null,
    hourly_rate: job.hourlyTariffInvoice ?? job.hourlyWageGross ?? null,
    required_count: 1,
    status,
    start_date: isoDay(job.startDate),
    end_date: isoDay(job.endDate),
    organization_id: orgId,
  };
}

export function mapCRJobToPlacement(
  job: CRJob,
  candidateId: string,
  companyId: string,
  orgId: string,
  refs: { vacancyId?: string | null; matchId?: string | null } = {},
) {
  const startDate = isoDay(job.startDate);
  if (!startDate) {
    throw new Error('CRJob zonder startDate kan niet als placement geïmporteerd worden');
  }
  const endDate = isoDay(job.endDate);
  const now = Date.now();
  const fallbackStatus = endDate && new Date(endDate).getTime() < now
    ? 'afgerond'
    : new Date(startDate).getTime() > now
      ? 'gepland'
      : 'actief';
  const status = mapStatus(statusMaps.placement, job.statusDisplay, fallbackStatus);

  return {
    employee_id: null,
    candidate_id: candidateId,
    company_id: companyId,
    vacancy_id: refs.vacancyId ?? null,
    match_id: refs.matchId ?? null,
    function_name: job.name || job.templateName || 'Onbekende functie',
    hourly_rate: job.hourlyWageGross ?? 0,
    client_hourly_rate: job.hourlyTariffInvoice ?? null,
    start_date: startDate,
    end_date: endDate,
    expected_end_date: endDate,
    status,
    cao_hours: job.hoursPerWeek ?? job.totalWorkHours ?? null,
    organization_id: orgId,
    compliance_check_passed: false,
  };
}

export function mapCRMatch(
  m: CRMatch,
  candidateId: string,
  vacancyId: string,
  orgId: string,
): Record<string, unknown> {
  const rawStatus = m.statusInfo?.name || m.statusInfo?.label || m.statusDisplay;
  const status = mapMatchStatus(rawStatus);
  // Debug: bewaar de raw Carerix status in match_reasoning zodat we via SQL
  // alle voorkomende waarden kunnen identificeren en de mapper kunnen bijwerken.
  const debugReasoning = rawStatus ? `[carerix-status:${rawStatus}]` : null;
  return {
    candidate_id: candidateId,
    vacancy_id: vacancyId,
    organization_id: orgId,
    status,
    match_score: m.fitScore ?? null,
    match_reasoning: debugReasoning,
    source: m.applySource || 'carerix',
    proposed_at: isoDate(m.creationDate) ?? new Date().toISOString(),
  };
}

function mapMatchStatus(raw: string | undefined | null): string {
  if (!raw) return 'nieuwe_match';
  const lower = raw.toLowerCase().trim();
  if (lower.includes('geplaatst') || lower.includes('placed') || lower.includes('hired'))
    return 'geplaatst';
  if (lower.includes('geaccepteerd') || lower.includes('accepted')) return 'geaccepteerd';
  if (lower.includes('afgewezen') || lower.includes('rejected') || lower.includes('declined'))
    return 'afgewezen';
  if (lower.includes('in_gesprek') || lower.includes('interview') || lower.includes('gesprek'))
    return 'in_gesprek';
  if (lower.includes('voorgesteld') || lower.includes('proposed') || lower.includes('submitted'))
    return 'voorgesteld';
  if (lower.includes('gescreend') || lower.includes('screened')) return 'gescreend';
  return 'nieuwe_match';
}

export function mapCRWorkHistoryToPlacement(
  w: CRWorkHistory,
  candidateId: string,
  companyId: string,
  orgId: string,
): Record<string, unknown> {
  const startDate = isoDay(w.startDate);
  if (!startDate) {
    throw new Error('CRWorkHistory zonder startDate kan niet als placement geïmporteerd worden');
  }
  const endDate = isoDay(w.endDate);
  // Status afgeleid uit endDate: als er een endDate in het verleden is →
  // afgerond, anders actief. Carerix endReason kunnen we later gebruiken om
  // voortijdig_beeindigd te markeren (bv. endReason='cancelled').
  const now = Date.now();
  const isFinished = endDate && new Date(endDate).getTime() < now;
  const isCancelled = (w.endReason || '').toLowerCase().includes('cancel');
  const status = isCancelled ? 'voortijdig_beeindigd' : isFinished ? 'afgerond' : 'actief';

  return {
    candidate_id: candidateId,
    company_id: companyId,
    function_name: w.function || w.employer || 'Onbekende functie',
    hourly_rate: 0, // CRWorkHistory exposeert geen rate; in JA Werkt later aan te vullen
    start_date: startDate,
    end_date: endDate,
    status,
    work_location: w.workLocation ?? null,
    termination_reason: w.endReason ?? null,
    organization_id: orgId,
  };
}

export function mapCRAttachmentToDocument(
  a: CRAttachment & { downloadName?: string; attachmentMimeType?: string; label?: string },
  candidateId: string,
  orgId: string,
): Record<string, unknown> {
  // Carerix-veldnamen op CRAttachment: downloadName (filename), label (tag),
  // attachmentMimeType (mime), attachmentSize.
  const fileName = (a as { downloadName?: string }).downloadName || a.displayName;
  const tag = (a as { label?: string }).label;
  const isCv = isCvType(tag) || isCvType(fileName);
  const docType = isCv ? 'cv' : mapDocumentType(tag);

  return {
    candidate_id: candidateId,
    name: fileName || tag || 'Carerix bijlage',
    type: docType,
    status: 'geldig',
    source: 'carerix',
    file_path: null, // bytes-download in 2e ronde
    organization_id: orgId,
  };
}

type CRTodoKind = 'task' | 'meeting' | 'email' | 'note';

const crTodoKindLabels: Record<CRTodoKind, string> = {
  task: 'taak',
  meeting: 'afspraak',
  email: 'e-mail',
  note: 'notitie',
};

export function classifyCRTodo(t: CRTodo): CRTodoKind {
  const status = (t.statusDisplay ?? '').toLowerCase();
  if (t.isEmail || /\be-?mail\b/.test(status)) return 'email';
  if (t.isMeeting || /afspraak|meeting|gesprek/.test(status)) return 'meeting';
  if (t.isTask || t.deadline || /taak|todo|to do/.test(status)) return 'task';
  return 'note';
}

function hasCRTodoSignal(t: CRTodo): boolean {
  return Boolean(
    t.subject?.trim() ||
      t.message?.trim() ||
      t.startDate ||
      t.endDate ||
      t.deadline ||
      t.statusDisplay ||
      t.isTask ||
      t.isMeeting ||
      t.isEmail,
  );
}

function crTodoMetadataBlock(t: CRTodo): string | null {
  const kind = classifyCRTodo(t);
  const lines = [
    `Type: Carerix ${crTodoKindLabels[kind]}`,
    t.statusDisplay ? `Status: ${t.statusDisplay}` : null,
    t.startDate ? `Start: ${t.startDate}` : null,
    t.endDate ? `Einde: ${t.endDate}` : null,
    t.deadline ? `Deadline: ${t.deadline}` : null,
    t.creationDate ? `Aangemaakt in Carerix: ${t.creationDate}` : null,
    t.modificationDate ? `Laatst gewijzigd in Carerix: ${t.modificationDate}` : null,
  ].filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : null;
}

function isCompletedCRTodo(t: CRTodo): boolean {
  const status = (t.statusDisplay ?? '').toLowerCase();
  return /afgerond|gereed|gesloten|uitgevoerd|done|completed|complete|closed/.test(status);
}

export function mapCRTodoToTask(
  t: CRTodo,
  relatedEntityId: string,
  relatedEntityType: string,
  assignedToUserId: string | null | undefined,
  orgId: string,
): Record<string, unknown> | null {
  if (classifyCRTodo(t) !== 'task' || !hasCRTodoSignal(t)) return null;

  const completed = isCompletedCRTodo(t);
  const metadata = crTodoMetadataBlock(t);
  const description = [t.message?.trim(), metadata].filter(Boolean).join('\n\n').trim();

  return {
    title: t.subject?.trim() || 'Carerix taak',
    description: description || null,
    priority: 'medium',
    status: completed ? 'done' : 'open',
    category: 'opvolging',
    related_entity_id: relatedEntityId,
    related_entity_type: relatedEntityType,
    assigned_to: assignedToUserId ?? null,
    due_date: isoDay(t.deadline ?? t.endDate ?? t.startDate),
    completed_at: completed ? isoDate(t.endDate ?? t.modificationDate ?? t.deadline) : null,
    organization_id: orgId,
    ai_generated: false,
    ai_reasoning: `Geimporteerd uit Carerix CRTodo ${t._id}.`,
  };
}

export function mapCRTodoToNote(
  t: CRTodo,
  relatedEntityId: string,
  relatedEntityType: string,
  createdByUserId: string,
  orgId: string,
): Record<string, unknown> | null {
  // CRToDo gebruikt `message` ipv `body`. We bewaren ook type/datum/status,
  // zodat afspraken en e-mails niet meer als anonieme notities landen.
  if (!hasCRTodoSignal(t)) return null;
  const metadata = crTodoMetadataBlock(t);
  const body = [t.subject?.trim(), t.message?.trim(), metadata]
    .filter(Boolean)
    .join('\n\n')
    .trim();
  if (!body) return null;

  return {
    body,
    related_entity_id: relatedEntityId,
    related_entity_type: relatedEntityType,
    created_by: createdByUserId,
    organization_id: orgId,
    is_internal: true,
  };
}

function hasCRNoteSignal(n: CRNote): boolean {
  return Boolean(
    n.subject?.trim() ||
      n.message?.trim() ||
      n.creationDate ||
      n.modificationDate,
  );
}

function crNoteMetadataBlock(n: CRNote): string | null {
  const lines = [
    'Type: Carerix notitie',
    n.creationDate ? `Aangemaakt in Carerix: ${n.creationDate}` : null,
    n.modificationDate ? `Laatst gewijzigd in Carerix: ${n.modificationDate}` : null,
  ].filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : null;
}

export function mapCRNoteToNote(
  n: CRNote,
  relatedEntityId: string,
  relatedEntityType: string,
  createdByUserId: string,
  orgId: string,
): Record<string, unknown> | null {
  if (!hasCRNoteSignal(n)) return null;
  const metadata = crNoteMetadataBlock(n);
  const body = [n.subject?.trim(), n.message?.trim(), metadata]
    .filter(Boolean)
    .join('\n\n')
    .trim();
  if (!body) return null;

  return {
    body,
    related_entity_id: relatedEntityId,
    related_entity_type: relatedEntityType,
    created_by: createdByUserId,
    organization_id: orgId,
    is_internal: true,
  };
}
