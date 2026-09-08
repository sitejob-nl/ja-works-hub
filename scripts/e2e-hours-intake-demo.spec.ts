import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Connected QA for internal hours intake against the verified demo tenant.
 * Run only after the intake migration is deployed. Load credentials with
 * node --env-file; never copy them into fixtures or evidence. Every business
 * write below goes through the real product forms with a real login. This flow
 * has no outgoing message path, so no communication settings are touched.
 */
const DEMO_ORG = '6dedabe4-f62c-479e-b5fc-ebfcb824d76f';
const API = 'https://noaupcteygfvlyymqtew.supabase.co';
const AUTH_KEY = 'sb-noaupcteygfvlyymqtew-auth-token';
const fixturePath = process.env.HOURS_INTAKE_FIXTURE;
type Fixture = {
  organizationId: string; companyId: string; companyName: string; candidateId: string;
  weekId: string; weekStart: string; dayId: string; workDate: string; existingSourceCount: number;
};
type Revision = { id: string; revision_number: number; minutes: number; source_references: { kind: string; label: string; reference: string | null }[]; source_input: unknown };
type Day = { id: string; work_date: string; current_revision: Revision | null; confirmation: { revision_id: string; decision: string } | null; classification?: { revision_id: string; status: string; allocations?: unknown[] } | null; history: unknown[] };
type Week = { id: string; members: { candidate_id: string; days: Day[] }[] };
type Proposal = { id: string; status: string; minutes: number; page_label: string | null; applied_created_revision: boolean | null; applied_revision_id: string | null };
type Sources = { week_id: string; can_manage: boolean; sources: { id: string; file_name: string; byte_size: number; storage_path: string; proposals: Proposal[] }[] };
const evidence: Record<string, unknown> = { checks: [] };
const network: { method: string; path: string; status: number }[] = [];
const pageErrors: string[] = [];

