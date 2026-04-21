// Carerix GraphQL v1 public API types.
// Confirmed via docs.carerix.io; fields in v1 are minimal compared to the
// private/legacy cr* schema. Missing fields (phone, BSN, IBAN, address, notes,
// documents, placement.company, etc.) stay NULL in the JA Werkt DB so staff can
// fill them in later.

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

export type EntityName =
  | 'companies'
  | 'contacts'
  | 'candidates'
  | 'documents'
  | 'employment'
  | 'vacancies'
  | 'placements'
  | 'notes';

export const ALL_ENTITIES: EntityName[] = [
  'companies',
  'contacts',
  'candidates',
  'documents',
  'employment',
  'vacancies',
  'placements',
  'notes',
];

// Entities we can actually import using the v1 public API.
export const SUPPORTED_ENTITIES: EntityName[] = ['companies', 'contacts', 'candidates'];

// Entities that are not exposed by Carerix v1 public schema (or that we can't map
// because of required fields in the JA Werkt schema without a full record).
export const UNSUPPORTED_REASONS: Partial<Record<EntityName, string>> = {
  documents: 'Niet beschikbaar in Carerix v1 publieke API (geen document query).',
  employment: 'Werkhistorie-veld bestaat niet in Carerix v1 publieke schema.',
  vacancies: 'Vacancy mist company-ref in v1 schema; kan niet in JA Werkt (company_id verplicht).',
  placements:
    'Placement mist company-ref in v1 schema; kan niet in JA Werkt (company_id verplicht).',
  notes: 'Notities zijn niet beschikbaar in Carerix v1 publieke API.',
};

export const ENTITY_DEPENDENCIES: Record<EntityName, EntityName[]> = {
  companies: [],
  contacts: ['companies'],
  candidates: [],
  documents: ['candidates'],
  employment: ['candidates'],
  vacancies: [],
  placements: ['candidates', 'vacancies'],
  notes: ['candidates', 'companies', 'contacts'],
};
