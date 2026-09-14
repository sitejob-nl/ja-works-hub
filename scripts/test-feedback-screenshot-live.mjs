// Opt-in connected QA. Only a temporary demo report/image is created and removed.
// No mails, status notifications, organization settings or real reports are changed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';

if (process.env.RUN_LIVE_FEEDBACK_QA !== '1') throw new Error('Explicit RUN_LIVE_FEEDBACK_QA=1 required.');
if (!process.env.E2E_BASE_URL) throw new Error('E2E_BASE_URL required.');
const project = 'noaupcteygfvlyymqtew', url = `https://${project}.supabase.co`;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const demo = createClient(url, key, options);
const check = (result, label) => { if (result.error) throw new Error(`${label} failed (${result.error.code || 'request'}).`); return result.data; };
const session = check(await demo.auth.signInWithPassword({ email: process.env.DEMO_ORG_EMAIL, password: process.env.DEMO_ORG_PASSWORD }), 'Demo login');
const profile = check(await demo.from('profiles').select('organization_id').eq('id', session.user.id).single(), 'Profile');
assert.equal(profile.organization_id, process.env.DEMO_ORG_ID);
const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', project, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const serviceKey = keys.find(k => k.name === 'service_role')?.api_key;
assert.ok(serviceKey, 'Cleanup credentials required before fixtures');
const service = createClient(url, serviceKey, options);
const id = crypto.randomUUID(), path = `${profile.organization_id}/${id}.png`;
let browser;
const call = async (body, token = session.session.access_token) => {
  const response = await fetch(`${url}/functions/v1/feedback`, { method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  return { status: response.status, data: await response.json() };
};
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 200;
    const context = canvas.getContext('2d'); context.fillStyle = '#dc2626'; context.fillRect(0, 0, 400, 200);
    context.fillStyle = '#ffffff'; context.font = '20px sans-serif'; context.fillText('Synthetische QA screenshot', 20, 80);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  const report = check(await service.from('feedback_reports').insert({ id, organization_id: profile.organization_id, submitted_by: session.user.id,
    reporter_name: 'QA', reporter_email: session.user.email, kind: 'bug', title: 'QA eigen screenshot (synthetisch)',
    description: 'Alleen testgegevens voor de screenshotweergave.', request_hash: 'qa-screenshot', diagnostics: {},
    has_screenshot: true, screenshot_path: path }).select('number').single(), 'Fixture');
  check(await service.storage.from('feedback-screenshots').upload(path, png, { contentType: 'image/png' }), 'Fixture image');
  assert.equal((await call({ action: 'my-detail', id }, null)).status, 401);
  const detail = await call({ action: 'my-detail', id });
  assert.equal(detail.status, 200); assert.equal(detail.data.report.has_screenshot, true);
  assert.ok(detail.data.screenshotUrl, 'Owner receives a signed attachment');
  assert.ok(!Object.hasOwn(detail.data.report, 'screenshot_path'));
  const imageResponse = await fetch(detail.data.screenshotUrl);
  assert.equal(imageResponse.status, 200);
  assert.ok(Buffer.from(await imageResponse.arrayBuffer()).equals(png), 'Exact synthetic PNG is served');
  assert.ok((await demo.storage.from('feedback-screenshots').download(path)).error, 'Direct browser download remains forbidden');
  const publicResponse = await fetch(`${url}/storage/v1/object/public/feedback-screenshots/${path}`);
  assert.ok(!publicResponse.ok, 'Bucket remains private');

  await page.goto(`${process.env.E2E_BASE_URL}/login`);
  await expect(page.getByText('Log in om verder te gaan', { exact: true })).toBeVisible();
  await page.getByLabel('E-mailadres', { exact: true }).fill(process.env.DEMO_ORG_EMAIL);
  await page.getByLabel('Wachtwoord', { exact: true }).fill(process.env.DEMO_ORG_PASSWORD);
  await page.getByRole('button', { name: 'Inloggen', exact: true }).click();
  const skip = page.getByRole('button', { name: 'Overslaan', exact: true });
  const bell = page.getByRole('button', { name: 'Notificaties', exact: true });
  await expect(skip.or(bell).first()).toBeVisible({ timeout: 15000 });
  if (await skip.isVisible()) await skip.click();
  await page.goto(`${process.env.E2E_BASE_URL}/feedback/${id}`);
  const image = page.getByRole('img', { name: `Screenshot bij melding #${report.number}`, exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth)).toBe(400);
  const bounds = await image.boundingBox(); assert.ok(bounds.x + bounds.width <= 390);
  const refresh = page.waitForResponse(r => r.url().endsWith('/functions/v1/feedback') && r.request().postDataJSON()?.action === 'my-detail');
  await page.getByRole('button', { name: 'Screenshot opnieuw laden', exact: true }).click();
  assert.equal((await refresh).status(), 200);
  await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth)).toBe(400);
  console.log('PASS: real owner detail, exact private PNG, mobile rendering and signed-link refresh.');

  // Removing only this fixture's owner tests the same-org read boundary without another account.
  check(await service.from('feedback_reports').update({ submitted_by: null }).eq('id', id), 'Fixture ownership');
  const forbidden = await call({ action: 'my-detail', id, submitted_by: session.user.id, organization_id: profile.organization_id });
  assert.equal(forbidden.status, 404); assert.ok(!forbidden.data.screenshotUrl);
  console.log('PASS: anonymous/non-owner access and direct/public storage reads are denied.');
} finally {
  await browser?.close();
  const cleanup = await Promise.allSettled([
    service.storage.from('feedback-screenshots').remove([path]).then(r => check(r, 'Image cleanup')),
    service.from('feedback_reports').delete().eq('id', id).eq('organization_id', profile.organization_id).then(r => check(r, 'Report cleanup')),
  ]);
  for (const result of cleanup) if (result.status === 'rejected') throw result.reason;
  console.log('Only this synthetic report and image removed; no messages or settings changed.');
}