function required(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment key: ${key}`);
  return value;
}

function record(name: string, detail: Record<string, unknown>) {
  (evidence.checks as unknown[]).push({ name, ...detail });
}

async function login(page: Page, zone: 'internal' | 'portal', returnTo?: string) {
  const prefix = zone === 'internal' ? 'DEMO_ORG' : 'DEMO_PORTAL';
  const pathname = zone === 'internal' ? '/login' : `/portaal/login?returnTo=${encodeURIComponent(returnTo ?? '/portaal')}`;
  await page.goto(pathname);
  expect(await page.evaluate(key => sessionStorage.getItem(key), AUTH_KEY), 'fresh login has no inherited session').toBeNull();
  await page.locator('#email').fill(required(`${prefix}_EMAIL`));
  await page.locator('#password').fill(required(`${prefix}_PASSWORD`));
  const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/auth/v1/token' && response.request().method() === 'POST');
  await page.locator('form').getByRole('button', { name: /Inloggen|Log in/i }).click();
  expect((await loginResponse).status(), `${zone} form authentication`).toBe(200);
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
  expect(await page.evaluate(key => Boolean(JSON.parse(sessionStorage.getItem(key) ?? 'null')?.access_token), AUTH_KEY)).toBe(true);
}

function observe(page: Page, zone: string) {
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== API) return;
    // Paths and statuses only: no query strings, headers, bodies or contact details.
    network.push({ method: response.request().method(), path: `${zone}:${url.pathname}`, status: response.status() });
  });
  page.on('pageerror', error => pageErrors.push(`${zone}: ${error.name}`));
}

/** Authenticated probe with the existing real UI session; never an injected token. */
async function browserRequest(page: Page, path: string, payload?: unknown) {
  const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? required('VITE_SUPABASE_ANON_KEY');
  return page.evaluate(async ({ api, key, publicKey, path, payload }) => {
    const session = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (!session?.access_token) throw new Error('The UI login has no active session');
    const response = await fetch(`${api}${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { apikey: publicKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { api: API, key: AUTH_KEY, publicKey, path, payload });
}

async function readWeek(page: Page, weekId: string): Promise<Week> {
  const response = await browserRequest(page, '/rest/v1/rpc/hours_get_week', { p_week_id: weekId });
  expect(response.status).toBe(200);
  return response.body as Week;
}

async function readSources(page: Page, weekId: string): Promise<Sources> {
  const response = await browserRequest(page, '/rest/v1/rpc/hours_get_week_sources', { p_week_id: weekId });
  expect(response.status).toBe(200);
  return response.body as Sources;
}

function findDay(week: Week, fixture: Fixture): Day {
  const member = week.members.find(item => item.candidate_id === fixture.candidateId);
  expect(member, 'the portal candidate is a member of this week').toBeDefined();
  const day = member!.days.find(item => item.id === fixture.dayId);
  expect(day, 'the target day belongs to this member').toBeDefined();
  return day!;
}

/** Deterministic synthetic bytes; nothing here comes from a real time sheet. */
function syntheticPdf(marker: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% Synthetische urenmodule QA ${marker}\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`, 'utf8');
}

const panel = (page: Page) => page.getByRole('region', { name: 'Klantweek uren', exact: true });
/** Scope every action to this run's own source, never an earlier run's. */
const sourceCard = (page: Page, fileName: string) => panel(page).getByRole('group', { name: `Bron ${fileName}` });

test('connected demo: internal source upload, private storage, reviewed proposal and explicit application', async ({ browser }) => {
  test.skip(process.env.HOURS_INTAKE_LIVE_READY !== '1', 'Requires an explicitly deployed intake migration and a scoped demo fixture.');
  if (!fixturePath) throw new Error('Set HOURS_INTAKE_FIXTURE to the prepared fixture file');
  const fixture = JSON.parse(readFileSync(resolve(fixturePath), 'utf8')) as Fixture;
  expect(fixture.organizationId, 'the fixture must target the verified demo organization').toBe(DEMO_ORG);

  const internal = await browser.newContext();
  const page = await internal.newPage();
  observe(page, 'internal');
  await login(page, 'internal');

  // --- the week opens with the intake panel and no sources of its own -------
  await page.goto(`/uren/weken/${fixture.weekId}`);
  const sourcesCard = page.getByText('Ontvangen bronnen', { exact: true });
  await expect(sourcesCard).toBeVisible();
  const before = await readSources(page, fixture.weekId);
  expect(before.can_manage, 'an internal manager may run the intake').toBe(true);
  expect(before.sources).toHaveLength(fixture.existingSourceCount);
  // Names and bytes are unique per run so an earlier run is never mistaken for this one.
  const runId = process.env.HOURS_INTAKE_RUN_ID ?? String(Date.now());
  const fileName = `urenbriefje-${fixture.workDate}-${runId}.pdf`;
  const beforeDay = findDay(await readWeek(page, fixture.weekId), fixture);
  expect(beforeDay.current_revision, 'the target day starts without a version').toBeNull();
  record('week opens with an empty intake panel', { weekId: fixture.weekId, existingSources: before.sources.length });

  // --- an unsupported file never reaches storage ---------------------------
  const upload = panel(page).getByLabel('Urenbriefje uploaden');
  await upload.setInputFiles({ name: 'uren-week36.xlsx', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('synthetisch') });
  await expect(page.getByRole('alert').filter({ hasText: 'Alleen PDF, JPG en PNG' })).toBeVisible();
  expect(network.some(item => item.path.includes('/storage/v1/object/hours-sources')), 'nothing was uploaded').toBe(false);
  record('unsupported file rejected before storage', { storageWrites: 0 });

  // --- uploading a PDF stores the original privately ------------------------
  const bytes = syntheticPdf(`${fixture.weekId}-${fixture.dayId}-${runId}`);
  const storeResponse = page.waitForResponse(response => new URL(response.url()).pathname.startsWith('/storage/v1/object/hours-sources/'));
  const registerResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/rpc/hours_add_week_source');
  await upload.setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: bytes });
  expect((await storeResponse).status(), 'storage accepted the original').toBe(200);
  expect((await registerResponse).status(), 'the source was registered').toBe(200);
  await expect(page.getByText(`“${fileName}” is als bron bewaard.`)).toBeVisible();
  const stored = await readSources(page, fixture.weekId);
  expect(stored.sources).toHaveLength(fixture.existingSourceCount + 1);
  const source = stored.sources.find(item => item.file_name === fileName)!;
  expect(source.byte_size, 'the recorded size comes from storage').toBe(bytes.byteLength);
  expect(source.storage_path.startsWith(`${DEMO_ORG}/${fixture.weekId}/`), 'the original is filed under tenant and week').toBe(true);
  record('original stored privately', { fileName: source.file_name, byteSize: source.byte_size });

  // --- the same attachment again is one source, not a second ---------------
  await upload.setInputFiles({ name: `doorgestuurd-${fileName}`, mimeType: 'application/pdf', buffer: bytes });
  await expect(page.getByText(/was al eerder bij deze week ontvangen/)).toBeVisible();
  const afterRepeat = await readSources(page, fixture.weekId);
  expect(afterRepeat.sources).toHaveLength(fixture.existingSourceCount + 1);
  expect(afterRepeat.sources.find(item => item.id === source.id)!.proposals).toHaveLength(0);
  record('repeated delivery deduplicated', { sources: afterRepeat.sources.length, proposals: 0 });

  // --- the original is only reachable through a short-lived signed link ----
  const anonymous = await browser.newContext();
  const publicProbe = await anonymous.request.get(`${API}/storage/v1/object/public/hours-sources/${source.storage_path}`);
  expect(publicProbe.status(), 'the bucket is not public').toBeGreaterThanOrEqual(400);
  const signResponse = page.waitForResponse(response => new URL(response.url()).pathname.includes('/storage/v1/object/sign/hours-sources/'));
  const opened = page.waitForEvent('popup').catch(() => null);
  await panel(page).getByRole('button', { name: /Bron bekijken/ }).first().click();
  expect((await signResponse).status(), 'a signed link was issued').toBe(200);
  const popup = await opened;
  if (popup) await popup.close();
  record('original reachable only through a signed link', { publicStatus: publicProbe.status() });

  // --- a reviewed proposal is recorded, and it is not yet an hour ----------
  await sourceCard(page, fileName).getByRole('button', { name: 'Voorstel maken' }).click();
  await page.getByLabel('Medewerker en werkdag').selectOption(fixture.dayId);
  await page.getByLabel('Gewerkte uren volgens de bron').fill('8:00');
  await page.getByLabel('Vindplaats in de bron').fill('pagina 2');
  await page.getByLabel('Diensttijden vastleggen').check();
  await page.getByLabel('Begintijd dienst 1').fill('08:00');
  await page.getByLabel('Eindtijd dienst 1').fill('16:30');
  await page.getByLabel('Einddag dienst 1').selectOption('0');
  await page.getByRole('button', { name: 'Pauze toevoegen aan dienst 1' }).click();
  await page.getByLabel('Pauze begint').fill('12:00');
  await page.getByLabel('Pauze eindigt').fill('12:30');
  await page.getByLabel('Begindag pauze 1 dienst 1').selectOption('0');
  await page.getByLabel('Einddag pauze 1 dienst 1').selectOption('0');
  await page.getByLabel(/pauzes van dienst 1 zijn gecontroleerd/).check();
  const proposalResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/rpc/hours_create_source_proposal');
  await page.getByRole('button', { name: 'Voorstel bewaren' }).click();
  expect((await proposalResponse).status(), 'the proposal was recorded').toBe(200);
  const proposed = await readSources(page, fixture.weekId);
  const proposal = proposed.sources.find(item => item.id === source.id)!.proposals.find(item => item.status === 'open')!;
  expect(proposal.minutes).toBe(480);
  expect(proposal.page_label).toBe('pagina 2');
  const stillEmpty = findDay(await readWeek(page, fixture.weekId), fixture);
  expect(stillEmpty.current_revision, 'a proposal writes no hours by itself').toBeNull();
  record('proposal recorded without touching the day', { minutes: proposal.minutes, dayHasRevision: false });

  // --- applying is explicit and writes exactly one new day version ---------
  const row = sourceCard(page, fileName).getByRole('group', { name: /^Voorstel / }).first();
  await expect(row).toBeVisible();
  await expect(row.getByRole('listitem').first()).toContainText('nog niet ontvangen');
  const applyResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/rpc/hours_apply_source_proposal');
  await row.getByRole('button', { name: 'Toepassen als dagversie' }).click();
  expect((await applyResponse).status(), 'the application succeeded').toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Toegepast als nieuwe dagversie' })).toBeVisible();
  const appliedDay = findDay(await readWeek(page, fixture.weekId), fixture);
  expect(appliedDay.current_revision?.minutes).toBe(480);
  expect(appliedDay.current_revision?.revision_number).toBe(1);
  expect(appliedDay.current_revision?.source_references).toEqual([
    { kind: 'upload', label: fileName, reference: 'pagina 2' },
  ]);
  const applied = (await readSources(page, fixture.weekId)).sources.find(item => item.id === source.id)!.proposals.find(item => item.id === proposal.id)!;
  expect(applied.status).toBe('applied');
  expect(applied.applied_created_revision).toBe(true);
  expect(applied.applied_revision_id).toBe(appliedDay.current_revision?.id);
  record('applied as a new day version with the source as origin', {
    revisionNumber: appliedDay.current_revision?.revision_number,
    origin: appliedDay.current_revision?.source_references,
  });

  // --- an already resolved proposal cannot be applied a second time --------
  const repeat = await browserRequest(page, '/rest/v1/rpc/hours_apply_source_proposal', {
    p_proposal_id: proposal.id, p_expected_revision_id: appliedDay.current_revision?.id,
  });
  expect(repeat.status, 'a resolved proposal is refused').toBe(400);
  const unchanged = findDay(await readWeek(page, fixture.weekId), fixture);
  expect(unchanged.current_revision?.id).toBe(appliedDay.current_revision?.id);
  record('second application refused without writing', { status: repeat.status });

  // --- the existing classification runs on the applied revision ------------
  await page.reload();
  const dayGroup = panel(page).getByRole('group', { name: new RegExp(`, \\w+ ${Number(fixture.workDate.slice(8))} `) }).first();
  const classifyResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/functions/v1/hours-classify-day'));
  await dayGroup.getByRole('button', { name: 'Uursoorten controleren' }).click();
  expect((await classifyResponse).status(), 'the classification boundary answered').toBe(200);
  const classified = findDay(await readWeek(page, fixture.weekId), fixture);
  expect(classified.classification?.revision_id).toBe(classified.current_revision?.id);
  expect(['classified', 'blocked']).toContain(classified.classification?.status);
  record('classification ran on the applied revision', {
    status: classified.classification?.status,
    allocations: classified.classification?.allocations?.length ?? 0,
  });

  // --- the employee sees the source origin and can confirm ----------------
  const portalContext = await browser.newContext();
  const portalPage = await portalContext.newPage();
  observe(portalPage, 'portal');
  await login(portalPage, 'portal', `/portaal/uren/week/${fixture.weekId}`);
  await portalPage.goto(`/portaal/uren/week/${fixture.weekId}`);
  const portalWeek = await readWeek(portalPage, fixture.weekId);
  const portalDay = findDay(portalWeek, fixture);
  expect(portalDay.current_revision?.source_references).toEqual([
    { kind: 'upload', label: fileName, reference: 'pagina 2' },
  ]);
  expect(portalDay.history, 'internal history stays internal').toEqual([]);
  expect(portalDay.classification ?? null, 'internal classification stays internal').toBeNull();
  const sourceProbe = await browserRequest(portalPage, '/rest/v1/hours_week_sources?select=id');
  expect(sourceProbe.body, 'the employee sees no sources').toEqual([]);
  const proposalProbe = await browserRequest(portalPage, '/rest/v1/hours_source_proposals?select=id');
  expect(proposalProbe.body, 'the employee sees no proposals').toEqual([]);
  const intakeProbe = await browserRequest(portalPage, '/rest/v1/rpc/hours_get_week_sources', { p_week_id: fixture.weekId });
  expect(intakeProbe.status, 'the intake projection refuses a portal user').toBe(403);
  const portalGroup = portalPage.getByRole('region', { name: 'Mijn uren', exact: true })
    .getByRole('group', { name: new RegExp(`^\\w+ ${Number(fixture.workDate.slice(8))} `) }).first();
  await portalGroup.getByRole('button', { name: 'Akkoord', exact: true }).click();
  const confirmResponse = portalPage.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/rpc/hours_confirm_day');
  await portalGroup.getByRole('form').getByRole('button', { name: 'Reactie opslaan', exact: true }).click();
  expect((await confirmResponse).status(), 'the employee confirmed the applied version').toBe(200);
  const confirmed = findDay(await readWeek(portalPage, fixture.weekId), fixture);
  expect(confirmed.confirmation?.decision).toBe('confirmed');
  expect(confirmed.confirmation?.revision_id).toBe(confirmed.current_revision?.id);
  record('employee sees the source origin and confirms the exact version', {
    decision: confirmed.confirmation?.decision, sourcesVisibleToEmployee: 0, intakeProjectionStatus: intakeProbe.status,
  });

  // --- a correction from the source invalidates the earlier agreement ------
  await page.reload();
  await sourceCard(page, fileName).getByRole('button', { name: 'Voorstel maken' }).click();
  await page.getByLabel('Medewerker en werkdag').selectOption(fixture.dayId);
  await page.getByLabel('Gewerkte uren volgens de bron').fill('4,75');
  await page.getByLabel('Vindplaats in de bron').fill('handgeschreven correctie');
  const correctionResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/rpc/hours_create_source_proposal');
  await page.getByRole('button', { name: 'Voorstel bewaren' }).click();
  expect((await correctionResponse).status()).toBe(200);
  const correctionRow = sourceCard(page, fileName).getByRole('group', { name: /^Voorstel / }).filter({ hasText: '4:45 uur' }).first();
  await expect(correctionRow.getByRole('listitem').first()).toContainText('8:00 uur → 4:45 uur');
  const correctionApply = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/rpc/hours_apply_source_proposal');
  await correctionRow.getByRole('button', { name: 'Toepassen als dagversie' }).click();
  expect((await correctionApply).status()).toBe(200);
  const corrected = findDay(await readWeek(page, fixture.weekId), fixture);
  expect(corrected.current_revision?.minutes).toBe(285);
  expect(corrected.current_revision?.revision_number).toBe(2);
  expect(corrected.confirmation, 'the earlier agreement no longer applies').toBeNull();
  expect(corrected.history.length, 'both versions stay retrievable').toBeGreaterThanOrEqual(2);
  record('correction invalidates the earlier agreement', {
    minutes: corrected.current_revision?.minutes, revisionNumber: corrected.current_revision?.revision_number,
    confirmation: null, historyLength: corrected.history.length,
  });

  // --- a stale second session cannot overwrite the newer version -----------
  const stale = await browserRequest(page, '/rest/v1/rpc/hours_apply_source_proposal', {
    p_proposal_id: proposal.id, p_expected_revision_id: appliedDay.current_revision?.id,
  });
  expect(stale.status, 'a stale application is refused, not retried forever').toBe(400);
  const afterStale = findDay(await readWeek(page, fixture.weekId), fixture);
  expect(afterStale.current_revision?.id).toBe(corrected.current_revision?.id);
  record('stale application writes nothing', { status: stale.status });

  expect(pageErrors, 'no JavaScript page errors').toEqual([]);
  expect(network.filter(item => item.status >= 500), 'no server errors').toEqual([]);

  Object.assign(evidence, {
    result: 'intake-flow-passed',
    organizationId: DEMO_ORG, companyName: fixture.companyName, weekId: fixture.weekId, workDate: fixture.workDate,
    network, pageErrors, messagesSent: 0, paidAiCalls: 0,
    verifiedAt: new Date().toISOString(),
  });
  const directory = process.env.HOURS_INTAKE_EVIDENCE_DIR;
  if (directory) {
    mkdirSync(resolve(directory), { recursive: true });
    writeFileSync(resolve(directory, 'result.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  await anonymous.close();
  await portalContext.close();
  await internal.close();
});
