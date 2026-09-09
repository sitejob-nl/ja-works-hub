// Scoped fixture for connected page-assignment QA. Load credentials with
// node --env-file; never log sessions or copy secrets into evidence.
//
// T2 needs what the earlier intake fixtures do not have: one week with two
// employees, because the point of this ticket is that a delivered file can
// carry several people. It therefore creates its own synthetic QA client and
// week rather than consuming an existing fixture's untouched days.
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const projectUrl = 'https://noaupcteygfvlyymqtew.supabase.co';
const demoOrgId = '6dedabe4-f62c-479e-b5fc-ebfcb824d76f';
if (process.env.VITE_SUPABASE_URL !== projectUrl || process.env.DEMO_ORG_ID !== demoOrgId) {
  throw new Error('Expected the verified JA Werkt project and dedicated demo organization');
}
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const outputPath = process.env.HOURS_PAGES_FIXTURE_PATH;
const runId = process.env.HOURS_PAGES_RUN_ID;
const weekStart = process.env.HOURS_PAGES_WEEK_START ?? '2026-09-07';
if (!key) throw new Error('Missing publishable key');
if (!outputPath) throw new Error('Set HOURS_PAGES_FIXTURE_PATH');
if (!runId) throw new Error('Set HOURS_PAGES_RUN_ID to a unique marker for this run');

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
    const profile = unwrap(await account.client.from('profiles').select('id,organization_id,role,is_active')
      .eq('id', account.userId).single(), `${label} profile`);
    if (!profile.is_active || profile.organization_id !== demoOrgId || profile.role !== role) {
      throw new Error(`Unexpected ${label} profile`);
    }
  }
  const primaryId = process.env.DEMO_PORTAL_CANDIDATE_ID;
  const primary = unwrap(await demo.client.from('candidates').select('id,organization_id,auth_user_id')
    .eq('id', primaryId).single(), 'Demo portal candidate');
  if (primary.organization_id !== demoOrgId || primary.auth_user_id !== portal.userId) {
    throw new Error('Unexpected portal candidate');
  }
  // A second synthetic colleague, chosen deterministically so a rerun of the
  // same marker lands on the very same week and members.
  const others = unwrap(await demo.client.from('candidates').select('id').eq('organization_id', demoOrgId)
    .neq('id', primaryId).order('id', { ascending: true }).limit(1), 'Second demo candidate');
  if (!others.length) throw new Error('The demo organization needs a second candidate');
  const secondaryId = others[0].id;

  const access = unwrap(await demo.client.rpc('hours_get_module_access'), 'Module access');
  if (access.organization_id !== demoOrgId || access.enabled !== true) {
    throw new Error('The demo organization must have the hours module enabled');
  }

  const companyName = `Urenmodule QA ${runId}`;
  if (!companyName.startsWith('Urenmodule QA ')) throw new Error('Only synthetic QA clients');
  let company = unwrap(await demo.client.from('companies').select('id,name')
    .eq('organization_id', demoOrgId).eq('name', companyName).maybeSingle(), 'QA company lookup');
  if (!company) {
    company = unwrap(await demo.client.from('companies')
      .insert({ organization_id: demoOrgId, name: companyName, email: null })
      .select('id,name').single(), 'QA company');
  }
  const weekEnd = new Date(`${weekStart}T00:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  for (const candidateId of [primaryId, secondaryId]) {
    const existing = unwrap(await demo.client.from('placements').select('id')
      .eq('organization_id', demoOrgId).eq('company_id', company.id).eq('candidate_id', candidateId)
      .maybeSingle(), 'Placement lookup');
    if (!existing) {
      unwrap(await demo.client.from('placements').insert({
        organization_id: demoOrgId, company_id: company.id, candidate_id: candidateId,
        function_name: 'Synthetische urenmodule QA', start_date: weekStart,
        end_date: weekEnd.toISOString().slice(0, 10), status: 'actief',
      }).select('id').single(), 'Placement');
    }
  }

  const settings = unwrap(await demo.client.rpc('hours_get_company_settings', { p_company_id: company.id }), 'Settings');
  if (!settings.enabled) {
    unwrap(await demo.client.rpc('hours_set_company_settings', {
      p_company_id: company.id, p_expected_version: settings.version, p_enabled: true,
      p_submission_day_offset: 7, p_submission_time: '10:00',
      p_confirmation_day_offset: 8, p_confirmation_time: '12:00',
    }), 'Enable workflow');
  }
  const weeks = unwrap(await demo.client.rpc('hours_list_weeks', { p_week_start: weekStart }), 'Week list');
  let summary = weeks.weeks.find(item => item.company_id === company.id);
  if (!summary) {
    const created = unwrap(await demo.client.rpc('hours_create_week',
      { p_company_id: company.id, p_week_start: weekStart }), 'Create week');
    summary = { id: created.id ?? created.week_id ?? created.week?.id };
  }
  const week = unwrap(await demo.client.rpc('hours_get_week', { p_week_id: summary.id }), 'Week detail');
  if (week.workflow_enabled !== true || week.can_manage !== true) {
    throw new Error('The QA week must be enabled and manageable');
  }
  const primaryMember = week.members.find(item => item.candidate_id === primaryId);
  const secondaryMember = week.members.find(item => item.candidate_id === secondaryId);
  if (!primaryMember || !secondaryMember) throw new Error('The QA week needs both synthetic members');
  // Applying writes a day version permanently, so this run claims exactly one
  // untouched day. The take-over days only receive proposals and stay untouched.
  const applyDay = primaryMember.days.find(day => day.current_revision === null);
  const takeoverDays = secondaryMember.days.filter(day => day.current_revision === null).slice(0, 2);
  if (!applyDay || takeoverDays.length < 2) throw new Error('This QA week has too few untouched days');

  const sources = unwrap(await demo.client.rpc('hours_get_week_sources', { p_week_id: week.id }), 'Existing sources');

  const fixture = {
    verified: true, runId, organizationId: demoOrgId, organizationName: 'Demo Uitzendbureau Showroom',
    companyId: company.id, companyName: company.name,
    weekId: week.id, weekStart: week.week_start,
    primaryCandidateId: primaryId, primaryMemberId: primaryMember.id,
    secondaryCandidateId: secondaryId, secondaryMemberId: secondaryMember.id,
    applyDayId: applyDay.id, applyWorkDate: applyDay.work_date,
    takeoverDayIds: takeoverDays.map(day => day.id),
    takeoverWorkDates: takeoverDays.map(day => day.work_date),
    existingSourceCount: sources.sources.length,
    untouchedPrimaryDays: primaryMember.days.filter(day => day.current_revision === null).length,
    untouchedSecondaryDays: secondaryMember.days.filter(day => day.current_revision === null).length,
  };
  mkdirSync(dirname(resolve(outputPath)), { recursive: true });
  writeFileSync(resolve(outputPath), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(JSON.stringify(fixture, null, 2));
} finally {
  for (const client of clients) await client.auth.signOut({ scope: 'local' });
}
