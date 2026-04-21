// Carerix v1 record → JA Werkt insert payload.
// Unknown fields (phone, KVK, BTW, address, DOB, BSN, IBAN, etc.) are left NULL
// so JA Werkt staff can fill them in manually later.

import type { CXCandidate, CXCompany, CXContact, CXVacancy } from './types.ts';

function firstEmail(container: { items?: Array<{ value?: string }> } | undefined): string | null {
  const items = container?.items;
  if (!items || items.length === 0) return null;
  return items[0]?.value ?? null;
}

export function mapCompany(c: CXCompany, orgId: string) {
  return {
    name: c.name || c.displayName || 'Onbekend bedrijf',
    organization_id: orgId,
    is_active: true,
    // All other fields (kvk_number, btw_number, email, phone, website, address_*)
    // are left NULL — Carerix v1 doesn't expose them.
  };
}

export function mapContact(c: CXContact, companyId: string, orgId: string) {
  const firstName = c.firstName ?? null;
  const lastName = c.lastName ?? null;
  const fullName =
    c.displayName ||
    [firstName, lastName].filter(Boolean).join(' ').trim() ||
    'Onbekend';

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

export function mapVacancy(v: CXVacancy, orgId: string) {
  return {
    title: v.jobTitle || v.displayName || 'Onbekende vacature',
    status: 'gesloten',
    hourly_rate: 0,
    organization_id: orgId,
    // company_id stays NULL — v1 schema doesn't expose vacancy.company.
  };
}
