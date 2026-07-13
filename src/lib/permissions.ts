import type { Database } from '@/integrations/supabase/types';

export type UserRole = Database['public']['Enums']['user_role'];

export type PermissionKey =
  | 'candidates.view'
  | 'candidates.edit'
  | 'candidates.screening.manage'
  | 'vacancies.view'
  | 'vacancies.edit'
  | 'matching.pipeline.view'
  | 'matching.status.update'
  | 'matching.status.bulk_update'
  | 'matching.drag_drop'
  | 'matching.feedback.write'
  | 'matching.notify_candidates'
  | 'matching.proposal.send'
  | 'matching.interview.confirm'
  | 'placements.view'
  | 'placements.edit'
  | 'finance.view'
  | 'finance.manage'
  | 'settings.manage'
  | 'settings.permissions.manage';

export type RolePermissionMatrix = Record<UserRole, Record<PermissionKey, boolean>>;
export type UserPermissionOverrides = Partial<Record<PermissionKey, boolean>>;
export type PermissionSource = 'admin' | 'user_allow' | 'user_deny' | 'role';

export type PermissionDefinition = {
  key: PermissionKey;
  label: string;
  description: string;
  group: 'Kandidaten' | 'Vacatures' | 'Matching' | 'Plaatsingen' | 'Finance' | 'Instellingen';
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  intercedent: 'Intercedent',
  backoffice: 'Backoffice',
  finance: 'Finance',
  medewerker: 'Medewerkerportaal',
  opdrachtgever: 'Opdrachtgeverportaal',
};

export const CONFIGURABLE_ROLES: UserRole[] = ['admin', 'intercedent', 'backoffice', 'finance', 'medewerker', 'opdrachtgever'];

export const PERMISSIONS: PermissionDefinition[] = [
  { key: 'candidates.view', label: 'Kandidaten bekijken', description: 'Kandidaatlijsten en dossiers openen.', group: 'Kandidaten' },
  { key: 'candidates.edit', label: 'Kandidaten bewerken', description: 'Profielvelden en kandidaatstatus aanpassen.', group: 'Kandidaten' },
  { key: 'candidates.screening.manage', label: 'Screening beheren', description: 'Screening invullen, afronden en opnieuw analyseren.', group: 'Kandidaten' },
  { key: 'vacancies.view', label: 'Vacatures bekijken', description: 'Vacatures en matchlijsten openen.', group: 'Vacatures' },
  { key: 'vacancies.edit', label: 'Vacatures beheren', description: 'Vacatures aanmaken en aanpassen.', group: 'Vacatures' },
  { key: 'matching.pipeline.view', label: 'Pipeline bekijken', description: 'Matchpipeline en matchdetails openen.', group: 'Matching' },
  { key: 'matching.status.update', label: 'Matchstatus wijzigen', description: 'Een individuele match naar een andere status zetten.', group: 'Matching' },
  { key: 'matching.status.bulk_update', label: 'Bulkstatus wijzigen', description: 'Meerdere geselecteerde matches tegelijk verplaatsen.', group: 'Matching' },
  { key: 'matching.drag_drop', label: 'Kanban slepen', description: 'Matches via drag-and-drop tussen pipelinekolommen verplaatsen.', group: 'Matching' },
  { key: 'matching.feedback.write', label: 'Feedback vastleggen', description: 'Afwijsredenen en statusnotities op een match opslaan.', group: 'Matching' },
  { key: 'matching.notify_candidates', label: 'Kandidaten notificeren', description: 'Bulknotificaties vanuit de matchpipeline aanmaken.', group: 'Matching' },
  { key: 'matching.proposal.send', label: 'Voorstelmail sturen', description: 'Kandidaatvoorstellen naar opdrachtgevers versturen.', group: 'Matching' },
  { key: 'matching.interview.confirm', label: 'Afspraak definitief maken', description: 'Definitieve afspraakgegevens opslaan en mails met ICS sturen.', group: 'Matching' },
  { key: 'placements.view', label: 'Plaatsingen bekijken', description: 'Plaatsingen en plaatsingsdetails openen.', group: 'Plaatsingen' },
  { key: 'placements.edit', label: 'Plaatsingen beheren', description: 'Plaatsingen aanmaken en aanpassen.', group: 'Plaatsingen' },
  { key: 'finance.view', label: 'Finance bekijken', description: 'Uren, facturen en financiële analyses bekijken.', group: 'Finance' },
  { key: 'finance.manage', label: 'Finance beheren', description: 'Financiële instellingen en goedkeuringen wijzigen.', group: 'Finance' },
  { key: 'settings.manage', label: 'Instellingen beheren', description: 'Organisatie- en module-instellingen aanpassen.', group: 'Instellingen' },
  { key: 'settings.permissions.manage', label: 'Rechten beheren', description: 'Rolrechten aanpassen voor de organisatie.', group: 'Instellingen' },
];

export const ALL_PERMISSION_KEYS = PERMISSIONS.map((permission) => permission.key);
export const INDIVIDUALLY_CONFIGURABLE_ROLES: UserRole[] = ['intercedent', 'backoffice', 'finance'];

const defaults = (enabled: PermissionKey[]): Record<PermissionKey, boolean> => {
  const set = new Set(enabled);
  return Object.fromEntries(ALL_PERMISSION_KEYS.map((key) => [key, set.has(key)])) as Record<PermissionKey, boolean>;
};

