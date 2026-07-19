import type { Database } from '@/integrations/supabase/types';

type UserRole = Database['public']['Enums']['user_role'];

export type AssigneeProfile = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  role?: UserRole | string | null;
};

/**
 * Rollen die accountmanager van een match mogen zijn — dezelfde set als
 * `is_internal_user()` in de RLS-policies. De portaalrollen (`medewerker`,
 * `opdrachtgever`) horen hier bewust niet bij: een kandidaat of klantcontact
 * hoort niet als interne verantwoordelijke aan een match te hangen.
 *
 * Let op het niveau van de garantie: dit filtert de keuzelijst en de
 * standaardwaarde in de UI. Er staat (nog) géén CHECK of trigger op
 * `matches.assigned_to`, dus een directe API-schrijfactie door een interne
 * gebruiker kan er nog steeds een portaalprofiel in zetten. Wie dat écht dicht
 * wil zetten, heeft een DB-constraint nodig.
 */
export const INTERNAL_ASSIGNEE_ROLES: UserRole[] = ['admin', 'intercedent', 'backoffice', 'finance'];

export const isInternalAssigneeRole = (role?: string | null): boolean =>
  INTERNAL_ASSIGNEE_ROLES.includes(role as UserRole);

export const assigneeName = (profile?: { full_name?: string | null; email?: string | null } | null): string =>
  profile?.full_name || profile?.email || 'Onbekend';

/**
 * Standaard-accountmanager bij het aanmaken van een match: degene die de match maakt,
 * omdat die persoon de kandidaat net beoordeeld heeft en de opvolging in handen heeft.
 * Valt terug op de vacature-eigenaar wanneer de aanmaker geen interne gebruiker is
 * (portaal-sollicitatie) of ontbreekt (publieke website-sollicitatie).
 */
export const resolveDefaultMatchAssignee = (input: {
  currentUserId?: string | null;
  currentUserRole?: string | null;
  vacancyCreatedBy?: string | null;
}): string | null => {
  if (input.currentUserId && isInternalAssigneeRole(input.currentUserRole)) return input.currentUserId;
  return input.vacancyCreatedBy ?? null;
};
