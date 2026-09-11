import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Connected QA for T10: replacing a pinned matrix basis through the real screens.
 *
 * Run only after 20260917090000 is applied. Load credentials with node --env-file;
 * never copy them into fixtures or evidence. No mocked responses, injected
 * sessions, provider calls or outbound messages. Every write below goes through
 * the actual product forms, against the verified demo organisation.
 */
const DEMO_ORG = '6dedabe4-f62c-479e-b5fc-ebfcb824d76f';
const API = 'https://noaupcteygfvlyymqtew.supabase.co';
const AUTH_KEY = 'sb-noaupcteygfvlyymqtew-auth-token';

type Fixture = {
  verified: boolean; runId: string; organizationId: string; companyId: string; companyName: string;
  weekId: string; weekStart: string; primaryCandidateId: string;
  applyDayId: string; applyWorkDate: string;
};
type Classification = {
  id: string; revision_id: string; status: string; matrix_version_id: string | null;
  matrix_name: string | null; basis_version: number | null;
  allocations: { categoryCode: string; factor: string; minutes: number }[];
};
type BasisEntry = {
  basis_version: number; matrix_version_id: string; matrix_name: string;
  scope: string; reason: string | null; created_by: string;
};
type Day = {
  id: string; work_date: string;
  current_revision: { id: string; minutes: number } | null;
  classification: Classification | null;
  previous_classifications: Classification[];
  matrix_basis: { basis_version: number; matrix_version_id: string; entries: BasisEntry[] } | null;
};
type Week = { id: string; members: { candidate_id: string; days: Day[] }[] };

function required(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment key: ${key}`);
  return value;
}

const fixture = JSON.parse(readFileSync(required('HOURS_BASIS_FIXTURE'), 'utf8')) as Fixture;
const evidence = process.env.HOURS_BASIS_EVIDENCE_DIR ?? resolve('../test-results/hours-basis');
// The day card is labelled with the employee name and the same formatted date the
// screen renders, so the locator follows the product rather than a row position.
const dayLabel = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  .format(new Date(`${fixture.applyWorkDate}T12:00:00Z`));

const dayGroup = (page: Page) => page.getByRole('region', { name: 'Klantweek uren', exact: true })
  .getByRole('group', { name: new RegExp(dayLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();

async function login(page: Page, prefix: 'DEMO_ORG' | 'DEMO_PORTAL') {
  const pathname = prefix === 'DEMO_ORG' ? '/login' : '/portaal/login';
  await page.goto(pathname);
  expect(await page.evaluate(key => sessionStorage.getItem(key), AUTH_KEY), 'no inherited session').toBeNull();
  await page.locator('#email').fill(required(`${prefix}_EMAIL`));
  await page.locator('#password').fill(required(`${prefix}_PASSWORD`));
  const token = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/auth/v1/token' && response.request().method() === 'POST');
  await page.locator('form').getByRole('button', { name: /Inloggen|Log in/i }).click();
  expect((await token).status(), 'form authentication').toBe(200);
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
}

/** Authenticated probe with the real UI session; the token never leaves the browser. */
async function browserRequest(page: Page, path: string, payload?: unknown) {
  const publicKey = required('VITE_SUPABASE_PUBLISHABLE_KEY');
  return page.evaluate(async ({ api, key, publicKey, path, payload }) => {
    const session = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (!session?.access_token) throw new Error('The UI login has no active session');
    const response = await fetch(`${api}${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { apikey: publicKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    return { status: response.status, body: await response.json() };
  }, { api: API, key: AUTH_KEY, publicKey, path, payload });
}

