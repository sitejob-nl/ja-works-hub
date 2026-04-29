// Carerix → JA Werkt insert payload mappers.
//
// v1 mappers (mapCompany/mapContact/mapCandidate/mapVacancy) take the minimal
// CX*-types. CR mappers take the richer CR*-types and populate more fields.
// All mappers leave unknown fields NULL so JA Werkt staff can fill them in later.

import type {
  CRAttachment,
  CREmployee,
  CREmployment,
  CRJob,
  CRMatch,
  CRPublication,
  CRTodo,
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

export function mapCREmployee(e: CREmployee, orgId: string): Record<string, unknown> {
  const email = e.emailAddress || firstEmail(e.emailAddresses);
  const phone = e.phoneNumber || firstPhone(e.phoneNumbers);
  const status = mapStatus(statusMaps.candidate, statusValue(e.toStatusNode), 'nieuw');

  return {
    first_name: e.firstName || 'Onbekend',
    last_name: e.lastName || 'Onbekend',
    email,
    phone,
    date_of_birth: isoDay(e.birthDate),
    nationality: e.nationality ?? null,
    address_city: e.city ?? null,
    address_postal: e.postalCode ?? null,
    address_country: e.country ?? null,
    status,
    source: e.applySource || 'carerix',
    compliance_status: 'incompleet',
    organization_id: orgId,
  };
}

export function mapCRJobToVacancy(job: CRJob, companyId: string, orgId: string) {
  const status = mapStatus(statusMaps.vacancy, job.statusDisplay, 'gesloten');
  return {
    company_id: companyId,
    title: job.name || job.templateName || 'Onbekende vacature',
    description: job.jobInformation ?? null,
    hourly_rate: job.hourlyTariffInvoice ?? null,
    required_count: 1,
    status,
    start_date: isoDay(job.startDate),
    end_date: isoDay(job.endDate),
    organization_id: orgId,
  };
}

export function mapCRMatch(
  m: CRMatch,
  candidateId: string,
  vacancyId: string,
  orgId: string,
): Record<string, unknown> {
  const rawStatus = m.statusInfo?.value || m.statusInfo?.label || m.statusDisplay;
  const status = mapMatchStatus(rawStatus);
  return {
    candidate_id: candidateId,
    vacancy_id: vacancyId,
    organization_id: orgId,
    status,
    match_score: m.fitScore ?? null,
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

export function mapCREmployment(
  e: CREmployment,
  candidateId: string,
  companyId: string,
  orgId: string,
  vacancyId?: string,
  matchId?: string,
): Record<string, unknown> {
  const status = mapStatus(statusMaps.placement, statusValue(e.toStatusNode), 'afgerond');
  const startDate = isoDay(e.startDate);
  if (!startDate) {
    throw new Error('CREmployment zonder startDate kan niet als placement geïmporteerd worden');
  }

  return {
    candidate_id: candidateId,
    company_id: companyId,
    vacancy_id: vacancyId ?? null,
    match_id: matchId ?? null,
    function_name: e.toJob?.displayName || 'Onbekende functie',
    hourly_rate: e.hourlyRate ?? 0,
    cao_hours: e.hours ?? null,
    start_date: startDate,
    end_date: isoDay(e.endDate),
    status,
    organization_id: orgId,
  };
}

export function mapCRAttachmentMetadata(
  a: CRAttachment,
  candidateId: string,
  orgId: string,
): Record<string, unknown> {
  const isCv = isCvType(a.tag) || isCvType(a.fileName);
  const docType = isCv ? 'overig' : mapDocumentType(a.tag);

  return {
    candidate_id: candidateId,
    name: a.fileName || a.tag || 'Carerix bijlage',
    type: docType,
    status: 'geldig',
    source: 'carerix',
    file_path: null, // filled in by a separate content-fetch pass
    organization_id: orgId,
  };
}

export function mapCRTodoToNote(
  t: CRTodo,
  relatedEntityId: string,
  relatedEntityType: string,
  createdByUserId: string,
  orgId: string,
): Record<string, unknown> | null {
  const body = [t.subject, t.body].filter(Boolean).join('\n\n').trim();
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
