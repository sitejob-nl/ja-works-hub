import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2';

export type EdgeUserRole = 'admin' | 'intercedent' | 'backoffice' | 'finance' | 'medewerker' | 'opdrachtgever';
export type EdgePermissionKey =
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

export interface AuthenticatedProfile {
  user: User;
  userId: string;
  organizationId: string;
  role: EdgeUserRole | string;
}

const INTERNAL_FUNCTION_SECRET_HEADER = 'x-internal-function-secret';

const DEFAULT_PERMISSIONS: Record<EdgeUserRole, ReadonlySet<EdgePermissionKey>> = {
  admin: new Set<EdgePermissionKey>([
    'candidates.view', 'candidates.edit', 'candidates.screening.manage',
    'vacancies.view', 'vacancies.edit', 'matching.pipeline.view',
    'matching.status.update', 'matching.status.bulk_update', 'matching.drag_drop',
    'matching.feedback.write', 'matching.notify_candidates', 'matching.proposal.send',
    'matching.interview.confirm', 'placements.view', 'placements.edit',
    'finance.view', 'finance.manage', 'settings.manage', 'settings.permissions.manage',
  ]),
  intercedent: new Set<EdgePermissionKey>([
    'candidates.view', 'candidates.edit', 'candidates.screening.manage',
    'vacancies.view', 'vacancies.edit', 'matching.pipeline.view',
    'matching.status.update', 'matching.status.bulk_update', 'matching.drag_drop',
    'matching.feedback.write', 'matching.notify_candidates', 'matching.proposal.send',
    'matching.interview.confirm', 'placements.view', 'placements.edit',
  ]),
  backoffice: new Set<EdgePermissionKey>([
    'candidates.view', 'candidates.edit', 'candidates.screening.manage',
    'vacancies.view', 'matching.pipeline.view', 'matching.status.update',
    'matching.status.bulk_update', 'matching.drag_drop', 'matching.feedback.write',
    'matching.notify_candidates', 'matching.interview.confirm', 'placements.view',
    'placements.edit', 'finance.view',
  ]),
  finance: new Set<EdgePermissionKey>([
    'candidates.view', 'vacancies.view', 'matching.pipeline.view',
    'placements.view', 'finance.view', 'finance.manage',
  ]),
  medewerker: new Set<EdgePermissionKey>(),
  opdrachtgever: new Set<EdgePermissionKey>(),
};

export function createAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

export function jsonResponse(
  body: unknown,
  status = 200,
  corsHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function isServiceRoleRequest(req: Request): boolean {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const internalSecret = Deno.env.get('CARERIX_WORKER_SECRET');
  const authHeader = req.headers.get('Authorization');
  const internalSecretHeader = req.headers.get(INTERNAL_FUNCTION_SECRET_HEADER);
  return Boolean(
    (serviceKey && authHeader === `Bearer ${serviceKey}`) ||
      (internalSecret && internalSecretHeader === internalSecret),
  );
}

export function internalFunctionHeaders(): Record<string, string> {
  const internalSecret = Deno.env.get('CARERIX_WORKER_SECRET');
  return internalSecret ? { [INTERNAL_FUNCTION_SECRET_HEADER]: internalSecret } : {};
}

export function isInternalRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'intercedent' || role === 'backoffice' || role === 'finance';
}

export async function getAuthenticatedProfile(
  req: Request,
  corsHeaders: Record<string, string> = {},
): Promise<AuthenticatedProfile | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Authorization header ontbreekt' }, 401, corsHeaders);
  }

  if (isServiceRoleRequest(req)) {
    return jsonResponse({ error: 'Service-role token is niet toegestaan voor gebruikersacties' }, 401, corsHeaders);
  }

  const token = authHeader.substring('Bearer '.length).trim();
  if (!token) return jsonResponse({ error: 'Bearer token ontbreekt' }, 401, corsHeaders);

  const admin = createAdminClient();
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return jsonResponse({ error: 'Ongeldige of verlopen sessie' }, 401, corsHeaders);
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, organization_id, role')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (profileError || !profile?.organization_id) {
    return jsonResponse({ error: 'Geen geldig profiel gevonden' }, 403, corsHeaders);
  }

  return {
    user: userData.user,
    userId: userData.user.id,
    organizationId: profile.organization_id,
    role: profile.role,
  };
}

export async function requireInternalProfile(
  req: Request,
  corsHeaders: Record<string, string> = {},
): Promise<AuthenticatedProfile | Response> {
  const auth = await getAuthenticatedProfile(req, corsHeaders);
  if (auth instanceof Response) return auth;
  if (!isInternalRole(auth.role)) {
    return jsonResponse({ error: 'Onvoldoende rechten' }, 403, corsHeaders);
  }
  return auth;
}

export async function profileHasRolePermission(
  auth: AuthenticatedProfile,
  permission: EdgePermissionKey,
  admin: SupabaseClient = createAdminClient(),
): Promise<boolean> {
  if (auth.role === 'admin') return true;
  if (!isInternalRole(auth.role)) return false;

  const { data, error } = await admin
    .from('organizations')
    .select('settings')
    .eq('id', auth.organizationId)
    .maybeSingle();
  if (error || !data) return false;

  const rolePermissions = (data.settings as any)?.role_permissions?.[auth.role];
  if (Array.isArray(rolePermissions)) return rolePermissions.includes(permission);
  if (rolePermissions && typeof rolePermissions === 'object' && typeof rolePermissions[permission] === 'boolean') {
    return rolePermissions[permission] === true;
  }

  return DEFAULT_PERMISSIONS[auth.role as EdgeUserRole]?.has(permission) === true;
}

export async function requireRolePermission(
  req: Request,
  permission: EdgePermissionKey,
  corsHeaders: Record<string, string> = {},
): Promise<AuthenticatedProfile | Response> {
  const auth = await requireInternalProfile(req, corsHeaders);
  if (auth instanceof Response) return auth;
  if (!await profileHasRolePermission(auth, permission)) {
    return jsonResponse({ error: 'Onvoldoende rechten' }, 403, corsHeaders);
  }
  return auth;
}
