// Targeted connected QA after a complete business flow reached the stale-write check.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.env.HOURS_DEMO_LIVE_READY !== '1') throw new Error('Coordinator readiness required');
if (process.env.HOURS_DEMO_EXPECT_PT409 !== '1') throw new Error('Run only after the PT409 conflict migration is deployed');
const fixture = JSON.parse(readFileSync(process.env.HOURS_DEMO_FIXTURE, 'utf8'));
if (fixture.organizationId !== '6dedabe4-f62c-479e-b5fc-ebfcb824d76f') throw new Error('Demo fixture required');
const evidence = process.env.HOURS_DEMO_EVIDENCE_DIR;
const browser = await chromium.launch({ headless: true });
const contexts = await Promise.all([1, 2].map(() => browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: { width: 1440, height: 1000 }, locale: 'nl-NL' })));
contexts.forEach(context => context.setDefaultTimeout(15_000));
const [current, stale] = await Promise.all(contexts.map(context => context.newPage()));
const network = [];
for (const [index, page] of [current, stale].entries()) {
page.on('request', request => {
  const path = new URL(request.url()).pathname;
  if (path.startsWith('/rest/v1/rpc/hours_')) network.push({ event: 'request', page: index, path });
});
page.on('response', response => {
  const path = new URL(response.url()).pathname;
  if (path.startsWith('/rest/v1/rpc/hours_')) network.push({ event: 'response', page: index, path, status: response.status() });
});
}
async function login(page) {
  await page.goto('/login');
  await page.getByLabel('E-mailadres', { exact: true }).fill(process.env.DEMO_ORG_EMAIL);
  await page.getByLabel('Wachtwoord', { exact: true }).fill(process.env.DEMO_ORG_PASSWORD);
  await page.getByRole('button', { name: 'Inloggen', exact: true }).click();
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
}
const group = page => page.getByRole('region', { name: 'Klantweek uren', exact: true }).getByRole('group').first();
try {
  await login(current);
  await current.goto('/uren/weken');
  const weekPromise = current.waitForResponse(response => new URL(response.url()).pathname.endsWith('/rpc/hours_get_week'));
  await current.getByRole('link').filter({ hasText: fixture.companyName }).click();
  const week = await (await weekPromise).json();
  await login(stale);
  await stale.goto(`/uren/weken/${week.id}`);
  await group(stale).getByRole('button', { name: 'Wijzigen', exact: true }).click();
  const staleForm = group(stale).getByRole('form');
  await staleForm.getByLabel('Opmerking bij de invoer', { exact: true }).fill('Synthetische oudere tab QA - moet behouden blijven als concept');
  await group(current).getByRole('button', { name: 'Wijzigen', exact: true }).click();
  const currentForm = group(current).getByRole('form');
  await currentForm.getByLabel('Opmerking bij de invoer', { exact: true }).fill(`Synthetische racecontrole ${Date.now()}`);
  const savePromise = current.waitForResponse(response => new URL(response.url()).pathname.endsWith('/rpc/hours_save_day_source'));
  await currentForm.getByRole('button', { name: 'Dag opslaan', exact: true }).click();
  const saved = await savePromise;
  if (saved.status() !== 200) throw new Error(`Current write status ${saved.status()}`);
  const savedWeek = await saved.json();
  const savedDay = savedWeek.members.find(member => member.candidate_id === fixture.candidateId).days.find(day => day.work_date === fixture.weekStart);
  const button = staleForm.getByRole('button', { name: 'Dag opslaan', exact: true });
  const before = { disabled: await button.isDisabled(), text: await staleForm.innerText() };
  const started = Date.now();
  const staleResponsePromise = stale.waitForResponse(response => new URL(response.url()).pathname.endsWith('/rpc/hours_save_day_source'), { timeout: 5_000 });
  const [staleResponse] = await Promise.all([staleResponsePromise, button.click()]);
  const durationMs = Date.now() - started;
  const conflict = await staleResponse.json();
  assert.equal(staleResponse.status(), 409);
  assert.equal(conflict.code, 'PT409');
  await staleForm.getByText(/Deze dag is ondertussen gewijzigd/).waitFor();
  const after = { disabled: await button.isDisabled(), text: await staleForm.innerText() };
  assert.equal(after.disabled, true);
  const reloadPromise = current.waitForResponse(response => new URL(response.url()).pathname.endsWith('/rpc/hours_get_week'));
  await current.reload();
  const reloaded = await (await reloadPromise).json();
  const finalDay = reloaded.members.find(member => member.candidate_id === fixture.candidateId).days.find(day => day.work_date === fixture.weekStart);
  assert.deepEqual(finalDay, savedDay, 'Rejected old write must not add a revision, erase data, or downgrade history');
  await stale.screenshot({ path: resolve(evidence, 'stale-diagnostic.png'), fullPage: true });
  writeFileSync(resolve(evidence, 'stale-diagnostic.json'), JSON.stringify({ result: 'passed', weekId: week.id, httpStatus: 409, code: 'PT409', durationMs, unchangedAfterRejectedWrite: true, before, after, network }, null, 2));
  console.log(JSON.stringify({ result: 'passed', weekId: week.id, httpStatus: 409, code: 'PT409', durationMs, unchangedAfterRejectedWrite: true }));
} finally {
  if (!stale.isClosed()) {
    await stale.screenshot({ path: resolve(evidence, 'stale-diagnostic-last.png'), fullPage: true }).catch(() => undefined);
    writeFileSync(resolve(evidence, 'stale-diagnostic-last.txt'), await stale.locator('body').innerText().catch(() => 'Page closed'));
    writeFileSync(resolve(evidence, 'stale-diagnostic-network.json'), JSON.stringify(network, null, 2));
  }
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser.close();
}
