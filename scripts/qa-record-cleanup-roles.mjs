// Explicit live/demo QA: credentials stay in memory, no invitations or messages.
// Load the demo env before running; optionally set E2E_BASE_URL and QA_API_ONLY=1.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const org = process.env.DEMO_ORG_ID;
assert.equal(org, '6dedabe4-f62c-479e-b5fc-ebfcb824d76f');
const url = process.env.VITE_SUPABASE_URL;
assert.equal(new URL(url).hostname, 'noaupcteygfvlyymqtew.supabase.co');
const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
let keys;
try {
  keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', 'noaupcteygfvlyymqtew', '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
} catch { throw new Error('Supabase CLI credentials are required for temporary QA accounts'); }
const serviceKey = keys.find(k => k.name === 'service_role')?.api_key;
assert.ok(serviceKey, 'Service key is available');
const client = key => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const service = client(serviceKey);
const marker = 'QA-cleanup-roles-' + randomUUID().slice(0, 8);
const records = [];
const users = [];
const check = async q => {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
};
const add = async (table, values) => {
  const { id } = await check(service.from(table).insert({ organization_id: org, ...values }).select('id').single());
  records.push([table, id]);
  return id;
};
const account = async (role, organization = org) => {
  const email = `${marker}-${randomUUID()}@example.invalid`;
  const password = randomUUID() + randomUUID();
  const { user } = await check(service.auth.admin.createUser({ email, password, email_confirm: true }));
  users.push(user.id);
  await check(service.from('profiles').insert({ id: user.id, organization_id: organization, email, full_name: marker, role }));
  const db = client(publicKey);
  await check(db.auth.signInWithPassword({ email, password }));
  return { id: user.id, email, password, db, role };
};
const denied = async (q, code) => {
  const result = await q;
  assert.equal(result.error?.code, code, 'Expected denial ' + code);
};
const browser = async actor => {
  console.log('Browser QA: ' + actor.role);
  const code = await new Promise(resolve => {
    const child = spawn('npx', ['playwright', 'test', '--config=playwright.record-cleanup.config.ts'], {
      env: { ...process.env, TEST_EMAIL: actor.email, TEST_PASSWORD: actor.password, QA_ROLE: actor.role }, stdio: 'inherit',
    });
    child.on('exit', resolve);
  });
  assert.equal(code, 0, actor.role + ' browser QA');
};

