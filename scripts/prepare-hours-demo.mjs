// Scoped connected-QA fixture. Load credentials with Node --env-file; never log sessions.
import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const projectUrl = 'https://noaupcteygfvlyymqtew.supabase.co';
const demoOrgId = '6dedabe4-f62c-479e-b5fc-ebfcb824d76f';
const jaOrgId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const command = process.argv[2] ?? 'verify';
if (!['verify', 'seed', 'configure', 'restore-communications'].includes(command)) throw new Error('Use verify, seed, configure or restore-communications');
if (process.env.VITE_SUPABASE_URL !== projectUrl || process.env.DEMO_ORG_ID !== demoOrgId) {
  throw new Error('Expected the verified JA Werkt project and dedicated demo organization');
}
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!key) throw new Error('Missing publishable key');
const clients = [];
function unwrap(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.code ?? 'request failed'}`);
  return result.data;
}
async function login(prefix) {
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) throw new Error(`Missing ${prefix} credentials`);
  const client = createClient(projectUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
  clients.push(client);
  const auth = unwrap(await client.auth.signInWithPassword({ email, password }), `${prefix} login`);
  return { client, userId: auth.user.id };
}
try {
  const demo = await login('DEMO_ORG');
  const portal = await login('DEMO_PORTAL');
  const sa = ['verify', 'configure'].includes(command) ? await login('QA_SUPERADMIN') : null;
  for (const [label, account, role] of [['demo', demo, 'admin'], ['portal', portal, 'medewerker']]) {
    const profile = unwrap(await account.client.from('profiles').select('id,organization_id,role,is_active').eq('id', account.userId).single(), `${label} profile`);
    if (!profile.is_active || profile.organization_id !== demoOrgId || profile.role !== role) throw new Error(`Unexpected ${label} profile`);
  }
  if (sa) {
    if (unwrap(await sa.client.rpc('is_superadmin'), 'SaaS role') !== true) throw new Error('SaaS admin required');
    const saProfile = unwrap(await sa.client.from('profiles').select('is_active').eq('id', sa.userId).maybeSingle(), 'SaaS profile');
    if (saProfile && !saProfile.is_active) throw new Error('Inactive SaaS profile');
  }
  const candidateId = process.env.DEMO_PORTAL_CANDIDATE_ID;
  const candidate = unwrap(await demo.client.from('candidates').select('id,organization_id,auth_user_id').eq('id', candidateId).single(), 'Demo portal candidate');
  if (candidate.organization_id !== demoOrgId || candidate.auth_user_id !== portal.userId) throw new Error('Unexpected portal candidate');
  const result = { verified: true, organizationId: demoOrgId, organizationName: 'Demo Uitzendbureau Showroom', jaOrganizationName: 'JA Werkt', candidateId, weekStart: '2026-09-07' };
  if (command === 'seed') {
    const runId = process.env.HOURS_DEMO_RUN_ID;
    if (!runId || !/^[a-z0-9-]{1,60}$/.test(runId)) throw new Error('Set a unique HOURS_DEMO_RUN_ID');
    if (!process.env.HOURS_DEMO_FIXTURE_PATH) throw new Error('Set HOURS_DEMO_FIXTURE_PATH');
    const outputPath = resolve(process.env.HOURS_DEMO_FIXTURE_PATH);
    const previousFixture = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, 'utf8')) : null;
    const organization = unwrap(await demo.client.from('organizations').select('settings').eq('id', demoOrgId).single(), 'Demo communication settings');
    result.outboundPauseBefore = previousFixture?.outboundPauseBefore ?? organization.settings?.outbound_paused ?? null;
    unwrap(await demo.client.from('organizations').update({ settings: { ...organization.settings, outbound_paused: { email: true, whatsapp: true } } }).eq('id', demoOrgId), 'Pause demo communication');
    const name = `Urenmodule QA ${runId}`;
    let company = unwrap(await demo.client.from('companies').select('id,name').eq('organization_id', demoOrgId).eq('name', name).maybeSingle(), 'Fixture lookup');
    if (!company) company = unwrap(await demo.client.from('companies').insert({ organization_id: demoOrgId, name, email: null }).select('id,name').single(), 'Fixture company');
    let placement = unwrap(await demo.client.from('placements').select('id').eq('organization_id', demoOrgId).eq('company_id', company.id).eq('candidate_id', candidateId).maybeSingle(), 'Fixture placement lookup');
    if (!placement) placement = unwrap(await demo.client.from('placements').insert({ organization_id: demoOrgId, company_id: company.id, candidate_id: candidateId, function_name: 'Synthetische urenmodule QA', start_date: '2026-09-07', end_date: '2026-09-13', status: 'actief' }).select('id').single(), 'Fixture placement');
    Object.assign(result, { runId, companyId: company.id, companyName: company.name, placementId: placement.id });
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (command === 'restore-communications') {
    if (!process.env.HOURS_DEMO_FIXTURE_PATH) throw new Error('Set HOURS_DEMO_FIXTURE_PATH');
    const fixture = JSON.parse(readFileSync(resolve(process.env.HOURS_DEMO_FIXTURE_PATH), 'utf8'));
    if (fixture.organizationId !== demoOrgId || !Object.hasOwn(fixture, 'outboundPauseBefore')) throw new Error('No verified original demo communication state');
    const organization = unwrap(await demo.client.from('organizations').select('settings').eq('id', demoOrgId).single(), 'Demo communication settings');
    const pause = organization.settings?.outbound_paused;
    if (pause?.email !== true || pause?.whatsapp !== true) throw new Error('Demo communication pause changed meanwhile; do not overwrite');
    unwrap(await demo.client.from('organizations').update({ settings: { ...organization.settings, outbound_paused: fixture.outboundPauseBefore } }).eq('id', demoOrgId), 'Restore demo communication');
    result.communicationStateRestored = true;
  }
  if (command === 'configure') {
    for (const [organizationId, enabled] of [[jaOrgId, false], [demoOrgId, true]]) {
      const flag = unwrap(await sa.client.rpc('sa_set_hours_workflow_enabled', { p_organization_id: organizationId, p_enabled: enabled }), 'Configure hours module');
      if (flag.organization_id !== organizationId || flag.enabled !== enabled) throw new Error('Unexpected module result');
    }
    result.moduleState = { jaWerkt: false, demo: true };
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  for (const client of clients) await client.auth.signOut({ scope: 'local' });
}
