import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Run only after the hours schema, module gate and hours-classify-day are deployed.
 * Load credentials with node --env-file; never copy them into fixtures/evidence.
 * No mocked responses, injected sessions, provider calls, outbound messages, or
 * broad demo seeding. All business writes below use the actual product forms.
 */
const DEMO_ORG = '6dedabe4-f62c-479e-b5fc-ebfcb824d76f';
const JA_ORG = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const API = 'https://noaupcteygfvlyymqtew.supabase.co';
const AUTH_KEY = 'sb-noaupcteygfvlyymqtew-auth-token';
const fixturePath = process.env.HOURS_DEMO_FIXTURE;
type Fixture = {
  runId: string; organizationId: string; organizationName: string;
  companyId: string; companyName: string; candidateId: string;
  weekStart: string; jaOrganizationName: string;
};
type Day = {
  id: string; work_date: string;
  current_revision: { id: string; revision_number: number; minutes: number; note: string | null; source_input: unknown } | null;
  confirmation: { revision_id: string; decision: string; note: string | null } | null;
  classification?: { revision_id: string; status: string; matrix_version_id?: string; allocations?: unknown[] } | null;
  history: unknown[];
};
type Week = { id: string; company_id: string; members: { candidate_id: string; days: Day[] }[] };
type NetworkEvent = { zone: string; method: string; path: string; status: number };

function required(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment key: ${key}`);
  return value;
}

function observe(page: Page, zone: string, network: NetworkEvent[], errors: string[]) {
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== API) return;
    // No query strings, credentials, headers, response bodies or contact details.
    network.push({ zone, method: response.request().method(), path: url.pathname, status: response.status() });
    const evidence = process.env.HOURS_DEMO_EVIDENCE_DIR;
    if (evidence) writeFileSync(resolve(evidence, 'network-current.json'), JSON.stringify(network, null, 2));
  });
  page.on('pageerror', () => errors.push(zone));
}

async function rpcAction<T>(page: Page, name: string, action: () => Promise<unknown>, status: number | 'error' = 200): Promise<T> {
  const responsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/rest/v1/rpc/${name}` && response.request().method() === 'POST');
  const [response] = await Promise.all([responsePromise, action()]);
  if (status === 'error') expect(response.ok(), `${name} must reject the write`).toBe(false);
  else expect(response.status(), `${name} HTTP status`).toBe(status);
  return response.json();
}

async function login(page: Page, zone: 'internal' | 'portal' | 'superadmin', returnTo?: string) {
  const prefix = zone === 'internal' ? 'DEMO_ORG' : zone === 'portal' ? 'DEMO_PORTAL' : 'QA_SUPERADMIN';
  const pathname = zone === 'internal' ? '/login' : zone === 'portal' ? `/portaal/login?returnTo=${encodeURIComponent(returnTo ?? '/portaal')}` : '/superadmin/login';
  await page.goto(pathname);
  expect(await page.evaluate(key => sessionStorage.getItem(key), AUTH_KEY), 'fresh login has no inherited session').toBeNull();
  await page.locator('#email').fill(required(`${prefix}_EMAIL`));
  await page.locator('#password').fill(required(`${prefix}_PASSWORD`));
  const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/auth/v1/token' && response.request().method() === 'POST');
  await page.locator('form').getByRole('button', { name: /Inloggen|Log in/i }).click();
  expect((await loginResponse).status(), `${zone} form authentication`).toBe(200);
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
  // Assert provenance while keeping the token entirely within the browser.
  expect(await page.evaluate(key => Boolean(JSON.parse(sessionStorage.getItem(key) ?? 'null')?.access_token), AUTH_KEY)).toBe(true);
  if (returnTo) await expect(page).toHaveURL(new RegExp(`${returnTo.replaceAll('/', '\\/')}$`));
}