async function rpcAction<T>(page: Page, name: string, action: () => Promise<unknown>, status = 200): Promise<T> {
  const pending = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/rest/v1/rpc/${name}` && response.request().method() === 'POST');
  const [response] = await Promise.all([pending, action()]);
  expect(response.status(), `${name} HTTP status`).toBe(status);
  return response.json() as Promise<T>;
}

/**
 * The classification runs in an edge function, and after a replacement the button
 * label and the result badge are already what they were. Waiting for the actual
 * call is the only way to know a second run happened rather than was cancelled.
 */
async function classify(page: Page, group: ReturnType<Page['getByRole']>) {
  const pending = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/functions/v1/hours-classify-day'
    && response.request().method() === 'POST');
  await group.getByRole('button', { name: 'Uursoorten controleren', exact: true }).click();
  const response = await pending;
  expect(response.status(), 'hours-classify-day HTTP status').toBe(200);
  await expect(group.getByRole('button', { name: 'Uursoorten controleren', exact: true })).toBeEnabled();
}

async function readDay(page: Page): Promise<Day> {
  const response = await browserRequest(page, '/rest/v1/rpc/hours_get_week', { p_week_id: fixture.weekId });
  expect(response.status).toBe(200);
  const week = response.body as Week;
  const day = week.members.flatMap(member => member.days).find(item => item.id === fixture.applyDayId);
  expect(day, 'the fixture day must be in the week').toBeDefined();
  return day!;
}

/** Whole rows, so a changed column anywhere in the history would show. */
async function historyRows(page: Page) {
  const basis = await browserRequest(page, `/rest/v1/hours_day_matrix_basis?select=*&day_id=eq.${fixture.applyDayId}`);
  const classifications = await browserRequest(page,
    `/rest/v1/hours_day_classifications?select=*&day_id=eq.${fixture.applyDayId}&order=created_at.asc`);
  expect(basis.status).toBe(200);
  expect(classifications.status).toBe(200);
  return { basis: basis.body as unknown[], classifications: classifications.body as unknown[] };
}

async function publishMatrix(page: Page, scope: 'client' | 'cao', name: string, factor: string) {
  await page.goto('/uren/matrices');
  await page.getByLabel('Afspraakbasis', { exact: true }).selectOption(scope);
  await page.getByLabel('Naam van de matrix', { exact: true }).fill(name);
  if (scope === 'client') await page.getByLabel('Opdrachtgever', { exact: true }).selectOption(fixture.companyId);
  const matrix = await rpcAction<{ id: string }>(page, 'hours_create_matrix',
    () => page.getByRole('button', { name: 'Matrix aanmaken', exact: true }).click());
  await page.waitForURL(`**/uren/matrices/${matrix.id}`);
  await page.getByLabel('Geldig vanaf', { exact: true }).fill(fixture.weekStart);
  await page.getByRole('button', { name: 'Uurcode toevoegen', exact: true }).click();
  await page.getByLabel('Uurcode 1', { exact: true }).fill('NORMAAL');
  await page.getByLabel('Factor 1', { exact: true }).fill(factor);
  await page.getByLabel('Indeling zonder broncategorieën', { exact: true }).selectOption('flat');
  await page.getByLabel('Vaste uurcode', { exact: true }).selectOption('NORMAAL');
  await rpcAction(page, 'hours_create_matrix_draft',
    () => page.getByRole('button', { name: 'Concept opslaan', exact: true }).click());
  await expect(page.getByRole('heading', { name: 'Versie 1 · concept', exact: true })).toBeVisible();
  await page.getByLabel('Netto-uren voorbeeld', { exact: true }).fill('8:00');
  await page.getByRole('button', { name: 'Voorbeeld berekenen', exact: true }).click();
  await expect(page.getByText('Voorbeeld sluit aan: 8:00 uur.', { exact: true })).toBeVisible();
  await page.getByLabel('Ik heb de afspraken, geldigheid en het actuele rekenvoorbeeld gecontroleerd en bevestig publicatie.', { exact: true }).check();
  const published = await rpcAction<{ versions: { id: string; status: string }[] }>(page, 'hours_publish_matrix_version',
    () => page.getByRole('button', { name: 'Bevestigen en publiceren', exact: true }).click());
  await expect(page.getByRole('heading', { name: 'Versie 1 · gepubliceerd', exact: true })).toBeVisible();
  const version = published.versions.find(item => item.status === 'published');
  expect(version, 'a published version must come back').toBeDefined();
  return { matrixId: matrix.id, versionId: version!.id };
}

test('an explicit basis replacement leaves the pinned basis and every earlier outcome untouched', async ({ page }) => {
  test.skip(process.env.HOURS_BASIS_LIVE_READY !== '1', 'Set HOURS_BASIS_LIVE_READY=1 once schema and gate are verified');
  mkdirSync(evidence, { recursive: true });
  expect(fixture.verified, 'the fixture must come from the checked demo preparation').toBe(true);
  expect(fixture.organizationId).toBe(DEMO_ORG);
  expect(fixture.companyName.startsWith('Urenmodule QA ')).toBe(true);

  const checks: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error.message)));

  await login(page, 'DEMO_ORG');
  const profile = await browserRequest(page, '/rest/v1/profiles?select=organization_id,role&id=eq.' +
    (await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? 'null')?.user?.id, AUTH_KEY)));
  expect(profile.body).toEqual([{ organization_id: DEMO_ORG, role: 'admin' }]);

  const client = await publishMatrix(page, 'client', `T10-klant ${fixture.runId}`, '1');
  const cao = await publishMatrix(page, 'cao', `T10-cao ${fixture.runId}`, '2');
  await page.goto('/uren/matrices');
  await page.getByLabel('Opdrachtgever voor CAO-koppeling', { exact: true }).selectOption(fixture.companyId);
  await page.getByLabel('Toepasselijke CAO-basis', { exact: true }).selectOption(cao.matrixId);
  await rpcAction(page, 'hours_set_company_matrix_binding',
    () => page.getByRole('button', { name: 'CAO-koppeling opslaan', exact: true }).click());
  checks.push('client matrix and explicitly bound CAO basis published through the real matrix screens');

  // One untouched work day of this run is consumed here, by design.
  await page.goto(`/uren/weken/${fixture.weekId}`);
  const group = dayGroup(page);
  await expect(group).toHaveCount(1);
  await group.getByRole('button', { name: /Invoeren|Wijzigen/ }).click();
  await group.getByLabel('Gewerkte uren', { exact: true }).fill('8:00');
  await rpcAction(page, 'hours_save_day_source',
    () => group.getByRole('button', { name: 'Dag opslaan', exact: true }).click());
  await classify(page, group);
  await expect(group.getByText('Uursoorten ingedeeld', { exact: true })).toBeVisible();
  await page.reload();

  const pinned = await readDay(page);
  expect(pinned.classification?.status).toBe('classified');
  expect(pinned.classification?.matrix_version_id).toBe(client.versionId);
  expect(pinned.classification?.basis_version).toBe(0);
  expect(pinned.matrix_basis?.basis_version).toBe(0);
  expect(pinned.matrix_basis?.entries.map(entry => entry.basis_version)).toEqual([0]);
  expect(pinned.matrix_basis?.entries[0].reason).toBeNull();
  expect(pinned.previous_classifications).toEqual([]);
  const before = await historyRows(page);
  expect(before.basis).toHaveLength(1);
  expect(before.classifications).toHaveLength(1);
  checks.push('first classification pinned basis version 0 on the published client matrix');

  const basisRegion = group.getByRole('region', { name: 'Matrixbasis', exact: true });
  await expect(basisRegion.getByText(/Huidige matrixbasis/)).toContainText(`T10-klant ${fixture.runId}`);
  await expect(basisRegion.getByText(/Huidige matrixbasis/)).toContainText('basisversie 0');
  await basisRegion.getByRole('button', { name: 'Andere matrixbasis vastleggen', exact: true }).click();
  const choice = basisRegion.getByLabel('Nieuwe matrixbasis', { exact: true });
  await expect(choice).toBeVisible();
  const offered = await choice.locator('option').evaluateAll(nodes =>
    nodes.map(node => (node as HTMLOptionElement).value).filter(Boolean));
  expect(offered, 'only the other eligible published version may be offered').toEqual([cao.versionId]);
  const reason = `Synthetische QA ${fixture.runId}: klantmatrix hoorde bij een andere vestiging`;
  await choice.selectOption(cao.versionId);
  await basisRegion.getByLabel('Reden van de vervanging', { exact: true }).fill(reason);
  await rpcAction(page, 'hours_replace_day_matrix_basis',
    () => basisRegion.getByRole('button', { name: 'Matrixbasis vervangen', exact: true }).click());
  await expect(page.getByText(/Voer de uursoortencontrole opnieuw uit/).first()).toBeVisible();
  checks.push('replacement recorded with an explicit reason through the real form');

  const replaced = await readDay(page);
  expect(replaced.matrix_basis?.basis_version).toBe(1);
  expect(replaced.matrix_basis?.matrix_version_id).toBe(cao.versionId);
  expect(replaced.matrix_basis?.entries.map(entry => entry.basis_version)).toEqual([0, 1]);
  expect(replaced.matrix_basis?.entries[0].reason).toBeNull();
  expect(replaced.matrix_basis?.entries[1].reason).toBe(reason);
  // The replacement itself decides nothing: the recorded outcome is still the old one.
  expect(replaced.classification?.id).toBe(pinned.classification?.id);
  expect(replaced.classification?.basis_version).toBe(0);
  expect(await historyRows(page)).toEqual(before);
  checks.push('replacing alone changed no outcome and rewrote no history row');

  await page.reload();
  const reloaded = dayGroup(page);
  await expect(reloaded.getByRole('region', { name: 'Matrixbasis', exact: true })
    .getByText(/hoort nog bij een eerdere matrixbasis/)).toBeVisible();
  await page.screenshot({ path: resolve(evidence, 'basis-replaced-desktop.png'), fullPage: true });
  await classify(page, reloaded);
  await expect(reloaded.getByText('Uursoorten ingedeeld', { exact: true }).first()).toBeVisible();
  await page.reload();

  const recalculated = await readDay(page);
  expect(recalculated.classification?.id).not.toBe(pinned.classification?.id);
  expect(recalculated.classification?.matrix_version_id).toBe(cao.versionId);
  expect(recalculated.classification?.basis_version).toBe(1);
  expect(recalculated.classification?.allocations[0].factor).toBe('2');
  expect(recalculated.previous_classifications.map(entry => entry.id)).toEqual([pinned.classification!.id]);
  expect(recalculated.previous_classifications[0].allocations[0].factor).toBe('1');
  const after = await historyRows(page);
  expect(after.basis).toEqual(before.basis);
  expect(after.classifications).toHaveLength(2);
  expect(after.classifications[0]).toEqual(before.classifications[0]);
  checks.push('recalculation used the replaced basis; the pinned basis row and the first outcome are byte-identical');

  const stale = await browserRequest(page, '/rest/v1/rpc/hours_replace_day_matrix_basis', {
    p_day_id: fixture.applyDayId, p_expected_revision_id: recalculated.current_revision!.id,
    p_expected_basis_version: 0, p_matrix_version_id: client.versionId, p_reason: 'Synthetische conflictproef',
  });
  expect(stale.status, 'a stale basis version must conflict').toBe(409);
  const same = await browserRequest(page, '/rest/v1/rpc/hours_replace_day_matrix_basis', {
    p_day_id: fixture.applyDayId, p_expected_revision_id: recalculated.current_revision!.id,
    p_expected_basis_version: 1, p_matrix_version_id: cao.versionId, p_reason: 'Synthetische no-op-proef',
  });
  expect(same.status, 'the basis it already has must be refused').toBe(400);
  expect(await historyRows(page)).toEqual(after);
  checks.push('a stale basis version conflicts and re-choosing the current basis is refused, both without writing');

  const options = await browserRequest(page, '/rest/v1/rpc/hours_get_day_matrix_options', { p_day_id: fixture.applyDayId });
  expect(options.status).toBe(200);
  expect((options.body as { released: boolean }).released, 'release does not exist yet').toBe(false);

  const portal = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } });
  const portalPage = await portal.newPage();
  try {
    await login(portalPage, 'DEMO_PORTAL');
    const denied = await browserRequest(portalPage, '/rest/v1/rpc/hours_replace_day_matrix_basis', {
      p_day_id: fixture.applyDayId, p_expected_revision_id: recalculated.current_revision!.id,
      p_expected_basis_version: 1, p_matrix_version_id: client.versionId, p_reason: 'Synthetische portaalproef',
    });
    expect(denied.status, 'an employee may never replace a basis').toBe(403);
    const hidden = await browserRequest(portalPage,
      `/rest/v1/hours_day_matrix_basis_replacements?select=id&day_id=eq.${fixture.applyDayId}`);
    expect(hidden.status).toBe(200);
    expect(hidden.body).toEqual([]);
    checks.push('the employee portal cannot replace a basis and cannot read the replacement ledger');
  } finally {
    await portal.close();
  }

  expect(await historyRows(page)).toEqual(after);
  expect(errors, 'no JavaScript page errors').toEqual([]);
  writeFileSync(resolve(evidence, 'result.json'), JSON.stringify({
    result: 'basis-replacement-passed', runId: fixture.runId, organizationId: DEMO_ORG,
    companyName: fixture.companyName, workDate: fixture.applyWorkDate,
    clientMatrixVersion: client.versionId, caoMatrixVersion: cao.versionId,
    checks, paidCalls: 0, communicationsSent: 0, timesheetsWritten: 0,
    verifiedAt: new Date().toISOString(),
  }, null, 2) + '\n');
});
