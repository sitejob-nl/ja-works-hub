// Carerix GraphQL types — combines the public v1 "clean" schema (CXCompany,
// CXContact, CXCandidate, CXVacancy) with the legacy CR*-schema that holds the
// rich data we actually need for migration (matches, placements, documents,
// notes, etc.).
//
// CR*-fields require OAuth scope `urn:cx/cx5Wrapper:data:manage` (or per-resource
// equivalents). If a tenant doesn't have that scope, the corresponding cr*Page
// queries return an error — the runner catches it and marks the entity as skipped
// with a clear reason instead of failing the whole job.

export interface PageResponse<T> {
  items: T[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
  first: boolean;
  last: boolean;
  numberOfElements: number;
}

export interface EmailAddress {
  value?: string;
  primary?: boolean;
}

export interface PhoneNumber {
  value?: string;
  primary?: boolean;
  type?: string;
}

// =====================================================================
// v1 public schema ("clean" types) — what the smaller scopes expose.
// =====================================================================

export interface CXCompany {
  _id: string;
  name?: string;
  displayName?: string;
}

export interface CXContact {
  _id: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  company?: CXCompany;
  emailAddresses?: { items: EmailAddress[] };
}

export interface CXCandidate {
  _id: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  emailAddresses?: { items: EmailAddress[] };
}

export interface CXVacancy {
  _id: string;
  jobTitle?: string;
  displayName?: string;
}

export interface CXPlacement {
  _id: string;
  displayName?: string;
  candidate?: { _id: string };
  vacancy?: { _id: string };
}

// =====================================================================
// CR*-schema (legacy, but richer — matches Carerix 5 datamodel).
// Field lists below are the union of what we need + what introspection
// confirms is queryable. Unknown fields stay optional so partial schemas
// still parse.
// =====================================================================

export interface CRRef {
  _id: string;
  displayName?: string;
}

export interface CRStatusNode {
  _id: string;
  value?: string;
  parentNodes?: { items: CRStatusNode[] };
}

export interface CRStatusInfo {
  _id: string;
  label?: string;
  value?: string;
}

export interface CRMedium {
  _id: string;
  name?: string;
}

export interface CREmployee {
  _id: string;
  firstName?: string;
  lastName?: string;
  // Geen `displayName` op CREmployee — gebruik firstName + lastName.
  emailAddress?: string;
  phoneNumber?: string;
  emailAddresses?: { items: EmailAddress[] };
  phoneNumbers?: { items: PhoneNumber[] };
  applySource?: string;
  applyTags?: string[] | { items: { value?: string }[] };
  toStatusNode?: CRStatusNode;
  toUser?: CRRef;
  modificationDate?: string;
  creationDate?: string;
  birthDate?: string;
  nationality?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}

export interface CRJob {
  _id: string;
  // CRJob in Carerix gebruikt `name` (geen `title`) en `jobInformation`
  // (geen `description`).
  name?: string;
  templateName?: string;
  jobInformation?: string;
  toCompany?: { _id: string; name?: string };
  toUser?: { _id: string; name?: string };
  status?: number;
  statusDisplay?: string;
  modificationDate?: string;
  creationDate?: string;
  startDate?: string;
  endDate?: string;
  hourlyTariffInvoice?: number;
}

export interface CRPublication {
  _id: string;
  publicationStart?: string;
  publicationEnd?: string;
  toMedium?: CRMedium;
  toStatusNode?: CRStatusNode;
  toVacancy?: CRRef;
  toJob?: CRRef;
  modificationDate?: string;
}

export interface CRMatch {
  _id: string;
  // CRMatch gebruikt `fitScore` (geen matchScore) en `toVacancy` (geen
  // toPublication/toJob). statusInfo zit direct op het object.
  fitScore?: number;
  applySource?: string;
  applyMedium?: string;
  applyTags?: string[] | { items: { value?: string }[] };
  statusInfo?: CRStatusInfo;
  statusDisplay?: string;
  toEmployee?: { _id: string; firstName?: string; lastName?: string };
  toVacancy?: { _id: string; name?: string };
  owner?: { _id: string; name?: string };
  modificationDate?: string;
  creationDate?: string;
}

export interface CREmployment {
  _id: string;
  startDate?: string;
  endDate?: string;
  hourlyRate?: number;
  contractType?: string;
  hours?: number;
  toEmployee?: CRRef;
  toJob?: CRRef;
  toPublication?: CRRef;
  toCompany?: CRRef;
  toMatch?: CRRef;
  toStatusNode?: CRStatusNode;
  modificationDate?: string;
}

export interface CRAttachment {
  _id: string;
  fileName?: string;
  mimeType?: string;
  tag?: string;
  fileSize?: number;
  toEmployee?: CRRef;
  toCompany?: CRRef;
  toJob?: CRRef;
  toMatch?: CRRef;
  modificationDate?: string;
  creationDate?: string;
  // `content` is base64 — only fetched on-demand via crAttachment(_id) { content }
  content?: string;
}

export interface CRTodo {
  _id: string;
  type?: string; // 'note' | 'task' | 'meeting' | 'campaign' | etc.
  body?: string;
  subject?: string;
  dueDate?: string;
  toEmployee?: CRRef;
  toCompany?: CRRef;
  toContact?: CRRef;
  toMatch?: CRRef;
  toUser?: CRRef;
  modificationDate?: string;
  creationDate?: string;
}

// =====================================================================
// Sync orchestration
// =====================================================================

export type EntityName =
  | 'companies'
  | 'contacts'
  | 'candidates'
  | 'vacancies'
  | 'placements'
  | 'matches'
  | 'documents'
  | 'employment'
  | 'notes';

export const ALL_ENTITIES: EntityName[] = [
  'companies',
  'contacts',
  'candidates',
  'vacancies',
  'placements',
  'matches',
  'documents',
  'employment',
  'notes',
];

export const SUPPORTED_ENTITIES: EntityName[] = [
  'companies',
  'contacts',
  'candidates',
  'vacancies',
  'matches',
  'notes',
  // documents: CRAttachment heeft geen direct toEmployee in deze schema —
  // moet via per-kandidaat traversal (CREmployee.attachments). 2-pass nodig.
  // placements: crEmploymentPage bestaat niet in deze tenant — placements
  // worden gemodelleerd als CRMatch (status=geplaatst) of CRJob met toEmployee.
  // employment: CRWorkHistory bestaat niet als top-level query.
];

export const UNSUPPORTED_REASONS: Partial<Record<EntityName, string>> = {
  employment:
    'Carerix CRWorkHistory beschrijft eerdere werkgevers van de kandidaat. JA Werkt heeft hier geen doel-tabel voor.',
  placements:
    'crEmploymentPage bestaat niet in Carerix schema. Plaatsingen worden gemodelleerd als CRMatch met status=geplaatst — wordt afgeleid uit matches-import.',
  documents:
    'CRAttachment in deze tenant heeft geen direct toEmployee-veld. Documenten moeten via per-kandidaat traversal opgehaald worden (CREmployee.attachments). Aparte 2e-pass nodig.',
};

// Order matters — dependencies are processed first.
export const ENTITY_DEPENDENCIES: Record<EntityName, EntityName[]> = {
  companies: [],
  contacts: ['companies'],
  candidates: [],
  vacancies: ['companies'],
  matches: ['candidates', 'vacancies'],
  placements: ['candidates', 'vacancies', 'companies'],
  documents: ['candidates'],
  notes: ['candidates', 'companies'],
  employment: ['candidates'],
};
