import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2';

export type EdgeUserRole = 'admin' | 'intercedent' | 'backoffice' | 'finance' | 'medewerker' | 'opdrachtgever';

export interface AuthenticatedProfile {
  user: User;
  userId: string;
  organizationId: string;
  role: EdgeUserRole | string;
}

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
  const authHeader = req.headers.get('Authorization');
  return Boolean(serviceKey && authHeader === `Bearer ${serviceKey}`);
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
