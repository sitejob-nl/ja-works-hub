// Explicit opt-in smoke test against the deployed backend, with synthetic data.
// Demo mail is paused before any submit. Finally restores the pause and removes
// only this run's reports and screenshots. Never prints credentials or API keys.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { chromium } from '@playwright/test';

if (process.env.RUN_LIVE_FEEDBACK_QA !== '1') throw new Error('Set RUN_LIVE_FEEDBACK_QA=1 to run.');
const project = 'noaupcteygfvlyymqtew';
const url = `https://${project}.supabase.co`;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const client = () => createClient(url, key, options);
const demo = client(), superadmin = client(), anon = client();
const check = (result, label) => { if (result.error) throw new Error(`${label} failed (${result.error.code || 'request'}).`); return result.data; };
const login = async (c, prefix) => check(await c.auth.signInWithPassword({ email: process.env[`${prefix}_EMAIL`], password: process.env[`${prefix}_PASSWORD`] }), `${prefix} login`);
const demoSession = await login(demo, 'DEMO_ORG');
// The stored QA superadmin is deliberately banned. Do not reactivate it for QA.
const adminSession = process.env.FEEDBACK_QA_SKIP_SUPERADMIN === '1' ? null : await login(superadmin, 'QA_SUPERADMIN');
const profile = check(await demo.from('profiles').select('organization_id,role').eq('id', demoSession.user.id).single(), 'Demo profile');
assert.equal(profile.organization_id, process.env.DEMO_ORG_ID, 'Only the configured demo organization may be tested');
assert.equal(profile.role, 'admin');
// CLI credentials stay in memory, used only for fixture inspection and cleanup.
const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', project, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const serviceKey = keys.find(k => k.name === 'service_role')?.api_key;
assert.ok(serviceKey, 'Cleanup credentials must be available before creating fixtures');
const service = createClient(url, serviceKey, options);
const original = check(await demo.from('organizations').select('settings').eq('id', profile.organization_id).single(), 'Read demo settings').settings || {};
const hadPause = Object.hasOwn(original, 'outbound_paused');
const originalPause = original.outbound_paused;
const ids = [crypto.randomUUID(), crypto.randomUUID()];
const paths = ids.map(id => `${profile.organization_id}/${id}.png`);
let pauseSet = false;
let browser;
const call = async (body, token = demoSession.session.access_token) => {
  const response = await fetch(`${url}/functions/v1/feedback`, {
    method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(45000),
  });
  return { status: response.status, data: await response.json() };
};
try {
  check(await demo.from('organizations').update({ settings: { ...original, outbound_paused: { email: true, whatsapp: true } } }).eq('id', profile.organization_id), 'Pause demo outbound');
  pauseSet = true;
  const report = {
    id: ids[0], kind: 'bug', title: 'QA feedback release (synthetisch)', description: 'Automatische controle met uitsluitend testgegevens.',
    steps: 'Test openen', expected: 'Veilig opslaan',
    diagnostics: { page: '/kandidaten?token=private-test', capturedAt: new Date().toISOString(), browser: 'QA', viewport: '390x844', release: 'qa-release', online: true,
      errors: [{ at: new Date().toISOString(), name: 'Error', message: 'token=private-test email=qa@example.invalid', stack: '' }] },
    screenshot: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
    organization_id: '00000000-0000-4000-8000-000000000000', reporter_email: 'spoof@example.invalid',
  };
  assert.equal((await call({ action: 'submit', report }, null)).status, 401, 'Anonymous submit blocked');
  const first = await call({ action: 'submit', report });
  assert.equal(first.status, 200, 'Submit succeeds');
  assert.equal(first.data.email_status, 'paused', 'Real delivery must stop at the kill-switch');
  assert.ok(first.data.screenshot_path, 'Screenshot persisted');
  const duplicate = await call({ action: 'submit', report });
  assert.equal(duplicate.data.number, first.data.number, 'Identical retry returns original report');
  assert.equal(duplicate.data.email_status, 'paused');
  assert.equal((await call({ action: 'submit', report: { ...report, title: 'Changed retry' } })).status, 409);
  const stored = check(await demo.from('feedback_reports').select('*').eq('id', ids[0]).single(), 'Owner reads own report');
  assert.equal(stored.organization_id, profile.organization_id, 'Organization derived from authenticated identity');
  assert.equal(stored.reporter_email, demoSession.user.email, 'Reporter cannot be spoofed');
  assert.equal(stored.diagnostics.page, '/kandidaten');
  assert.ok(!JSON.stringify(stored.diagnostics).includes('private-test'), 'Diagnostic token removed');
  assert.ok(!JSON.stringify(stored.diagnostics).includes('qa@example.invalid'), 'Diagnostic email removed');
  const log = check(await service.from('communications').select('message_type,email_to,body').eq('feedback_report_id', ids[0]).single(), 'Concept log');
  assert.equal(log.message_type, 'concept');
  assert.deepEqual(log.email_to, ['info@sitejob.nl']);
  assert.ok(!log.body.includes(report.description), 'Org-wide log contains only a reference');
  assert.ok((await anon.from('feedback_reports').select('id').eq('id', ids[0])).error, 'Anonymous DB read blocked');
  assert.ok((await demo.from('feedback_reports').update({ email_status: 'sent' }).eq('id', ids[0])).error, 'Browser delivery status write blocked');
  assert.ok((await demo.storage.from('feedback-screenshots').download(paths[0])).error, 'Direct screenshot download blocked');
  assert.equal((await call({ action: 'detail', id: ids[0] })).status, 403, 'Internal user cannot use admin detail');
  let screenshotUrl;
  if (adminSession) {
    const detail = await call({ action: 'detail', id: ids[0] }, adminSession.session.access_token);
    assert.equal(detail.status, 200, 'SiteJob can inspect report');
    assert.ok(!Object.hasOwn(detail.data.report, 'request_hash'), 'Internal request hash excluded');
    screenshotUrl = detail.data.screenshotUrl;
  } else {
    screenshotUrl = check(await service.storage.from('feedback-screenshots').createSignedUrl(paths[0], 60), 'Service inspects QA screenshot').signedUrl;
    console.log('SKIP: real Superadmin login/detail (QA account remains deliberately blocked).');
  }
  const screenshot = await fetch(screenshotUrl);
  assert.equal(screenshot.status, 200, 'Signed screenshot works');
  assert.equal(Buffer.from(await screenshot.arrayBuffer()).toString('base64'), report.screenshot);
  const idea = await call({ action: 'submit', report: { ...report, id: ids[1], kind: 'idea', screenshot: null } });
  assert.equal(idea.status, 200);
  assert.equal(idea.data.email_status, 'paused');
  const ideaRow = check(await demo.from('feedback_reports').select('steps,expected,diagnostics').eq('id', ids[1]).single(), 'Idea saved');
  assert.equal(ideaRow.steps, ''); assert.equal(ideaRow.expected, ''); assert.deepEqual(ideaRow.diagnostics.errors, []);
  if (process.env.E2E_BASE_URL && adminSession) {
    browser = await chromium.launch();
    const page = await browser.newPage();
    // A fresh context also excludes old production service-worker caches.
    await page.goto(`${process.env.E2E_BASE_URL}/superadmin/feedback/${ids[0]}`);
    await page.getByLabel('E-mailadres', { exact: true }).fill(process.env.QA_SUPERADMIN_EMAIL);
    await page.getByLabel('Wachtwoord', { exact: true }).fill(process.env.QA_SUPERADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Inloggen als Superadmin', exact: true }).click();
    await page.waitForURL(`**/superadmin/feedback/${ids[0]}`);
    await page.getByText(report.title, { exact: true }).waitFor();
    const image = page.getByRole('img', { name: `Screenshot bij melding #${first.data.number}`, exact: true });
    await image.waitFor();
    await image.evaluate(img => img.decode());
    console.log('PASS: protected detail link survives Superadmin login; real screenshot renders.');
  }
  console.log('PASS: live bug/idea storage, screenshot, idempotence, identity, RLS, diagnostics and paused concept delivery. No email sent.');
} finally {
  await browser?.close();
  const cleanup = [];
  try { check(await service.storage.from('feedback-screenshots').remove(paths), 'Remove QA screenshots'); } catch (error) { cleanup.push(error); }
  try { check(await service.from('feedback_reports').delete().in('id', ids).eq('organization_id', profile.organization_id), 'Remove QA reports'); } catch (error) { cleanup.push(error); }
  if (pauseSet) {
    try {
      const current = check(await demo.from('organizations').select('settings').eq('id', profile.organization_id).single(), 'Read current demo settings').settings || {};
      if (hadPause) current.outbound_paused = originalPause; else delete current.outbound_paused;
      check(await demo.from('organizations').update({ settings: current }).eq('id', profile.organization_id), 'Restore demo pause');
    } catch (error) { cleanup.push(error); }
  }
  if (cleanup.length) throw new AggregateError(cleanup, 'QA cleanup needs attention');
  console.log('QA fixtures removed and original demo outbound setting restored.');
}
