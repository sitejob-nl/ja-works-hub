import { AlertTriangle, ArrowUpCircle, CircleDot, Clock } from 'lucide-react';

export const priorityConfig: Record<string, { label: string; color: string; icon: typeof AlertTriangle; order: number }> = {
  critical: { label: 'Kritiek', color: 'bg-destructive/10 text-destructive border-destructive/20', icon: AlertTriangle, order: 0 },
  high: { label: 'Hoog', color: 'bg-orange-100 text-orange-700 border-orange-200', icon: ArrowUpCircle, order: 1 },
  medium: { label: 'Medium', color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: CircleDot, order: 2 },
  low: { label: 'Laag', color: 'bg-muted text-muted-foreground border-border', icon: Clock, order: 3 },
};

export const entityLinks: Record<string, (id: string) => string> = {
  candidate: (id) => `/kandidaten/${id}`,
  kandidaat: (id) => `/kandidaten/${id}`,
  employee: (id) => `/kandidaten/${id}`,
  opdrachtgever: (id) => `/opdrachtgevers/${id}`,
  vacancy: (id) => `/vacatures/${id}`,
  vacature: (id) => `/vacatures/${id}`,
  plaatsing: (id) => `/plaatsingen/${id}`,
  huis: (id) => `/huisvesting/${id}`,
  property: (id) => `/huisvesting/${id}`,
  auto: (id) => `/transport/${id}`,
  vehicle: (id) => `/transport/${id}`,
  contactpersoon: (id) => `/contacten/${id}`,
  talentpool: (id) => `/talentpools/${id}`,
  match: () => '/match-pipeline',
};

export const entityTypeLabels: Record<string, string> = {
  kandidaat: 'Kandidaat',
  opdrachtgever: 'Opdrachtgever',
  vacature: 'Vacature',
  plaatsing: 'Plaatsing',
  huis: 'Huisvesting',
  auto: 'Voertuig',
  contactpersoon: 'Contactpersoon',
  talentpool: 'Talentpool',
  candidate: 'Kandidaat',
  employee: 'Medewerker',
  vacancy: 'Vacature',
  property: 'Huisvesting',
  vehicle: 'Voertuig',
  match: 'Match',
};

/**
 * Selecteerbare entiteittypes voor een taak. Stuurt zowel de entity-picker
 * (welke tabel doorzoeken + hoe labelen) als de weergave aan. De `value` wordt
 * opgeslagen in recruiter_tasks.related_entity_type.
 */
export type TaskEntityType =
  | 'kandidaat'
  | 'opdrachtgever'
  | 'vacature'
  | 'plaatsing'
  | 'huis'
  | 'auto'
  | 'contactpersoon'
  | 'talentpool'
  | 'match';

export interface TaskEntityConfig {
  value: TaskEntityType;
  label: string;
  /** Supabase-tabel om in te zoeken */
  table: string;
  /** Kolommen/embeds die de picker selecteert */
  select: string;
  /** Kolommen waarop case-insensitive gezocht wordt (ilike OR) */
  searchColumns: string[];
  /** Bouwt het weergave-label voor één rij */
  getLabel: (row: any) => string;
  /** Optioneel extra filter op de query (bv. geen geanonimiseerde records) */
  applyFilter?: (query: any) => any;
}

const fullName = (first?: string | null, last?: string | null) =>
  [first, last].filter(Boolean).join(' ').trim();

export const TASK_ENTITY_TYPES: TaskEntityConfig[] = [
  {
    value: 'kandidaat',
    label: 'Kandidaat',
    table: 'candidates',
    select: 'id, first_name, last_name',
    searchColumns: ['first_name', 'last_name'],
    getLabel: (r) => fullName(r.first_name, r.last_name) || 'Onbekende kandidaat',
    applyFilter: (q) => q.is('anonymized_at', null),
  },
  {
    value: 'opdrachtgever',
    label: 'Opdrachtgever',
    table: 'companies',
    select: 'id, name',
    searchColumns: ['name'],
    getLabel: (r) => r.name || 'Onbekende opdrachtgever',
  },
  {
    value: 'vacature',
    label: 'Vacature',
    table: 'vacancies',
    select: 'id, title, location',
    searchColumns: ['title', 'location'],
    getLabel: (r) => [r.title, r.location].filter(Boolean).join(' · ') || 'Vacature',
  },
  {
    value: 'plaatsing',
    label: 'Plaatsing',
    table: 'placements',
    select: 'id, function_name, candidates(first_name, last_name), companies(name)',
    searchColumns: ['function_name'],
    getLabel: (r) => {
      const cand = fullName(r.candidates?.first_name, r.candidates?.last_name);
      return [r.function_name, cand, r.companies?.name].filter(Boolean).join(' · ') || 'Plaatsing';
    },
  },
  {
    value: 'huis',
    label: 'Huisvesting',
    table: 'properties',
    select: 'id, name, address_street, address_city',
    searchColumns: ['name', 'address_street', 'address_city'],
    getLabel: (r) =>
      r.name || [r.address_street, r.address_city].filter(Boolean).join(', ') || 'Woning',
  },
  {
    value: 'auto',
    label: 'Voertuig',
    table: 'vehicles',
    select: 'id, brand, model, license_plate',
    searchColumns: ['license_plate', 'brand', 'model'],
    getLabel: (r) =>
      [[r.brand, r.model].filter(Boolean).join(' '), r.license_plate].filter(Boolean).join(' · ') ||
      'Voertuig',
  },
  {
    value: 'contactpersoon',
    label: 'Contactpersoon',
    table: 'company_contacts',
    select: 'id, full_name',
    searchColumns: ['full_name'],
    getLabel: (r) => r.full_name || 'Contactpersoon',
  },
  {
    value: 'talentpool',
    label: 'Talentpool',
    table: 'talentpools',
    select: 'id, name',
    searchColumns: ['name'],
    getLabel: (r) => r.name || 'Talentpool',
  },
  {
    value: 'match',
    label: 'Match',
    table: 'matches',
    select: 'id, created_at, candidates!matches_candidate_id_fkey(first_name, last_name), vacancies!matches_vacancy_id_fkey(title, companies!vacancies_company_id_fkey(name))',
    searchColumns: ['id'],
    getLabel: (r) => {
      const cand = fullName(r.candidates?.first_name, r.candidates?.last_name);
      const vacancy = r.vacancies?.title;
      const company = r.vacancies?.companies?.name;
      return [cand, vacancy, company].filter(Boolean).join(' · ') || 'Match';
    },
  },
];

export const taskEntityConfig = (type?: string | null): TaskEntityConfig | undefined =>
  TASK_ENTITY_TYPES.find((t) => t.value === type);
