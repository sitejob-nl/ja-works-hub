// Scoped fixture for connected intake QA. Load credentials with node --env-file;
// never log sessions or copy secrets into evidence. This helper only reads: it
// creates no company, week, day, source or proposal, and it changes no settings.
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const projectUrl = 'https://noaupcteygfvlyymqtew.supabase.co';
const demoOrgId = '6dedabe4-f62c-479e-b5fc-ebfcb824d76f';
if (process.env.VITE_SUPABASE_URL !== projectUrl || process.env.DEMO_ORG_ID !== demoOrgId) {
  throw new Error('Expected the verified JA Werkt project and dedicated demo organization');
}
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const outputPath = process.env.HOURS_INTAKE_FIXTURE_PATH;
const companyName = process.env.HOURS_INTAKE_COMPANY;
if (!key) throw new Error('Missing publishable key');
if (!outputPath) throw new Error('Set HOURS_INTAKE_FIXTURE_PATH');
if (!companyName?.startsWith('Urenmodule QA ')) throw new Error('Point HOURS_INTAKE_COMPANY at a synthetic QA company');

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
  for (const [label, account, role] of [['demo', demo, 'admin'], ['portal', portal, 'medewerker']]) {
    const profile = unwrap(await account.client.from('profiles').select('id,organization_id,role,is_active').eq('id', account.userId).single(), `${label} profile`);
    if (!profile.is_active || profile.organization_id !== demoOrgId || profile.role !== role) throw new Error(`Unexpected ${label} profile`);
  }
  const candidateId = process.env.DEMO_PORTAL_CANDIDATE_ID;
  const candidate = unwrap(await demo.client.from('candidates').select('id,organization_id,auth_user_id').eq('id', candidateId).single(), 'Demo portal candidate');
  if (candidate.organization_id !== demoOrgId || candidate.auth_user_id !== portal.userId) throw new Error('Unexpected portal candidate');

  const access = unwrap(await demo.client.rpc('hours_get_module_access'), 'Module access');
  if (access.organization_id !== demoOrgId || access.enabled !== true) throw new Error('The demo organization must have the hours module enabled');

  const company = unwrap(await demo.client.from('companies').select('id,name').eq('organization_id', demoOrgId).eq('name', companyName).single(), 'QA company');
  const weeks = unwrap(await demo.client.rpc('hours_list_weeks', { p_week_start: null }), 'Week list');
  const summary = weeks.weeks.find(item => item.company_id === company.id);
  if (!summary) throw new Error('The QA company has no prepared week');
  const week = unwrap(await demo.client.rpc('hours_get_week', { p_week_id: summary.id }), 'Week detail');
  if (week.workflow_enabled !== true || week.can_manage !== true) throw new Error('The QA company workflow must be enabled and manageable');

  const member = week.members.find(item => item.candidate_id === candidateId);
  if (!member) throw new Error('The portal candidate is not a member of this week');
  // A day nobody has filled in yet, so previous evidence rows stay exactly as they are.
  const target = member.days.find(day => day.current_revision === null);
  if (!target) throw new Error('No untouched day left in this week; use another QA week');

  const sources = unwrap(await demo.client.rpc('hours_get_week_sources', { p_week_id: week.id }), 'Existing sources');

  const fixture = {
    verified: true, organizationId: demoOrgId, organizationName: 'Demo Uitzendbureau Showroom',
    companyId: company.id, companyName: company.name, candidateId,
    weekId: week.id, weekStart: week.week_start,
    dayId: target.id, workDate: target.work_date,
    existingSourceCount: sources.sources.length,
    untouchedDayCount: member.days.filter(day => day.current_revision === null).length,
  };
  mkdirSync(dirname(resolve(outputPath)), { recursive: true });
  writeFileSync(resolve(outputPath), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(JSON.stringify(fixture, null, 2));
} finally {
  for (const client of clients) await client.auth.signOut({ scope: 'local' });
}
