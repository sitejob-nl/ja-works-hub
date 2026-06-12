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
  name?: string; // Carerix gebruikt `name`, niet `value`.
}

export interface CRDataNode {
  _id: string;
  value?: string;
  label?: string;
  tag?: string;
}

export interface CRMedium {
  _id: string;
  name?: string;
}

export interface CREmployee {
  _id: string;
  employeeID?: string | number;
  firstName?: string;
  lastName?: string;
  lastNamePrefix?: string;
  fullFirstNames?: string;
  emailAddress?: string;
  emailAddressBusiness?: string;
  phoneNumber?: string;
  mobileNumber?: string;
  phoneNumberBusiness?: string;
  mobileNumberBusiness?: string;
  notes?: string;
  additionalInfo?: Record<string, unknown>;
  sofiNumber?: string;
  adminSofiNumber?: string;
  systemLanguage?: string;
  language?: string;
  toLanguageNode?: CRDataNode;
  toNationalityNode?: CRDataNode;
  toHomeCountryNode?: CRDataNode;
  toBirthCountryNode?: CRDataNode;
  toIdentificationCountryNode?: CRDataNode;
  toStatusNode?: CRStatusNode;
  toUser?: CRRef;
  modificationDate?: string;
  creationDate?: string;
  birthDate?: string;
  homeStreet?: string;
  homeNumber?: string;
  homeNumberSuffix?: string;
  homePostalCode?: string;
  homeCity?: string;
}

export interface CRJob {
  _id: string;
  name?: string;
  templateName?: string;
  jobInformation?: string;
  memoGeneral?: string;
  toEmployee?: { _id: string; firstName?: string; lastName?: string };
  toCompany?: { _id: string; name?: string };
  toVacancy?: { _id: string };
  toMatch?: { _id: string };
  toUser?: { _id: string; name?: string };
  status?: number;
  statusDisplay?: string;
  modificationDate?: string;
  creationDate?: string;
  startDate?: string;
  endDate?: string;
  hourlyTariffInvoice?: number;
  hourlyWageGross?: number;
  hoursPerWeek?: number;
  totalWorkHours?: number;
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
  toVacancy?: { _id: string; jobTitle?: string };
  owner?: { _id: string; name?: string };
  modificationDate?: string;
  creationDate?: string;
}

// CRWorkHistory in Carerix = één plaatsing/dienstverband-record voor JA Werkt
// (kandidaat heeft via JA Werkt bij klant X gewerkt van Y tot Z).
export interface CRWorkHistory {
  _id: string;
  startDate?: string;
  endDate?: string;
  employer?: string;
  function?: string;
  workLocation?: string;
  endReason?: string;
  creationDate?: string;
  modificationDate?: string;
  toEmployee?: { _id: string };
  toCompany?: { _id: string };
}

export interface CRAttachment {
  _id: string;
  fileName?: string;
  downloadName?: string;
  displayName?: string;
  mimeType?: string;
  attachmentMimeType?: string;
  tag?: string;
  label?: string;
  fileSize?: number;
  attachmentSize?: number;
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
  subject?: string;
  message?: string; // body content (CRToDo gebruikt `message`, geen `body`)
  startDate?: string;
  endDate?: string;
  deadline?: string;
  statusDisplay?: string;
  isNote?: boolean;
  isTask?: boolean;
  isMeeting?: boolean;
  isEmail?: boolean;
  toEmployee?: CRRef;
  toCompany?: CRRef;
  toContact?: CRRef;
  toMatch?: CRRef;
  toJob?: CRRef;
  modificationDate?: string;
  creationDate?: string;
}

export interface CRNote {
  _id: string;
  subject?: string;
  // GraphQL-query aliases the tenant-specific body field to `message`.
  message?: string;
  toEmployee?: CRRef;
  toCompany?: CRRef;
  toContact?: CRRef;
  toMatch?: CRRef;
  toJob?: CRRef;
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
  'placements',
  'documents',
  'notes',
];

// `employment` als aparte entiteit hebben we niet meer nodig: in JA Werkt's
// Carerix-tenant is alle historie eigen plaatsings-historie, en die zit in
// CRWorkHistory → wordt geïmporteerd als `placements`.
export const UNSUPPORTED_REASONS: Partial<Record<EntityName, string>> = {
  employment:
    'Werkhistorie wordt gemigreerd via de Plaatsingen-import (CRWorkHistory bevat alle JA Werkt-plaatsingen).',
};

// Order matters — dependencies are processed first.
export const ENTITY_DEPENDENCIES: Record<EntityName, EntityName[]> = {
  companies: [],
  contacts: ['companies'],
  candidates: [],
  vacancies: ['companies'],
  matches: ['candidates', 'vacancies'],
  placements: ['candidates', 'companies'],
  documents: ['candidates'],
  notes: ['candidates', 'companies', 'matches', 'vacancies', 'contacts'],
  employment: [],
};
