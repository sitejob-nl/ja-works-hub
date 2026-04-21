// Store / read / clear Carerix OAuth2 credentials for an organization.
// All requests are POST; the `action` field in the body determines behaviour.
// Auth required: admin role in the caller's organization.

import {
  corsHeaders,
  createAdminClient,
  getCallerProfile,
  jsonError,
  jsonOk,
} from '../_shared/carerix/helpers.ts';
import { discoverTokenEndpoint, fetchCarerixAccessToken } from '../_shared/carerix/auth.ts';

interface RequestBody {
  action: 'get' | 'connect' | 'disconnect';
  client_id?: string;
  client_secret?: string;
  instance_url?: string;
  token_endpoint?: string;
  scope?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('Method not allowed', 405);

  const caller = await getCallerProfile(req);
  if (!caller) return jsonError('Unauthorized', 401);
  if (caller.profile.role !== 'admin') return jsonError('Alleen admins mogen Carerix koppelen', 403);

  const admin = createAdminClient();
  const orgId = caller.profile.organization_id;
  const body = (await req.json().catch(() => ({}))) as RequestBody;

  try {
    if (body.action === 'get') {
      const { data } = await admin
        .from('carerix_config')
        .select(
          'id, client_id, instance_url, token_endpoint, scope, is_connected, connected_at, last_test_at, last_test_ok, last_test_error, last_test_total_companies',
        )
        .eq('organization_id', orgId)
        .maybeSingle();
      return jsonOk({ config: data ?? null });
    }

    if (body.action === 'disconnect') {
      await admin.from('carerix_config').delete().eq('organization_id', orgId);
      return jsonOk({ ok: true });
    }

    if (body.action === 'connect') {
      if (!body.client_id || !body.client_secret || !body.instance_url) {
        return jsonError('client_id, client_secret en instance_url zijn verplicht', 400);
      }

      const scope =
        body.scope ||
        [
          'urn:cx/core:data/companies:read',
          'urn:cx/core:data/contacts:read',
          'urn:cx/core:data/candidates:read',
          'urn:cx/activities:data/notes:read',
          'urn:cx/activities:data/tasks:read',
          'urn:cx/core:data/placements:read',
          'urn:cx/core:data/vacancies:read',
          'urn:cx/core:data/matches:read',
        ].join(' ');
      const tokenEndpoint = body.token_endpoint || (await discoverTokenEndpoint(body.instance_url));

      // Validate credentials immediately.
      try {
        await fetchCarerixAccessToken({
          client_id: body.client_id,
          client_secret: body.client_secret,
          token_endpoint: tokenEndpoint,
          scope,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonError(`OAuth-test mislukt: ${msg}`, 400);
      }

      const { error } = await admin.from('carerix_config').upsert(
        {
          organization_id: orgId,
          client_id: body.client_id,
          client_secret: body.client_secret,
          token_endpoint: tokenEndpoint,
          instance_url: body.instance_url,
          scope,
          is_connected: true,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id' },
      );
      if (error) return jsonError(`Opslaan mislukt: ${error.message}`, 500);

      return jsonOk({ ok: true, token_endpoint: tokenEndpoint });
    }

    return jsonError('Onbekende action', 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(msg, 500);
  }
});
