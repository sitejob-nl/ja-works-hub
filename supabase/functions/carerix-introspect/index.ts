// Returns the GraphQL field list for Company / Contact / Candidate types using
// introspection. Helps discover which fields the current OAuth scope actually
// exposes — critical because Carerix' public docs only show @preview fields
// while the @all scope unlocks additional ones.

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

const INTROSPECT_QUERY = `
  query {
    company: __type(name: "Company") {
      fields {
        name
        type { name kind ofType { name kind } }
      }
    }
    contact: __type(name: "Contact") {
      fields {
        name
        type { name kind ofType { name kind } }
      }
    }
    candidate: __type(name: "Candidate") {
      fields {
        name
        type { name kind ofType { name kind } }
      }
    }
  }
`;

function simplifyType(t: any): string {
  if (!t) return 'Unknown';
  if (t.name) return t.name;
  if (t.kind === 'NON_NULL' && t.ofType) return `${simplifyType(t.ofType)}!`;
  if (t.kind === 'LIST' && t.ofType) return `[${simplifyType(t.ofType)}]`;
  return t.kind || 'Unknown';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError('Method not allowed', 405);

  const caller = await getCallerProfile(req);
  if (!caller) return jsonError('Unauthorized', 401);
  if (caller.profile.role !== 'admin') return jsonError('Alleen admins', 403);

  const admin = createAdminClient();
  const orgId = caller.profile.organization_id;

  try {
    const creds = await loadCarerixCredentials(admin, orgId);
    if (!creds) return jsonError('Geen Carerix-verbinding gevonden', 404);

    const token = await fetchCarerixAccessToken(creds);
    const gql = new CarerixGraphQLClient(token);
    const data = await gql.query<{
      company: { fields: Array<{ name: string; type: any }> } | null;
      contact: { fields: Array<{ name: string; type: any }> } | null;
      candidate: { fields: Array<{ name: string; type: any }> } | null;
    }>(INTROSPECT_QUERY);

    const format = (fields: Array<{ name: string; type: any }> | undefined) =>
      (fields ?? [])
        .map((f) => ({ name: f.name, type: simplifyType(f.type) }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return jsonOk({
      ok: true,
      company: format(data.company?.fields),
      contact: format(data.contact?.fields),
      candidate: format(data.candidate?.fields),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(`Introspect mislukt: ${msg}`, 400);
  }
});
