// Returns the GraphQL field list for ALL relevant Carerix types + the list of
// available page queries. Carerix exposes TWO parallel schemas:
//  - "clean" types (Company, Contact, Candidate) — minimal @preview fields
//  - legacy "cr*" types (CRCompany, CREmployee, CRContact, CRMatch, CRAttachment,
//    CRToDo, CRWorkHistory, CRPublication) — richer field set matching the
//    Carerix 5 data model.
//
// This endpoint dumps both so we can pick whichever schema has the data we need.

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

const TARGET_TYPES = [
  'Company',
  'Contact',
  'Candidate',
  'CRCompany',
  'CREmployee',
  'CRContact',
  'CRMatch',
  'CRPublication',
  'CRAttachment',
  'CRAttachmentData',
  'CRToDo',
  'CRNote',
  'CRTask',
  'CRWorkHistory',
  'CREmailAddress',
  'CRPhoneNumber',
  'CRAddress',
  'CREmployeeAttachment',
  'CREmployeeDocument',
];

const typeFragments = TARGET_TYPES.map(
  (t, i) => `t${i}: __type(name: "${t}") {
      name
      fields {
        name
        type { name kind ofType { name kind } }
      }
    }`,
).join('\n    ');

const INTROSPECT_QUERY = `
  query {
    queryRoot: __schema {
      queryType {
        fields {
          name
          type { name kind ofType { name kind } }
        }
      }
    }
    ${typeFragments}
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
    const data = await gql.query<Record<string, any>>(INTROSPECT_QUERY);

    const formatFields = (fields: Array<{ name: string; type: any }> | undefined) =>
      (fields ?? [])
        .map((f) => ({ name: f.name, type: simplifyType(f.type) }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const types: Record<string, unknown> = {};
    TARGET_TYPES.forEach((name, i) => {
      const node = data[`t${i}`];
      types[name] = node ? formatFields(node.fields) : null;
    });

    const allQueries = (data.queryRoot?.queryType?.fields ?? [])
      .map((f: any) => ({ name: f.name, type: simplifyType(f.type) }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    return jsonOk({ ok: true, types, queries: allQueries });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(`Introspect mislukt: ${msg}`, 400);
  }
});