/** Authenticated read/negative probe with the existing real UI session. */
async function browserRequest(page: Page, path: string, payload?: unknown) {
  const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? required('VITE_SUPABASE_ANON_KEY');
  return page.evaluate(async ({ api, key, publicKey, path, payload }) => {
    const session = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (!session?.access_token) throw new Error('The UI login has no active session');
    const response = await fetch(`${api}${path.replace('$SELF', session.user.id)}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { apikey: publicKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    return { status: response.status, body: await response.json() };
  }, { api: API, key: AUTH_KEY, publicKey, path, payload });
}

async function readWeek(page: Page, weekId: string): Promise<Week> {
  const response = await browserRequest(page, '/rest/v1/rpc/hours_get_week', { p_week_id: weekId });
  expect(response.status).toBe(200);
  return response.body as Week;
}

function fixtureDay(week: Week, fixture: Fixture): Day {
  const members = week.members.filter(member => member.candidate_id === fixture.candidateId);
  expect(members).toHaveLength(1);
  const day = members[0].days.find(item => item.work_date === fixture.weekStart);
  expect(day).toBeDefined();
  return day!;
}

function dayGroup(page: Page, portal = false) {
  const region = page.getByRole('region', { name: portal ? 'Mijn uren' : 'Klantweek uren', exact: true });
  return region.getByRole('group').first();
}

async function openModules(page: Page, organizationName: string) {
  await page.goto('/superadmin/organisaties');
  const row = page.getByRole('row').filter({ has: page.getByText(organizationName, { exact: true }) });
  await expect(row).toHaveCount(1);
  await row.getByTitle('Modules beheren').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: `Modules — ${organizationName}`, exact: true })).toBeVisible();
  return dialog;
}

async function moduleSwitch(page: Page, organizationName: string, enabled?: boolean) {
  const dialog = await openModules(page, organizationName);
  const toggle = dialog.getByRole('switch', { name: /Urenmodule.*weekcontrole/i });
  await expect(toggle).toBeVisible();
  await expect(toggle, 'wait for the authoritative module settings, not the loading fallback').toBeEnabled();
  const before = await toggle.getAttribute('aria-checked') === 'true';
  if (enabled !== undefined && before !== enabled) {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', String(enabled));
    await expect(page.getByText('Module bijgewerkt', { exact: true })).toBeVisible();
  }
  if (enabled !== undefined) await expect(toggle).toHaveAttribute('aria-checked', String(enabled));
  return { dialog, toggle, before };
}

async function saveSource(page: Page, group: Locator, hours: string, sourceHours: string, note: string, first = false) {
  await group.getByRole('button', { name: first ? 'Invoeren' : 'Wijzigen', exact: true }).click();
  const form = group.getByRole('form', { name: /Uren invoeren/ });
  await form.getByLabel('Gewerkte uren', { exact: true }).fill(hours);
  if (first) {
    await form.getByLabel('Diensttijden vastleggen', { exact: true }).check();
    await form.getByLabel('Begintijd dienst 1', { exact: true }).fill('08:00');
    await form.getByLabel('Eindtijd dienst 1', { exact: true }).fill('17:00');
    await form.getByLabel('Einddag dienst 1', { exact: true }).selectOption('0');
    await form.getByRole('button', { name: 'Pauze toevoegen aan dienst 1', exact: true }).click();
    await form.getByLabel('Pauze begint', { exact: true }).fill('12:00');
    await form.getByLabel('Pauze eindigt', { exact: true }).fill('12:30');
    await form.getByLabel('Begindag pauze 1 dienst 1', { exact: true }).selectOption('0');
    await form.getByLabel('Einddag pauze 1 dienst 1', { exact: true }).selectOption('0');
    await form.getByLabel('Alle pauzes van dienst 1 zijn gecontroleerd.', { exact: true }).check();
    await form.getByLabel('Broncategorieën vastleggen', { exact: true }).check();
    await form.getByLabel('Broncode 1', { exact: true }).fill('OV1');
  } else {
    await form.getByLabel('Eindtijd dienst 1', { exact: true }).fill('16:30');
    await form.getByLabel('Alle pauzes van dienst 1 zijn gecontroleerd.', { exact: true }).check();
  }
  await form.getByLabel('Uren broncode 1', { exact: true }).fill(sourceHours);
  await form.getByLabel('Opmerking bij de invoer', { exact: true }).fill(note);
  const saved = await rpcAction<Week>(page, 'hours_save_day_source', () => form.getByRole('button', { name: 'Dag opslaan', exact: true }).click());
  await expect(form).toHaveCount(0);
  return saved;
}

async function classify(page: Page, group: Locator) {
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/functions/v1/hours-classify-day' && response.request().method() === 'POST');
  await group.getByRole('button', { name: 'Uursoorten controleren', exact: true }).click();
  expect((await responsePromise).status(), 'real edge classification').toBe(200);
  await expect(group.getByText('Uursoorten ingedeeld', { exact: true }).filter({ visible: true })).toBeVisible();
}

async function portalResponse(page: Page, group: Locator, decision: 'confirmed' | 'disputed') {
  await group.getByRole('button', { name: decision === 'confirmed' ? 'Akkoord' : 'Klopt niet', exact: true }).click();
  const form = group.getByRole('form');
  if (decision === 'disputed') await form.getByLabel('Opmerking bij je reactie', { exact: true }).fill('Synthetische QA-betwisting: controleer de eindtijd.');
  await rpcAction(page, 'hours_confirm_day', () => form.getByRole('button', { name: 'Reactie opslaan', exact: true }).click());
  await expect(group.getByText(decision === 'confirmed' ? 'Akkoord' : 'Betwist', { exact: true })).toBeVisible();
}

test('connected demo: real three-zone logins, matrix, revisions, classification, portal and tenant switch', async ({ browser }) => {
  test.skip(process.env.HOURS_DEMO_TOGGLE_ONLY === '1', 'The business flow was already tested; run the separate SaaS cycle.');
  test.skip(process.env.HOURS_DEMO_LIVE_READY !== '1', 'Requires explicit release-coordinator readiness and a scoped demo fixture.');
  expect(fixturePath, 'HOURS_DEMO_FIXTURE must point to an explicitly prepared synthetic fixture').toBeTruthy();
  const fixture = JSON.parse(readFileSync(fixturePath!, 'utf8')) as Fixture;
  expect(fixture.organizationId).toBe(DEMO_ORG);
  expect(required('DEMO_ORG_ID')).toBe(DEMO_ORG);
  expect(fixture.candidateId).toBe(required('DEMO_PORTAL_CANDIDATE_ID'));
  expect(fixture.companyName).toContain(fixture.runId);
  expect(fixture.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const evidence = resolve(required('HOURS_DEMO_EVIDENCE_DIR'));
  mkdirSync(evidence, { recursive: true });
  const network: NetworkEvent[] = [], pageErrors: string[] = [], checks: string[] = [];
  // This fallback never bypasses an inactive SaaS admin. It verifies the business
  // flow only after the coordinator has legitimately enabled the demo module.
  const skipSuperadmin = process.env.HOURS_DEMO_SKIP_SUPERADMIN === '1';
  const contexts = await Promise.all(['internal', 'portal', 'superadmin', 'stale'].map(() => browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8083',
    viewport: { width: 1440, height: 1000 }, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam',
    storageState: { cookies: [], origins: [] },
  })));
  contexts.forEach(context => { context.setDefaultTimeout(20_000); context.setDefaultNavigationTimeout(30_000); });
  const [internal, portal, admin, stale] = await Promise.all(contexts.map(context => context.newPage()));
  for (const [i, page] of [internal, portal, admin, stale].entries()) observe(page, ['internal', 'portal', 'superadmin', 'stale'][i], network, pageErrors);
  let demoWasDisabled = false;
  let result = 'failed';
  let entities: { matrixId: string; weekId: string; dayId: string; revisionId: string } | null = null;
  try {
    if (!skipSuperadmin) {
      await login(admin, 'superadmin');
      const ja = await moduleSwitch(admin, fixture.jaOrganizationName);
      await expect(ja.toggle, 'JA Werkt must remain disabled; never enable this tenant for QA').toHaveAttribute('aria-checked', 'false');
      await ja.dialog.screenshot({ path: resolve(evidence, 'ja-module-disabled.png') });
      const jaSetting = await browserRequest(admin, `/rest/v1/organization_modules?select=enabled&organization_id=eq.${JA_ORG}&module_name=eq.uren-workflow`);
      expect(jaSetting.status).toBe(200);
      expect(jaSetting.body).toEqual([{ enabled: false }]);
      checks.push('JA Werkt explicit disabled override verified in SaaS admin and authenticated DB read');
      await moduleSwitch(admin, fixture.organizationName, true);
    } else {
      checks.push('LIMITATION: SaaS admin login/toggle/JA Werkt UI verification not run; no inactive-account bypass');
    }
    await login(internal, 'internal');
    const internalProfile = await browserRequest(internal, '/rest/v1/profiles?select=organization_id,role&id=eq.$SELF');
    expect(internalProfile.status).toBe(200);
    expect(internalProfile.body).toEqual([{ organization_id: DEMO_ORG, role: 'admin' }]);
    await internal.goto('/uren/matrices');
    const matrixName = `QA-matrix ${fixture.runId}`;
    let matrix: { id: string };
    if (process.env.HOURS_DEMO_RESUME_MATRIX === '1') {
      matrix = await rpcAction<{ id: string }>(internal, 'hours_get_matrix', () => internal.getByRole('link', { name: new RegExp(matrixName) }).click());
      checks.push('resumed a concept created by the previous recorded QA attempt; matrix creation is not claimed for this run');
    } else {
    await internal.getByLabel('Naam van de matrix', { exact: true }).fill(matrixName);
    await internal.getByLabel('Opdrachtgever', { exact: true }).selectOption(fixture.companyId);
    matrix = await rpcAction<{ id: string }>(internal, 'hours_create_matrix', () => internal.getByRole('button', { name: 'Matrix aanmaken', exact: true }).click());
    await internal.waitForURL(`**/uren/matrices/${matrix.id}`);
    await internal.getByLabel('Geldig vanaf', { exact: true }).fill(fixture.weekStart);
    for (const [i, code] of ['NORMAAL', 'OV1', 'OV2', 'OV3', 'OV4', 'OV5'].entries()) {
      await internal.getByRole('button', { name: 'Uurcode toevoegen', exact: true }).click();
      await internal.getByLabel(`Uurcode ${i + 1}`, { exact: true }).fill(code);
      await internal.getByLabel(`Factor ${i + 1}`, { exact: true }).fill(i === 0 ? '1' : String(1 + i / 4));
      if (i > 0) {
        await internal.getByRole('button', { name: 'Broncode toevoegen', exact: true }).click();
        await internal.getByLabel(`Broncode ${i}`, { exact: true }).fill(code);
        await internal.getByLabel(`Uurcode voor broncode ${i}`, { exact: true }).selectOption(code);
      }
    }
    await internal.getByLabel('Indeling zonder broncategorieën', { exact: true }).selectOption('flat');
    await internal.getByLabel('Vaste uurcode', { exact: true }).selectOption('NORMAAL');
    await rpcAction(internal, 'hours_create_matrix_draft', () => internal.getByRole('button', { name: 'Concept opslaan', exact: true }).click());
    }
    await expect(internal.getByRole('heading', { name: 'Versie 1 · concept', exact: true })).toBeVisible();
    await internal.getByLabel('Netto-uren voorbeeld', { exact: true }).fill('8:30');
    await internal.getByRole('button', { name: 'Voorbeeld berekenen', exact: true }).click();
    await expect(internal.getByText('Voorbeeld sluit aan: 8:30 uur.', { exact: true })).toBeVisible();
    await internal.getByLabel('Ik heb de afspraken, geldigheid en het actuele rekenvoorbeeld gecontroleerd en bevestig publicatie.', { exact: true }).check();
    await expect(internal.getByRole('button', { name: 'Bevestigen en publiceren', exact: true })).toBeEnabled();
    await rpcAction(internal, 'hours_publish_matrix_version', () => internal.getByRole('button', { name: 'Bevestigen en publiceren', exact: true }).click());
    await expect(internal.getByRole('heading', { name: 'Versie 1 · gepubliceerd', exact: true })).toBeVisible();
    checks.push(process.env.HOURS_DEMO_RESUME_MATRIX === '1'
      ? 'previously created matrix resumed, previewed and published through UI'
      : 'matrix created, OV1–OV5 explicitly mapped, previewed and published through UI');
    await internal.screenshot({ path: resolve(evidence, 'matrix-published-desktop.png'), fullPage: true });

    await internal.goto('/uren/weken');
    await internal.getByLabel('Opdrachtgever', { exact: true }).selectOption(fixture.companyId);
    await internal.getByLabel('Handmatige weekcontrole beschikbaar', { exact: true }).check();
    await internal.getByLabel('Aanleverdeadline', { exact: true }).selectOption('7');
    await internal.getByLabel('Tijd aanleverdeadline', { exact: true }).fill('10:00');
    await internal.getByLabel('Deadline medewerkerakkoord', { exact: true }).selectOption('8');
    await internal.getByLabel('Tijd akkoorddeadline', { exact: true }).fill('12:00');
    await rpcAction(internal, 'hours_set_company_settings', () => internal.getByRole('button', { name: 'Instellingen opslaan', exact: true }).click());
    await internal.getByLabel('Maandag van de werkweek', { exact: true }).fill(fixture.weekStart);
    const week = await rpcAction<Week>(internal, 'hours_create_week', () => internal.getByRole('button', { name: 'Week openen of aanmaken', exact: true }).click());
    expect(week.company_id).toBe(fixture.companyId);
    await internal.waitForURL(`**/uren/weken/${week.id}`);
    const group = dayGroup(internal);
    const saved = await saveSource(internal, group, '8:30', '8:30', `Synthetische QA ${fixture.runId}`, true);
    const firstDay = fixtureDay(saved, fixture);
    expect(firstDay.current_revision?.minutes).toBe(510);
    await classify(internal, group);
    await internal.reload();
    await expect(group.getByText('Uursoorten ingedeeld', { exact: true })).toBeVisible();
    const classified = fixtureDay(await readWeek(internal, week.id), fixture);
    expect(classified.classification?.status).toBe('classified');
    expect(classified.classification?.revision_id).toBe(firstDay.current_revision?.id);
    expect(classified.classification?.matrix_version_id).toMatch(/^[\da-f-]{36}$/);
    expect(classified.classification?.allocations).toEqual([expect.objectContaining({ categoryCode: 'OV1', factor: '1.25', minutes: 510, sourceCategory: 'OV1' })]);
    expect(classified.current_revision?.source_input).toBeTruthy();
    checks.push('company deadlines, real week and source revision saved; actual edge classification survives reload');
    await internal.screenshot({ path: resolve(evidence, 'hours-classified-desktop.png'), fullPage: true });

    await login(portal, 'portal', `/portaal/uren/week/${week.id}`);
    const portalProfile = await browserRequest(portal, '/rest/v1/profiles?select=organization_id,role&id=eq.$SELF');
    expect(portalProfile.status).toBe(200);
    expect(portalProfile.body).toEqual([{ organization_id: DEMO_ORG, role: 'medewerker' }]);
    await portal.getByRole('combobox', { name: /Taal urenoverzicht|Hours overview language|Język przeglądu godzin/ }).selectOption('nl');
    const portalGroup = dayGroup(portal, true);
    const portalWeek = await readWeek(portal, week.id);
    expect(portalWeek.members.every(member => member.candidate_id === fixture.candidateId)).toBe(true);
    await portalResponse(portal, portalGroup, 'confirmed');
    await internal.reload();
    await expect(group.getByText('Medewerker akkoord', { exact: true })).toBeVisible();
    const corrected = fixtureDay(await saveSource(internal, group, '8:00', '8:00', `Synthetische correctie ${fixture.runId}`), fixture);
    expect(corrected.current_revision?.id).not.toBe(firstDay.current_revision?.id);
    expect(corrected.confirmation?.revision_id).not.toBe(corrected.current_revision?.id);
    await expect(group.getByText('Wacht op medewerker', { exact: true })).toBeVisible();
    await classify(internal, group);
    const correctedClassification = fixtureDay(await readWeek(internal, week.id), fixture).classification;
    expect(correctedClassification?.matrix_version_id).toBe(classified.classification?.matrix_version_id);
    expect(correctedClassification?.allocations).toEqual([expect.objectContaining({ categoryCode: 'OV1', factor: '1.25', minutes: 480, sourceCategory: 'OV1' })]);
    await portal.reload();
    await portalResponse(portal, portalGroup, 'confirmed');
    await portalResponse(portal, portalGroup, 'disputed');
    await internal.reload();
    await expect(group.getByText('Betwist', { exact: true })).toBeVisible();
    checks.push('real portal deep link, own rows only, exact-revision confirmation, correction invalidation, reconfirmation and dispute');
    await portal.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => portal.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await portal.screenshot({ path: resolve(evidence, 'portal-dispute-mobile.png'), fullPage: true });
    await portal.getByRole('combobox', { name: 'Taal urenoverzicht', exact: true }).selectOption('pl');
    await expect(portal.getByRole('heading', { name: 'Moje godziny', exact: true })).toBeVisible();
    await expect.poll(() => portal.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await portal.screenshot({ path: resolve(evidence, 'portal-polish-mobile.png'), fullPage: true });
    await portal.getByRole('combobox', { name: 'Język przeglądu godzin', exact: true }).selectOption('en');
    await expect(portal.getByRole('heading', { name: 'My hours', exact: true })).toBeVisible();
    await portal.setViewportSize({ width: 1440, height: 1000 });
    await portal.screenshot({ path: resolve(evidence, 'portal-english-desktop.png'), fullPage: true });
    await portal.getByRole('combobox', { name: 'Hours overview language', exact: true }).selectOption('nl');
    checks.push('connected employee screen checked in NL/EN/PL and mobile viewport without overflow');

    await login(stale, 'internal');
    await stale.goto(`/uren/weken/${week.id}`);
    const staleGroup = dayGroup(stale);
    await staleGroup.getByRole('button', { name: 'Wijzigen', exact: true }).click();
    const staleForm = staleGroup.getByRole('form', { name: /Uren invoeren/ });
    await staleForm.getByLabel('Opmerking bij de invoer', { exact: true }).fill('Synthetische stale invoer, mag niet worden opgeslagen');
    await group.getByRole('button', { name: 'Wijzigen', exact: true }).click();
    const currentForm = group.getByRole('form', { name: /Uren invoeren/ });
    const finalNote = `Synthetische actuele invoer ${fixture.runId}`;
    await currentForm.getByLabel('Opmerking bij de invoer', { exact: true }).fill(finalNote);
    await rpcAction(internal, 'hours_save_day_source', () => currentForm.getByRole('button', { name: 'Dag opslaan', exact: true }).click());
    const conflictResponse = await rpcAction<{ code: string }>(stale, 'hours_save_day_source', () => staleForm.getByRole('button', { name: 'Dag opslaan', exact: true }).click(), 409);
    expect(conflictResponse.code).toBe('PT409');
    await expect(staleGroup.getByText(/Deze dag is ondertussen gewijzigd/)).toBeVisible();
    expect(fixtureDay(await readWeek(internal, week.id), fixture).current_revision?.note).toBe(finalNote);
    checks.push('two independently authenticated tabs: stale write promptly rejected with HTTP 409 / PT409; newer input preserved');
    await stale.screenshot({ path: resolve(evidence, 'stale-conflict-desktop.png'), fullPage: true });
    await internal.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => internal.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await internal.screenshot({ path: resolve(evidence, 'hours-current-mobile.png'), fullPage: true });
    await internal.setViewportSize({ width: 1440, height: 1000 });

    const beforeDisable = fixtureDay(await readWeek(internal, week.id), fixture);
    entities = { matrixId: matrix.id, weekId: week.id, dayId: beforeDisable.id, revisionId: beforeDisable.current_revision!.id };
    // Role security is verified in either mode with the real portal JWT.
    const portalEdge = await browserRequest(portal, '/functions/v1/hours-classify-day', { day_id: beforeDisable.id, expected_revision_id: beforeDisable.current_revision!.id });
    expect(portalEdge.status, 'employee cannot invoke internal classification').toBe(403);
    checks.push('actual employee JWT cannot invoke internal classification edge');
    if (!skipSuperadmin) {
    demoWasDisabled = true;
    await moduleSwitch(admin, fixture.organizationName, false);
    for (const [page, path] of [[internal, `/uren/weken/${week.id}`], [portal, `/portaal/uren/week/${week.id}`]] as const) {
      const denied = await browserRequest(page, '/rest/v1/rpc/hours_get_week', { p_week_id: week.id });
      expect(denied.status, 'existing session immediately denied after SaaS off').toBe(403);
      await page.goto(path);
      await expect(page.getByRole('button', { name: /Invoeren|Wijzigen|Reactie opslaan/, exact: true })).toHaveCount(0);
      await expect(page).toHaveURL(page === internal ? /\/uren$/ : /\/portaal\/uren$/);
    }
    const deniedEdge = await browserRequest(internal, '/functions/v1/hours-classify-day', { day_id: beforeDisable.id, expected_revision_id: beforeDisable.current_revision!.id });
    expect(deniedEdge.status).toBe(403);
    const deniedWrite = await browserRequest(portal, '/rest/v1/rpc/hours_confirm_day', { p_day_id: beforeDisable.id, p_expected_revision_id: beforeDisable.current_revision!.id, p_decision: 'confirmed', p_note: null });
    expect(deniedWrite.status).toBe(403);
    const deniedTable = await browserRequest(internal, `/rest/v1/hours_weeks?select=id&id=eq.${week.id}`);
    expect(deniedTable.status).toBe(200);
    expect(deniedTable.body, 'direct table access is also closed').toEqual([]);
    await internal.goto('/uren');
    await expect(internal.locator('a[href="/uren/weken"]')).toHaveCount(0);
    await portal.goto('/portaal/uren');
    await expect(portal.locator('a[href="/portaal/uren/weken"]')).toHaveCount(0);
    checks.push('SaaS OFF hides routes/navigation and blocks old-session read, portal write and real edge calls');
    await moduleSwitch(admin, fixture.organizationName, true);
    demoWasDisabled = false;
    await internal.goto(`/uren/weken/${week.id}`);
    const afterEnable = fixtureDay(await readWeek(internal, week.id), fixture);
    expect(afterEnable).toEqual(beforeDisable);
    await expect(group.getByText(/Eerdere versies/)).toBeVisible();
    await internal.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => internal.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await internal.screenshot({ path: resolve(evidence, 'hours-restored-mobile.png'), fullPage: true });
    const finalJa = await moduleSwitch(admin, fixture.jaOrganizationName);
    await expect(finalJa.toggle).toHaveAttribute('aria-checked', 'false');
    checks.push('SaaS ON restores identical revisions/history; demo ON and JA Werkt OFF at end');
    }
    expect(network.filter(item => /\/functions\/v1\/(?!hours-classify-day)/.test(item.path) && item.method === 'POST'), 'no AI/mail/WhatsApp edge calls').toEqual([]);
    expect(pageErrors, 'no unhandled page errors').toEqual([]);
    result = skipSuperadmin ? 'business-flow-passed' : 'passed';
  } finally {
    if (result === 'failed' && !internal.isClosed() && !new URL(internal.url()).pathname.endsWith('/login')) {
      await internal.screenshot({ path: resolve(evidence, 'failure-internal.png'), fullPage: true }).catch(() => undefined);
      writeFileSync(resolve(evidence, 'failure-ui.txt'), await internal.locator('body').innerText().catch(() => 'Page closed'));
    }
    if (demoWasDisabled) {
      try { await moduleSwitch(admin, fixture.organizationName, true); checks.push('demo restored ON in cleanup'); }
      catch { checks.push('WARNING: demo restore failed; coordinator must restore ON'); }
    }
    writeFileSync(resolve(evidence, 'result.json'), JSON.stringify({
      result, fullSaasAdminCycleTested: !skipSuperadmin && result === 'passed', runId: fixture.runId, at: new Date().toISOString(), entities, checks,
      network, pageErrors, auth: 'real form login in isolated empty browser contexts',
      mocks: false, authInjection: false, traces: false, productionCustomerWrites: false,
    }, null, 2));
    await Promise.allSettled(contexts.map(context => context.close()));
  }
});

test('connected demo: deferred SaaS cycle against the already verified business fixture', async ({ browser }) => {
  test.skip(process.env.HOURS_DEMO_LIVE_READY !== '1' || process.env.HOURS_DEMO_TOGGLE_ONLY !== '1', 'Only run after SaaS account authorization; no new business fixture is needed.');
  const fixture = JSON.parse(readFileSync(required('HOURS_DEMO_FIXTURE'), 'utf8')) as Fixture;
  expect(fixture.organizationId).toBe(DEMO_ORG);
  expect(required('DEMO_ORG_ID')).toBe(DEMO_ORG);
  const evidence = resolve(required('HOURS_DEMO_EVIDENCE_DIR'));
  const business = JSON.parse(readFileSync(process.env.HOURS_DEMO_BUSINESS_RESULT ?? resolve(evidence, 'result.json'), 'utf8')) as {
    result: string; runId: string; entities: { weekId: string; dayId: string; revisionId: string };
  };
  expect(business.result).toMatch(/^(business-flow-passed|passed)$/);
  expect(business.runId).toBe(fixture.runId);
  expect(business.entities.weekId).toMatch(/^[\da-f-]{36}$/);
  const network: NetworkEvent[] = [], pageErrors: string[] = [], checks: string[] = [];
  const contexts = await Promise.all(['internal', 'portal', 'superadmin'].map(() => browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8083',
    viewport: { width: 1440, height: 1000 }, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam',
    storageState: { cookies: [], origins: [] },
  })));
  contexts.forEach(context => { context.setDefaultTimeout(20_000); context.setDefaultNavigationTimeout(30_000); });
  const [internal, portal, admin] = await Promise.all(contexts.map(context => context.newPage()));
  [internal, portal, admin].forEach((page, index) => observe(page, ['internal', 'portal', 'superadmin'][index], network, pageErrors));
  let disabled = false, result = 'failed';
  try {
    await login(admin, 'superadmin');
    const ja = await moduleSwitch(admin, fixture.jaOrganizationName);
    await expect(ja.toggle, 'JA Werkt never enabled for QA').toHaveAttribute('aria-checked', 'false');
    await ja.dialog.screenshot({ path: resolve(evidence, 'ja-module-disabled.png') });
    const jaSetting = await browserRequest(admin, `/rest/v1/organization_modules?select=enabled&organization_id=eq.${JA_ORG}&module_name=eq.uren-workflow`);
    expect(jaSetting.status).toBe(200);
    expect(jaSetting.body).toEqual([{ enabled: false }]);
    await moduleSwitch(admin, fixture.organizationName, true);
    await login(internal, 'internal');
    await internal.goto(`/uren/weken/${business.entities.weekId}`);
    await login(portal, 'portal', `/portaal/uren/week/${business.entities.weekId}`);
    const before = await readWeek(internal, business.entities.weekId);
    const day = fixtureDay(before, fixture);
    expect(day.id).toBe(business.entities.dayId);
    expect(day.current_revision?.id).toBe(business.entities.revisionId);
    checks.push('three real form logins and existing verified fixture loaded; JA Werkt remains OFF');
    disabled = true;
    const off = await moduleSwitch(admin, fixture.organizationName, false);
    await off.dialog.screenshot({ path: resolve(evidence, 'demo-module-disabled.png') });
    for (const page of [internal, portal]) {
      const denied = await browserRequest(page, '/rest/v1/rpc/hours_get_week', { p_week_id: before.id });
      expect(denied.status, 'existing JWT denied immediately after SaaS off').toBe(403);
    }
    const deniedEdge = await browserRequest(internal, '/functions/v1/hours-classify-day', { day_id: day.id, expected_revision_id: day.current_revision!.id });
    expect(deniedEdge.status).toBe(403);
    const deniedWrite = await browserRequest(portal, '/rest/v1/rpc/hours_confirm_day', { p_day_id: day.id, p_expected_revision_id: day.current_revision!.id, p_decision: 'confirmed', p_note: null });
    expect(deniedWrite.status).toBe(403);
    const deniedTable = await browserRequest(internal, `/rest/v1/hours_weeks?select=id&id=eq.${before.id}`);
    expect(deniedTable.status).toBe(200);
    expect(deniedTable.body).toEqual([]);
    for (const pathname of ['/uren/weken', `/uren/weken/${before.id}`, '/uren/matrices']) {
      await internal.goto(pathname);
      await expect(internal).toHaveURL(/\/uren$/);
      await expect(internal.locator('a[href="/uren/weken"]')).toHaveCount(0);
    }
    for (const pathname of ['/portaal/uren/weken', `/portaal/uren/week/${before.id}`]) {
      await portal.goto(pathname);
      await expect(portal).toHaveURL(/\/portaal\/uren$/);
      await expect(portal.locator('a[href="/portaal/uren/weken"]')).toHaveCount(0);
    }
    checks.push('SaaS OFF: old JWT read, write and classification denied; table rows hidden; five direct routes and navigation hidden');
    const on = await moduleSwitch(admin, fixture.organizationName, true);
    disabled = false;
    await on.dialog.screenshot({ path: resolve(evidence, 'demo-module-enabled.png') });
    await internal.goto(`/uren/weken/${before.id}`);
    expect(await readWeek(internal, before.id), 'all history retained across module OFF/ON').toEqual(before);
    await expect(dayGroup(internal).getByText(/Eerdere versies/)).toBeVisible();
    await internal.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => internal.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await internal.screenshot({ path: resolve(evidence, 'hours-restored-mobile.png'), fullPage: true });
    const finalJa = await moduleSwitch(admin, fixture.jaOrganizationName);
    await expect(finalJa.toggle).toHaveAttribute('aria-checked', 'false');
    checks.push('SaaS ON restores exactly the same persisted week/history; final demo ON, JA Werkt OFF');
    expect(network.filter(item => /\/functions\/v1\/(?!hours-classify-day)/.test(item.path) && item.method === 'POST')).toEqual([]);
    expect(pageErrors).toEqual([]);
    result = 'passed';
  } finally {
    if (disabled) {
      try { await moduleSwitch(admin, fixture.organizationName, true); checks.push('demo restored ON in cleanup'); }
      catch { checks.push('WARNING: demo restore failed; coordinator must restore ON'); }
    }
    writeFileSync(resolve(evidence, 'toggle-result.json'), JSON.stringify({
      result, fullSaasAdminCycleTested: result === 'passed', runId: fixture.runId,
      at: new Date().toISOString(), checks, network, pageErrors,
      auth: 'real form login in isolated empty browser contexts', mocks: false, authInjection: false, traces: false,
    }, null, 2));
    await Promise.allSettled(contexts.map(context => context.close()));
  }
});
