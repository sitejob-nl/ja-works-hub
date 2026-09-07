import type { Database } from '@/integrations/supabase/types';

/**
 * Mappen op opdrachtgeverdocumenten — pure helpers, los van Supabase/React.
 *
 * Wie een map mag zien wordt in de database beslist (RLS op de map, op de
 * documentrij en op het bestand in de bucket). De frontend krijgt dus alleen
 * zichtbare mappen en documenten binnen; deze helpers doen het groeperen en
 * het benoemen van de toegangsregel, niet het afdwingen ervan.
 */

export type UserRole = Database['public']['Enums']['user_role'];

export type CompanyDocumentFolder = {
  id: string;
  key: string;
  label: string;
  sort_order: number;
  is_default: boolean;
  allowed_roles: UserRole[];
  required_permission: string | null;
};

/** Interne rollen die een map kunnen zien; portaal- en facility-rollen nooit. */
export const FOLDER_ROLES: readonly UserRole[] = ['admin', 'intercedent', 'backoffice', 'finance'];

/** Rollen die per map aan- of uitgezet kunnen worden; admin staat altijd aan. */
export const CONFIGURABLE_FOLDER_ROLES: readonly UserRole[] = ['intercedent', 'backoffice', 'finance'];

export const FOLDER_ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  intercedent: 'Intercedent',
  backoffice: 'Backoffice',
  finance: 'Finance',
};

/** De enige rechtensleutel die de UI aanbiedt; sluit aan op de rechtenmatrix. */
export const FINANCE_PERMISSION = 'finance.view';

/** Een map is afgeschermd als niet elke interne rol hem zonder extra recht ziet. */
export function isRestrictedFolder(folder: Pick<CompanyDocumentFolder, 'allowed_roles' | 'required_permission'>): boolean {
  if (folder.required_permission) return true;
  return FOLDER_ROLES.some((role) => !folder.allowed_roles.includes(role));
}

/** Korte omschrijving van wie de map ziet, voor het mapkopje en de instellingen. */
export function describeFolderAccess(folder: Pick<CompanyDocumentFolder, 'allowed_roles' | 'required_permission'>): string {
  const roles = FOLDER_ROLES.filter((role) => folder.allowed_roles.includes(role));
  const roleText = roles.length === FOLDER_ROLES.length
    ? 'Alle interne rollen'
    : roles.map((role) => FOLDER_ROLE_LABELS[role] ?? role).join(', ');
  if (folder.required_permission === FINANCE_PERMISSION) {
    return `${roleText} met het recht Finance bekijken`;
  }
  if (folder.required_permission) {
    return `${roleText} met het recht ${folder.required_permission}`;
  }
  return roleText;
}

/** Zet een rol aan of uit; admin blijft altijd staan en de volgorde blijft vast. */
export function toggleFolderRole(current: readonly UserRole[], role: UserRole, enabled: boolean): UserRole[] {
  const set = new Set<UserRole>(current);
  set.add('admin');
  if (role === 'admin') return FOLDER_ROLES.filter((r) => set.has(r));
  if (enabled) set.add(role);
  else set.delete(role);
  return FOLDER_ROLES.filter((r) => set.has(r));
}

export type FolderGroup<TDoc> = {
  folder: CompanyDocumentFolder | null;
  docs: TDoc[];
};

/**
 * Groepeert documenten per zichtbare map, in mapvolgorde. Lege mappen blijven
 * staan (wie de map mag zien, ziet hem ook leeg). Documenten waarvan de map
 * niet in de lijst zit — hoort niet voor te komen, RLS verbergt dan ook de
 * documentrij — komen achteraan in een groep zonder map, zodat er nooit iets
 * stilletjes uit beeld valt.
 */
export function groupDocumentsByFolder<TDoc extends { company_document_folder_id?: string | null }>(
  docs: readonly TDoc[],
  folders: readonly CompanyDocumentFolder[],
): FolderGroup<TDoc>[] {
  const ordered = [...folders].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, 'nl'));
  const byFolder = new Map<string, TDoc[]>(ordered.map((f) => [f.id, []]));
  const orphans: TDoc[] = [];
  for (const doc of docs) {
    const bucket = doc.company_document_folder_id ? byFolder.get(doc.company_document_folder_id) : undefined;
    if (bucket) bucket.push(doc);
    else orphans.push(doc);
  }
  const groups: FolderGroup<TDoc>[] = ordered.map((folder) => ({ folder, docs: byFolder.get(folder.id) ?? [] }));
  if (orphans.length > 0) groups.push({ folder: null, docs: orphans });
  return groups;
}

/**
 * Welke map het formulier voorstelt bij een gekozen documenttype: de
 * standaardmap van het type als die zichtbaar is, anders de standaardmap van
 * de organisatie, anders de eerste zichtbare map.
 */
export function suggestFolderId(
  type: { default_folder_id?: string | null } | undefined,
  folders: readonly CompanyDocumentFolder[],
): string {
  const visible = new Set(folders.map((f) => f.id));
  if (type?.default_folder_id && visible.has(type.default_folder_id)) return type.default_folder_id;
  const fallback = folders.find((f) => f.is_default) ?? folders[0];
  return fallback?.id ?? '';
}
