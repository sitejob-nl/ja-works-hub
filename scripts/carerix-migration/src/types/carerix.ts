// Carerix GraphQL response types

export interface CRPageResponse<T> {
  items: T[];
  totalElements: number;
}

export interface CREmployee {
  _id: string;
  _kind: string;
  employeeID?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  initials?: string;
  emailAddress?: string;
  phoneNumber?: string;
  mobileNumber?: string;
  dateOfBirth?: string;
  gender?: string;
  nationality?: string;
  socialSecurityNumber?: string;
  iban?: string;
  bankAccountNumber?: string;
  street?: string;
  houseNumber?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  notes?: string;
  memo?: string;
  additionalInfo?: Record<string, any>;
  statusInfo?: CRStatusInfo;
  attachments?: { items: CRAttachment[] };
  workHistories?: { items: CRWorkHistory[] };
  toCompany?: { _id: string };
}

export interface CRCompany {
  _id: string;
  _kind: string;
  name?: string;
  displayName?: string;
  kvkNumber?: string;
  btwNumber?: string;
  vatNumber?: string;
  emailAddress?: string;
  phoneNumber?: string;
  website?: string;
  street?: string;
  houseNumber?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  notes?: string;
  memo?: string;
  contacts?: { items: CRContact[] };
}

export interface CRContact {
  _id: string;
  _kind: string;
  firstName?: string;
  lastName?: string;
  emailAddress?: string;
  phoneNumber?: string;
  mobileNumber?: string;
  jobTitle?: string;
  functionTitle?: string;
  toCompany?: { _id: string };
}

export interface CRAttachment {
  _id: string;
  _kind: string;
  filePath?: string;
  label?: string;
  content?: string; // base64 encoded
  toTypeNode?: { _id: string; value: string };
}

export interface CRWorkHistory {
  _id: string;
  _kind: string;
  employer?: string;
  jobTitle?: string;
  startDate?: string;
  endDate?: string;
  contractType?: string;
  notes?: string;
}

export interface CRPublication {
  _id: string;
  _kind: string;
  title?: string;
  jobTitle?: string;
  description?: string;
  body?: string;
  requirements?: string;
  city?: string;
  location?: string;
  hourlyRate?: number;
  salary?: string;
  publicationStart?: string;
  publicationEnd?: string;
  statusInfo?: CRStatusInfo;
  toVacancy?: { _id: string; toCompany?: { _id: string } };
  toCompany?: { _id: string };
  toMedium?: { code: string };
}

export interface CRMatch {
  _id: string;
  _kind: string;
  startDate?: string;
  endDate?: string;
  hourlyRate?: number;
  functionTitle?: string;
  jobTitle?: string;
  notes?: string;
  statusInfo?: CRStatusInfo;
  toEmployee?: { _id: string };
  toCompany?: { _id: string };
  toPublication?: { _id: string };
}

export interface CRToDo {
  _id: string;
  _kind: string;
  subject?: string;
  description?: string;
  notes?: string;
  dueDate?: string;
  completedDate?: string;
  status?: string;
  type?: string; // note, task, meeting, campaign
  toEmployee?: { _id: string };
  toCompany?: { _id: string };
  toContact?: { _id: string };
  toUser?: { _id: string };
}

export interface CRStatusInfo {
  _id?: number;
  _kind: string;
  value?: string;
  code?: string;
}

export interface CRDataNode {
  _id: string;
  value: string;
  type?: { identifier: string; typeID: number };
}

export interface MigrationContext {
  carerixClient: import('../lib/carerix-client.js').CarerixClient;
  supabase: import('@supabase/supabase-js').SupabaseClient;
  idMapper: import('../lib/id-mapper.js').IdMapper;
  logger: import('winston').Logger;
  progress: import('../lib/progress.js').ProgressTracker;
  config: import('../config.js').Config;
}
