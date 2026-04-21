// Shared HTTP + Supabase helpers for Carerix edge functions.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function jsonOk(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function createAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

// Authenticate a request via the user's JWT. Returns { user, profile } or null.
export async function getCallerProfile(req: Request): Promise<{
  userId: string;
  profile: { id: string; organization_id: string; role: string };
} | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const admin = createAdminClient();
  const { data: userData, error } = await admin.auth.getUser(authHeader.substring(7));
  if (error || !userData.user) return null;

  const { data: profile } = await admin
    .from('profiles')
    .select('id, organization_id, role')
    .eq('id', userData.user.id)
    .single();

  if (!profile) return null;
  return { userId: userData.user.id, profile };
}

// Fetch decrypted Carerix credentials from the RPC.
export async function loadCarerixCredentials(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{
  client_id: string;
  client_secret: string;
  token_endpoint: string;
  instance_url: string;
  scope: string;
} | null> {
  const { data, error } = await admin.rpc('get_carerix_token', { p_org_id: organizationId });
  if (error) throw new Error(`get_carerix_token RPC failed: ${error.message}`);
  if (!data || data.length === 0) return null;
  const row = data[0];
  return {
    client_id: row.client_id,
    client_secret: row.decrypted_client_secret,
    token_endpoint: row.token_endpoint,
    instance_url: row.instance_url,
    scope: row.scope,
  };
}
