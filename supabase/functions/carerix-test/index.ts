// Test Carerix connection: fetch OAuth token + do a minimal GraphQL query.
// Updates carerix_config.last_test_* fields.

import {
  corsHeaders,
  createAdminClient,
  getCallerProfile,
  jsonError,
  jsonOk,
  loadCarerixCredentials,
} from '../_shared/carerix/helpers.ts';
import { fetchCarerixAccessToken } from '../_shared/carerix/auth.ts';
import { CarerixGraphQLClient } from '../_shared/carerix/client.ts';
import { connectionTestQuery } from '../_shared/carerix/queries.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('Method not allowed', 405);

  const caller = await getCallerProfile(req);
  if (!caller) return jsonError('Unauthorized', 401);
  if (caller.profile.role !== 'admin') return jsonError('Alleen admins', 403);

  const admin = createAdminClient();
  const orgId = caller.profile.organization_id;

  const recordResult = async (ok: boolean, error?: string, total?: number) => {
    await admin
      .from('carerix_config')
      .update({
        last_test_at: new Date().toISOString(),
        last_test_ok: ok,
        last_test_error: error ?? null,
        last_test_total_companies: total ?? null,
      })
      .eq('organization_id', orgId);
  };

  try {
    const creds = await loadCarerixCredentials(admin, orgId);
    if (!creds) return jsonError('Geen Carerix-verbinding gevonden voor deze organisatie', 404);

    const token = await fetchCarerixAccessToken(creds);
    const gql = new CarerixGraphQLClient(token);
    const data = await gql.query<{ companyPage: { totalElements: number } }>(connectionTestQuery());

    const total = data.companyPage?.totalElements ?? 0;
    await recordResult(true, undefined, total);

    return jsonOk({ ok: true, totalCompanies: total });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordResult(false, msg);
    return jsonError(`Test mislukt: ${msg}`, 400);
  }
});