export const DEFAULT_ROLE_PERMISSIONS: RolePermissionMatrix = {
  admin: defaults(ALL_PERMISSION_KEYS),
  intercedent: defaults([
    'candidates.view',
    'candidates.edit',
    'candidates.screening.manage',
    'vacancies.view',
    'vacancies.edit',
    'matching.pipeline.view',
    'matching.status.update',
    'matching.status.bulk_update',
    'matching.drag_drop',
    'matching.feedback.write',
    'matching.notify_candidates',
    'matching.proposal.send',
    'matching.interview.confirm',
    'placements.view',
    'placements.edit',
  ]),
  backoffice: defaults([
    'candidates.view',
    'candidates.edit',
    'candidates.screening.manage',
    'vacancies.view',
    'matching.pipeline.view',
    'matching.status.update',
    'matching.status.bulk_update',
    'matching.drag_drop',
    'matching.feedback.write',
    'matching.notify_candidates',
    'matching.interview.confirm',
    'placements.view',
    'placements.edit',
    'finance.view',
  ]),
  finance: defaults([
    'candidates.view',
    'vacancies.view',
    'matching.pipeline.view',
    'placements.view',
    'finance.view',
    'finance.manage',
  ]),
  medewerker: defaults([]),
  opdrachtgever: defaults([]),
};

const isRole = (value: string): value is UserRole => Object.prototype.hasOwnProperty.call(DEFAULT_ROLE_PERMISSIONS, value);
const isPermission = (value: string): value is PermissionKey => ALL_PERMISSION_KEYS.includes(value as PermissionKey);

export function normalizeRolePermissions(raw: unknown): RolePermissionMatrix {
  const matrix = structuredClone(DEFAULT_ROLE_PERMISSIONS) as RolePermissionMatrix;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return matrix;

  for (const [role, permissions] of Object.entries(raw as Record<string, unknown>)) {
    if (!isRole(role)) continue;
    if (role === 'admin') continue;

    if (Array.isArray(permissions)) {
      const enabled = new Set(permissions.filter((permission): permission is PermissionKey => typeof permission === 'string' && isPermission(permission)));
      for (const key of ALL_PERMISSION_KEYS) matrix[role][key] = enabled.has(key);
      continue;
    }

    if (permissions && typeof permissions === 'object') {
      for (const [key, enabled] of Object.entries(permissions as Record<string, unknown>)) {
        if (isPermission(key) && typeof enabled === 'boolean') matrix[role][key] = enabled;
      }
    }
  }

  for (const key of ALL_PERMISSION_KEYS) matrix.admin[key] = true;
  return matrix;
}

export function roleHasPermission(role: UserRole | string | null | undefined, permission: PermissionKey, raw?: unknown): boolean {
  if (!role || !isRole(role)) return false;
  if (role === 'admin') return true;
  return normalizeRolePermissions(raw)[role][permission] === true;
}

export function normalizeUserPermissionOverrides(raw: unknown): UserPermissionOverrides {
  const normalized: UserPermissionOverrides = {};

  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue;
      const permission = (row as Record<string, unknown>).permission_key;
      const allowed = (row as Record<string, unknown>).allowed;
      if (typeof permission === 'string' && isPermission(permission) && typeof allowed === 'boolean') {
        normalized[permission] = allowed;
      }
    }
    return normalized;
  }

  if (!raw || typeof raw !== 'object') return normalized;
  for (const [permission, allowed] of Object.entries(raw as Record<string, unknown>)) {
    if (isPermission(permission) && typeof allowed === 'boolean') normalized[permission] = allowed;
  }
  return normalized;
}

export function effectivePermissionDecision(
  role: UserRole | string | null | undefined,
  permission: PermissionKey,
  rolePermissions?: unknown,
  userOverrides?: unknown,
): { allowed: boolean; source: PermissionSource } {
  if (role === 'admin') return { allowed: true, source: 'admin' };

  if (role && INDIVIDUALLY_CONFIGURABLE_ROLES.includes(role as UserRole)) {
    const overrides = normalizeUserPermissionOverrides(userOverrides);
    if (Object.prototype.hasOwnProperty.call(overrides, permission)) {
      const allowed = overrides[permission] === true;
      return { allowed, source: allowed ? 'user_allow' : 'user_deny' };
    }
  }

  return {
    allowed: roleHasPermission(role, permission, rolePermissions),
    source: 'role',
  };
}

export function userHasPermission(
  role: UserRole | string | null | undefined,
  permission: PermissionKey,
  rolePermissions?: unknown,
  userOverrides?: unknown,
): boolean {
  return effectivePermissionDecision(role, permission, rolePermissions, userOverrides).allowed;
}

export function serializeUserPermissionOverrides(raw: unknown): UserPermissionOverrides {
  return normalizeUserPermissionOverrides(raw);
}

export function serializeRolePermissions(matrix: RolePermissionMatrix): Record<UserRole, Record<PermissionKey, boolean>> {
  const serialized = {} as Record<UserRole, Record<PermissionKey, boolean>>;
  for (const role of CONFIGURABLE_ROLES) {
    serialized[role] = { ...matrix[role] };
  }
  return serialized;
}

export function permissionGroups() {
  return PERMISSIONS.reduce((groups, permission) => {
    groups[permission.group] = [...(groups[permission.group] ?? []), permission];
    return groups;
  }, {} as Record<PermissionDefinition['group'], PermissionDefinition[]>);
}