try {
  const company = await add('companies', { name: marker });
  const candidate = await add('candidates', { first_name: 'QA', last_name: marker });
  const vehicle = await add('vehicles', { license_plate: 'QA-' + randomUUID().slice(0, 6), brand: marker });
  const placement = () => add('placements', { company_id: company, candidate_id: candidate, start_date: '2026-09-14', function_name: marker });
  const fine = () => add('vehicle_fines', { vehicle_id: vehicle, fine_date: '2026-09-14', amount: 10, description: marker });
  const retained = await placement();
  const retainedFine = await fine();
  const invoice = await add('invoices', { company_id: company, invoice_number: marker, period_start: '2026-09-14', period_end: '2026-09-20' });
  await add('invoice_lines', { invoice_id: invoice, placement_id: retained, description: marker });

  for (const role of ['backoffice', 'intercedent']) {
    const actor = await account(role);
    const p = await placement();
    const child = await add('placement_hour_types', { placement_id: p, code: 'QA', description: marker });
    assert.equal(await check(actor.db.rpc('delete_placement_record', { p_placement_id: p })), p);
    assert.deepEqual(await check(service.from('placements').select('id').eq('id', p)), []);
    assert.deepEqual(await check(service.from('placement_hour_types').select('id').eq('id', child)), []);
    const audit = await check(service.from('audit_log').select('old_values,user_id').eq('table_name', 'placements').eq('record_id', p).eq('action', 'delete'));
    assert.ok(audit.some(a => a.user_id === actor.id && a.old_values?.id === p), 'Atomic audit retains actual deleted placement');
    const f = await fine();
    assert.equal((await check(actor.db.from('vehicle_fines').delete().eq('id', f).select('id'))).length, 1);
    // Hide financial reads even when the role normally has access.
    await check(service.from('user_permission_overrides').insert({ organization_id: org, user_id: actor.id, permission_key: 'finance.view', allowed: false }));
    assert.deepEqual(await check(actor.db.from('invoice_lines').select('id').eq('placement_id', retained)), []);
    assert.equal((await check(actor.db.rpc('get_placement_delete_impact', { p_placement_id: retained }))).invoiceLines, 1);
    await denied(actor.db.rpc('delete_placement_record', { p_placement_id: retained }), '23503');
    assert.equal((await check(service.from('invoice_lines').select('placement_id').eq('invoice_id', invoice)))[0].placement_id, retained);
    assert.deepEqual(await check(actor.db.from('placements').delete().eq('id', retained).select('id')), [], 'Cannot bypass guarded RPC');
    await check(service.from('user_permission_overrides').insert({ organization_id: org, user_id: actor.id, permission_key: 'placements.edit', allowed: false }));
    await denied(actor.db.rpc('get_placement_delete_impact', { p_placement_id: retained }), '42501');
    await denied(actor.db.rpc('delete_placement_record', { p_placement_id: retained }), '42501');
    await check(service.from('user_permission_overrides').delete().eq('user_id', actor.id).eq('permission_key', 'placements.edit'));
    await check(service.from('profiles').update({ is_active: false }).eq('id', actor.id));
    await denied(actor.db.rpc('delete_placement_record', { p_placement_id: retained }), '42501');
    assert.deepEqual(await check(actor.db.from('vehicle_fines').delete().eq('id', retainedFine).select('id')), []);
    await check(service.from('profiles').update({ is_active: true }).eq('id', actor.id));
    console.log('PASS ' + role + ': delete, cascade, audit, hidden invoice, direct-delete denial, revoked permission, inactive account');
    if (process.env.QA_API_ONLY !== '1') await browser(actor);
  }
  for (const role of ['finance', 'medewerker', 'opdrachtgever']) {
    const actor = await account(role);
    await check(service.from('user_permission_overrides').insert({ organization_id: org, user_id: actor.id, permission_key: 'placements.edit', allowed: true }));
    await denied(actor.db.rpc('get_placement_delete_impact', { p_placement_id: retained }), '42501');
    await denied(actor.db.rpc('delete_placement_record', { p_placement_id: retained }), '42501');
    assert.deepEqual(await check(actor.db.from('vehicle_fines').delete().eq('id', retainedFine).select('id')), []);
    console.log('PASS excluded role: ' + role);
  }
  for (const fn of ['get_placement_delete_impact', 'delete_placement_record']) {
    await denied(client(publicKey).rpc(fn, { p_placement_id: retained }), '42501');
  }
  console.log('PASS anonymous denial; tenant isolation is tested by qa-record-cleanup-isolation.sql');
  if (process.env.QA_API_ONLY !== '1') await browser({ role: 'admin', email: process.env.DEMO_ORG_EMAIL, password: process.env.DEMO_ORG_PASSWORD });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  const failures = [];
  // Auth/profile references must be cleared before removing the temporary tenant.
  for (const id of users) {
    try {
      // Preserve QA audit history, but release its reference to the temporary login.
      await check(service.from('audit_log').update({ user_id: null }).eq('user_id', id));
      await check(service.from('profiles').delete().eq('id', id));
      await check(service.auth.admin.deleteUser(id));
    } catch (e) { failures.push('QA account: ' + e.message); }
  }
  for (const [table, id] of records.reverse()) {
    try { await check(service.from(table).delete().eq('id', id)); }
    catch (e) { failures.push(table + ': ' + e.message); }
  }
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log('PASS all own QA accounts and server fixtures cleaned up');
}
