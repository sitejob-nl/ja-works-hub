// Opt-in QA: synthetic reports owned by the configured demo user. No mail sends.
// Exercises the status helper with a service client as a white-box fixture;
// the public set-status endpoint must reject this non-superadmin demo session.
// Never activates or impersonates the deliberately blocked QA superadmin.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { changeFeedbackStatus } from '../supabase/functions/feedback/resolution.ts';

if (process.env.RUN_LIVE_FEEDBACK_QA !== '1') throw new Error('Explicit RUN_LIVE_FEEDBACK_QA=1 required.');
const project = 'noaupcteygfvlyymqtew', url = `https://${project}.supabase.co`;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const demo = createClient(url, key, options);
const check = (result, label) => { if (result.error) throw new Error(`${label} failed (${result.error.code || 'request'}).`); return result.data; };
const session = check(await demo.auth.signInWithPassword({ email: process.env.DEMO_ORG_EMAIL, password: process.env.DEMO_ORG_PASSWORD }), 'Demo login');
const profile = check(await demo.from('profiles').select('organization_id,role').eq('id', session.user.id).single(), 'Profile');
assert.equal(profile.organization_id, process.env.DEMO_ORG_ID);
const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', project, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const serviceKey = keys.find(k => k.name === 'service_role')?.api_key;
assert.ok(serviceKey, 'Cleanup credentials required before fixtures');
const service = createClient(url, serviceKey, options);
const id = crypto.randomUUID();
let browser;
const call = async (body, token = session.session.access_token) => {
  const response = await fetch(`${url}/functions/v1/feedback`, { method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  return { status: response.status, data: await response.json() };
};
try {
  const report = check(await service.from('feedback_reports').insert({ id, organization_id: profile.organization_id, submitted_by: session.user.id,
    reporter_name: 'QA', reporter_email: session.user.email, kind: 'bug', title: 'QA persoonlijke terugkoppeling (synthetisch)',
    description: 'Geautomatiseerde controle met alleen testgegevens.', request_hash: 'qa-resolution', diagnostics: {} }).select('number').single(), 'Fixture');
  const input = { id, revision: 0, status: 'resolved', resolution: 'De synthetische bug is opgelost. Je kunt weer opslaan.' };
  assert.equal((await call({ action: 'my-notifications' }, null)).status, 401);
  assert.equal((await call({ action: 'set-status', ...input })).status, 403, 'Internal user cannot resolve');
  assert.ok((await demo.from('feedback_reports').update({ status: 'resolved' }).eq('id', id)).error, 'No browser writes');
  const first = await changeFeedbackStatus(service, session.user.id, input);
  assert.equal(first.changed, true);
  const notified = await call({ action: 'my-notifications' });
  assert.equal(notified.status, 200);
  assert.equal(notified.data.reports.filter(r => r.id === id).length, 1);
  assert.equal(notified.data.reports.find(r => r.id === id).resolution, input.resolution);
  if (process.env.E2E_BASE_URL) {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${process.env.E2E_BASE_URL}/login`);
    await expect(page.getByText('Log in om verder te gaan', { exact: true })).toBeVisible();
    await page.getByLabel('E-mailadres', { exact: true }).fill(process.env.DEMO_ORG_EMAIL);
    await page.getByLabel('Wachtwoord', { exact: true }).fill(process.env.DEMO_ORG_PASSWORD);
    await page.getByRole('button', { name: 'Inloggen', exact: true }).click();
    const skip = page.getByRole('button', { name: 'Overslaan', exact: true });
    const bell = page.getByRole('button', { name: 'Notificaties', exact: true });
    await expect(skip.or(bell).first()).toBeVisible({ timeout: 15000 });
    if (await skip.isVisible()) await skip.click();
    await bell.click();
    const ack = page.waitForResponse(response => response.url().endsWith('/functions/v1/feedback') && response.request().postDataJSON()?.action === 'acknowledge');
    await page.getByRole('button').filter({ hasText: `Bug #${report.number} is opgelost` }).click();
    assert.equal((await ack).status(), 200);
    await expect(page).toHaveURL(new RegExp(`/feedback/${id}$`));
    await expect(page.getByText(input.resolution, { exact: true })).toBeVisible();
    console.log('PASS: real mobile notification -> owner detail -> explanation -> read acknowledgement.');
  } else {
    assert.equal((await call({ action: 'acknowledge', id, revision: 1, dismiss: false })).status, 200);
  }
  const detail = await call({ action: 'my-detail', id });
  assert.ok(detail.data.report.resolution_read_at);
  assert.ok(!Object.hasOwn(detail.data.report, 'request_hash'));
  const originalDate = detail.data.report.resolved_at;
  const duplicate = await changeFeedbackStatus(service, session.user.id, input);
  assert.equal(duplicate.changed, false); assert.equal(duplicate.report.resolved_at, originalDate);
  assert.ok(duplicate.report.resolution_read_at);
  await changeFeedbackStatus(service, session.user.id, { id, revision: 1, status: 'open', resolution: '' });
  assert.ok(!(await call({ action: 'my-notifications' })).data.reports.some(r => r.id === id));
  assert.deepEqual(await changeFeedbackStatus(service, session.user.id, input), { conflict: true });
  await changeFeedbackStatus(service, session.user.id, { ...input, revision: 2 });
  const stale = await call({ action: 'acknowledge', id, revision: 1, dismiss: true });
  assert.equal(stale.data.updated, false);
  assert.ok((await call({ action: 'my-notifications' })).data.reports.some(r => r.id === id));
  const dismissed = await call({ action: 'acknowledge', id, revision: 3, dismiss: true });
  assert.equal(dismissed.data.updated, true);
  assert.ok(!(await call({ action: 'my-notifications' })).data.reports.some(r => r.id === id));
  console.log('PASS: deployed personal reads/acknowledgements, protected status endpoint, live DB helper, deduplication, reopen and stale revision checks.');
} finally {
  await browser?.close();
  check(await service.from('feedback_reports').delete().eq('id', id).eq('organization_id', profile.organization_id), 'Cleanup');
  console.log('Only this QA fixture removed; no emails or organization settings changed.');
}
