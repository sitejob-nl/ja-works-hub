import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Connected QA for source pages and controlled assignment (ticket T2) against
 * the verified demo tenant. Run only after the page migration is deployed. Load
 * credentials with node --env-file; never copy them into fixtures or evidence.
 * Every business write below goes through the real product forms with a real
 * login. This flow has no outgoing message path, so no communication settings
 * are touched, and it applies exactly one proposal so it claims exactly one
 * untouched workday.
 */
const DEMO_ORG = '6dedabe4-f62c-479e-b5fc-ebfcb824d76f';
const API = 'https://noaupcteygfvlyymqtew.supabase.co';
const AUTH_KEY = 'sb-noaupcteygfvlyymqtew-auth-token';
const fixturePath = process.env.HOURS_PAGES_FIXTURE;
type Fixture = {
  runId: string; organizationId: string; companyId: string; companyName: string;
  weekId: string; weekStart: string;
  primaryCandidateId: string; primaryMemberId: string;
  secondaryCandidateId: string; secondaryMemberId: string;
  applyDayId: string; applyWorkDate: string;
  takeoverDayIds: string[]; takeoverWorkDates: string[];
  existingSourceCount: number;
};
type Revision = { id: string; revision_number: number; minutes: number; source_references: { kind: string; label: string; reference: string | null }[] };
type Day = { id: string; work_date: string; current_revision: Revision | null };
type Week = { id: string; members: { id: string; candidate_id: string; days: Day[] }[] };
type Proposal = {
  id: string; day_id: string; member_id: string; status: string; minutes: number;
  page_number: number | null; page_label: string | null;
  assignment_uncertain: boolean; assignment_confirmed_at: string | null; assignment_note: string | null;
  applied_created_revision: boolean | null; applied_revision_id: string | null;
};
type SourcePage = { id: string; page_number: number; assignment: string; member_id: string | null; candidate_name: string | null };
type Sources = {
  week_id: string; can_manage: boolean; open_proposals: number; undecided_assignments: number;
  sources: { id: string; file_name: string; page_count: number | null; storage_path: string; pages: SourcePage[]; proposals: Proposal[] }[];
};
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

async function login(page: Page, zone: 'internal' | 'portal') {
  const prefix = zone === 'internal' ? 'DEMO_ORG' : 'DEMO_PORTAL';
  await page.goto(zone === 'internal' ? '/login' : '/portaal/login');
  expect(await page.evaluate(key => sessionStorage.getItem(key), AUTH_KEY), 'fresh login has no inherited session').toBeNull();
  await page.locator('#email').fill(required(`${prefix}_EMAIL`));
  await page.locator('#password').fill(required(`${prefix}_PASSWORD`));
  const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/auth/v1/token' && response.request().method() === 'POST');
  await page.locator('form').getByRole('button', { name: /Inloggen|Log in/i }).click();
  expect((await loginResponse).status(), `${zone} form authentication`).toBe(200);
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
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

function dayOf(week: Week, memberId: string, dayId: string): Day {
  const member = week.members.find(item => item.id === memberId);
  expect(member, 'the member belongs to this week').toBeDefined();
  const day = member!.days.find(item => item.id === dayId);
  expect(day, 'the day belongs to that member').toBeDefined();
  return day!;
}

/**
 * A real multi-page PDF, so the browser's own page count is exercised rather
 * than a number this test made up. Deterministic synthetic bytes; nothing here
 * comes from a real time sheet.
 */
function syntheticPdf(marker: string, pages: number): Buffer {
  const header = `%PDF-1.4\n% Synthetische urenmodule QA ${marker}\n`;
  const kids = Array.from({ length: pages }, (_, index) => `${index + 3} 0 R`).join(' ');
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    `<</Type/Pages/Kids[${kids}]/Count ${pages}>>`,
    ...Array.from({ length: pages }, () => '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>'),
  ];
  let body = '';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(header.length + body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const startXref = header.length + body.length;
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)].join('');
  const trailer = `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${startXref}\n%%EOF\n`;
  return Buffer.from(header + body + xref + trailer, 'latin1');
}

const panel = (page: Page) => page.getByRole('region', { name: 'Klantweek uren', exact: true });
/** Scope every action to this run's own source, never an earlier run's. */
const sourceCard = (page: Page, fileName: string) => panel(page).getByRole('group', { name: `Bron ${fileName}` });

test('connected demo: source pages, controlled assignment and an undecided proposal that blocks applying', async ({ browser }) => {
  test.skip(process.env.HOURS_PAGES_LIVE_READY !== '1', 'Requires an explicitly deployed page migration and a scoped demo fixture.');
  if (!fixturePath) throw new Error('Set HOURS_PAGES_FIXTURE to the prepared fixture file');
  const fixture = JSON.parse(readFileSync(resolve(fixturePath), 'utf8')) as Fixture;
  expect(fixture.organizationId, 'the fixture must target the verified demo organization').toBe(DEMO_ORG);

  const internal = await browser.newContext();
  const page = await internal.newPage();
  observe(page, 'internal');
  await login(page, 'internal');

  await page.goto(`/uren/weken/${fixture.weekId}`);
  await expect(page.getByText('Ontvangen bronnen', { exact: true })).toBeVisible();
  const before = await readSources(page, fixture.weekId);
  expect(before.can_manage, 'an internal manager may run the intake').toBe(true);
  expect(before.sources).toHaveLength(fixture.existingSourceCount);
  expect(before.undecided_assignments, 'the week starts without undecided assignments').toBe(0);
  const runId = process.env.HOURS_PAGES_RUN_ID ?? fixture.runId;
  const fileName = `crew-urenbriefjes-${fixture.weekStart}-${runId}.pdf`;
  record('week opens with an empty intake panel', { weekId: fixture.weekId, existingSources: before.sources.length });

  // --- a three-page delivery records its own page count ---------------------
  const bytes = syntheticPdf(`${fixture.weekId}-${runId}`, 3);
  const upload = panel(page).getByLabel('Urenbriefje uploaden');
  const registerResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/rpc/hours_add_week_source');
  await upload.setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: bytes });
  expect((await registerResponse).status(), 'the source was registered').toBe(200);
  await expect(page.getByText(`“${fileName}” is als bron bewaard.`)).toBeVisible();
  const stored = await readSources(page, fixture.weekId);
  const source = stored.sources.find(item => item.file_name === fileName)!;
  expect(source.page_count, 'the browser counted the delivered pages').toBe(3);
  await expect(sourceCard(page, fileName).getByText(/3 pagina/)).toBeVisible();
  record('delivered page count recorded from the real pdf', { pageCount: source.page_count });

  // --- page one is on one name, so the whole page may be taken over --------
  await sourceCard(page, fileName).getByRole('button', { name: /Paginatoewijzing/ }).click();
  const decision = page.getByRole('form', { name: 'Paginatoewijzing vastleggen' });
  await decision.getByLabel(/^Pagina/).fill('1');
  await decision.getByLabel('Toewijzing').selectOption('single');
  await decision.getByLabel('Medewerker op deze pagina').selectOption(fixture.secondaryMemberId);
  const pageResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/rpc/hours_set_source_page');
  await decision.getByRole('button', { name: 'Toewijzing vastleggen' }).click();
  expect((await pageResponse).status(), 'the page decision was recorded').toBe(200);
  await expect(sourceCard(page, fileName).getByText(/Pagina 1 — Eén medewerker/)).toBeVisible();
  record('page one recorded as one employee', { pageNumber: 1, assignment: 'single' });

  // --- taking the page over produces proposals per day, never hours --------
  await sourceCard(page, fileName).getByRole('button', { name: 'Hele pagina overnemen' }).click();
  const takeover = page.getByRole('form', { name: 'Pagina 1 overnemen' });
  await takeover.locator(`#takeover-hours-${fixture.takeoverDayIds[0]}`).fill('8:00');
  await takeover.locator(`#takeover-hours-${fixture.takeoverDayIds[1]}`).fill('7,5');
  const takeoverResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/rpc/hours_create_page_proposals');
  await takeover.getByRole('button', { name: 'Voorstellen bewaren' }).click();
  expect((await takeoverResponse).status(), 'the page take-over succeeded').toBe(200);
  const afterTakeover = await readSources(page, fixture.weekId);
  const takenOver = afterTakeover.sources.find(item => item.id === source.id)!.proposals;
  expect(takenOver.map(item => item.day_id).sort(), 'one proposal per filled day').toEqual([...fixture.takeoverDayIds].sort());
  expect(new Set(takenOver.map(item => item.member_id)), 'every proposal stays on the page owner').toEqual(new Set([fixture.secondaryMemberId]));
  expect(takenOver.map(item => item.page_number)).toEqual([1, 1]);
  expect(takenOver.every(item => item.status === 'open'), 'a take-over is still only proposals').toBe(true);
  const weekAfterTakeover = await readWeek(page, fixture.weekId);
  for (const dayId of fixture.takeoverDayIds) {
    expect(dayOf(weekAfterTakeover, fixture.secondaryMemberId, dayId).current_revision, 'a proposal writes no hours').toBeNull();
  }
  record('whole page taken over as proposals only', {
    proposals: takenOver.length, minutes: takenOver.map(item => item.minutes).sort((a, b) => a - b), revisionsWritten: 0,
  });

  // --- applying a taken-over day names its page exactly once ---------------
  const takenRow = sourceCard(page, fileName).getByRole('group', { name: /^Voorstel / }).filter({ hasText: '8:00 uur' }).first();
  const takenApply = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/rpc/hours_apply_source_proposal');
  await takenRow.getByRole('button', { name: 'Toepassen als dagversie' }).click();
  expect((await takenApply).status(), 'the taken-over day applied').toBe(200);
  const takenDay = dayOf(await readWeek(page, fixture.weekId), fixture.secondaryMemberId, fixture.takeoverDayIds[0]);
  expect(takenDay.current_revision?.source_references, 'the page appears once, not twice').toEqual([
    { kind: 'upload', label: fileName, reference: 'pagina 1' },
  ]);
  record('taken-over day names its page exactly once', { origin: takenDay.current_revision?.source_references });

  // --- a page decision may not contradict what already stands --------------
  const contradiction = await browserRequest(page, '/rest/v1/rpc/hours_set_source_page', {
    p_source_id: source.id, p_page_number: 1, p_assignment: 'unclear', p_member_id: null, p_note: null,
  });
  expect(contradiction.status, 'calling a decided page unreadable is refused while its proposals stand').toBe(400);
  expect((await readSources(page, fixture.weekId)).sources.find(item => item.id === source.id)!.pages
    .find(item => item.page_number === 1)!.assignment, 'the standing decision is untouched').toBe('single');
  record('contradicting page decision refused', { status: contradiction.status });

  // --- the shortcut can never reach another employee -----------------------
  const foreign = await browserRequest(page, '/rest/v1/rpc/hours_create_page_proposals', {
    p_source_id: source.id, p_page_number: 1, p_entries: [{ day_id: fixture.applyDayId, minutes: 300 }],
  });
  expect(foreign.status, 'a day of another employee is refused').toBe(400);
  expect((await readSources(page, fixture.weekId)).sources.find(item => item.id === source.id)!.proposals,
    'the refusal wrote nothing').toHaveLength(2);
  record('page take-over cannot reach another employee', { status: foreign.status });

  // --- an uncertain assignment on page two blocks applying ----------------
  await sourceCard(page, fileName).getByRole('button', { name: 'Voorstel maken' }).click();
  const form = page.getByRole('form', { name: 'Invoervoorstel uit bron' });
  await form.getByLabel('Medewerker en werkdag').selectOption(fixture.applyDayId);
  await form.getByLabel('Gewerkte uren volgens de bron').fill('6:30');
  await form.getByLabel(/^Pagina/).fill('2');
  await form.getByLabel('Vindplaats op die pagina').fill('onderste blok');
  await form.getByLabel('Toewijzing onzeker').check();
  const proposalResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/rpc/hours_create_source_proposal');
  await form.getByRole('button', { name: 'Voorstel bewaren' }).click();
  expect((await proposalResponse).status(), 'the proposal was recorded').toBe(200);
  const proposed = await readSources(page, fixture.weekId);
  const uncertain = proposed.sources.find(item => item.id === source.id)!.proposals
    .find(item => item.day_id === fixture.applyDayId)!;
  expect(uncertain.page_number).toBe(2);
  expect(uncertain.assignment_uncertain).toBe(true);
  expect(uncertain.assignment_confirmed_at).toBeNull();
  expect(proposed.undecided_assignments, 'the week counts it as an open point').toBe(1);
  await expect(panel(page).getByText(/onbesliste toewijzing/)).toBeVisible();
  const uncertainRow = sourceCard(page, fileName).getByRole('group', { name: /^Voorstel / }).filter({ hasText: '6:30 uur' }).first();
  await expect(uncertainRow.getByText('Toewijzing onbeslist')).toBeVisible();
  await expect(uncertainRow.getByRole('button', { name: 'Toepassen als dagversie' })).toBeDisabled();
  const blocked = await browserRequest(page, '/rest/v1/rpc/hours_apply_source_proposal', {
    p_proposal_id: uncertain.id, p_expected_revision_id: null,
  });
  expect(blocked.status, 'the server refuses it too, not only the screen').toBe(400);
  expect(dayOf(await readWeek(page, fixture.weekId), fixture.primaryMemberId, fixture.applyDayId).current_revision,
    'a blocked application writes nothing').toBeNull();
  record('undecided assignment blocks applying and counts as an open point', {
    undecidedAssignments: proposed.undecided_assignments, serverStatus: blocked.status, revisionsWritten: 0,
  });

  // --- confirming the employee unblocks it, and only then does it apply ----
  await uncertainRow.getByRole('button', { name: 'Toewijzing bevestigen' }).click();
  await page.getByLabel(/Hoe heb je vastgesteld/).fill('Naam op pagina 2 vergeleken met de plaatsingslijst');
  const confirmResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/rpc/hours_confirm_proposal_assignment');
  await page.getByRole('button', { name: 'Medewerker bevestigen' }).click();
  expect((await confirmResponse).status(), 'the assignment was confirmed').toBe(200);
  const confirmed = (await readSources(page, fixture.weekId));
  const settled = confirmed.sources.find(item => item.id === source.id)!.proposals.find(item => item.id === uncertain.id)!;
  expect(settled.status, 'confirming decides the doubt, it does not apply the proposal').toBe('open');
  expect(settled.assignment_confirmed_at).not.toBeNull();
  expect(settled.assignment_note).toBe('Naam op pagina 2 vergeleken met de plaatsingslijst');
  expect(confirmed.undecided_assignments, 'the open point is cleared').toBe(0);
  expect(dayOf(await readWeek(page, fixture.weekId), fixture.primaryMemberId, fixture.applyDayId).current_revision,
    'confirming still writes no hours').toBeNull();

  const applyResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/rpc/hours_apply_source_proposal');
  await uncertainRow.getByRole('button', { name: 'Toepassen als dagversie' }).click();
  expect((await applyResponse).status(), 'the application succeeded').toBe(200);
  await expect(page.getByRole('status').filter({ hasText: 'Toegepast als nieuwe dagversie' })).toBeVisible();
  const appliedDay = dayOf(await readWeek(page, fixture.weekId), fixture.primaryMemberId, fixture.applyDayId);
  expect(appliedDay.current_revision?.minutes).toBe(390);
  expect(appliedDay.current_revision?.revision_number).toBe(1);
  expect(appliedDay.current_revision?.source_references, 'the page is part of the recorded origin').toEqual([
    { kind: 'upload', label: fileName, reference: 'pagina 2 · onderste blok' },
  ]);
  record('confirmed assignment applies as one new day version naming its page', {
    minutes: appliedDay.current_revision?.minutes, origin: appliedDay.current_revision?.source_references,
  });

  // --- a page that demonstrably carries two employees cannot go on one name -
  await sourceCard(page, fileName).getByRole('button', { name: 'Voorstel maken' }).click();
  const third = page.getByRole('form', { name: 'Invoervoorstel uit bron' });
  await third.getByLabel('Medewerker en werkdag').selectOption(fixture.takeoverDayIds[0]);
  await third.getByLabel('Gewerkte uren volgens de bron').fill('5:00');
  await third.getByLabel(/^Pagina/).fill('3');
  const thirdResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/rpc/hours_create_source_proposal');
  await third.getByRole('button', { name: 'Voorstel bewaren' }).click();
  expect((await thirdResponse).status()).toBe(200);

  await sourceCard(page, fileName).getByRole('button', { name: 'Voorstel maken' }).click();
  const fourth = page.getByRole('form', { name: 'Invoervoorstel uit bron' });
  await fourth.getByLabel('Medewerker en werkdag').selectOption(fixture.applyDayId);
  await fourth.getByLabel('Gewerkte uren volgens de bron').fill('4:00');
  await fourth.getByLabel(/^Pagina/).fill('3');
  const fourthResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/rpc/hours_create_source_proposal');
  await fourth.getByRole('button', { name: 'Voorstel bewaren' }).click();
  expect((await fourthResponse).status()).toBe(200);
  const shared = (await readSources(page, fixture.weekId)).sources.find(item => item.id === source.id)!.proposals
    .filter(item => item.page_number === 3);
  expect(new Set(shared.map(item => item.member_id)).size, 'page three demonstrably carries two employees').toBe(2);

  await sourceCard(page, fileName).getByRole('button', { name: /Paginatoewijzing/ }).click();
  const contested = page.getByRole('form', { name: 'Paginatoewijzing vastleggen' });
  await contested.getByLabel(/^Pagina/).fill('3');
  await contested.getByLabel('Toewijzing').selectOption('single');
  await contested.getByLabel('Medewerker op deze pagina').selectOption(fixture.primaryMemberId);
  await contested.getByRole('button', { name: 'Toewijzing vastleggen' }).click();
  await expect(contested.getByText(/kan niet op één naam staan/)).toBeVisible();
  const stillShared = await readSources(page, fixture.weekId);
  expect(stillShared.sources.find(item => item.id === source.id)!.pages.some(item => item.page_number === 3),
    'the refused decision was not recorded').toBe(false);
  await contested.getByLabel('Toewijzing').selectOption('multiple');
  const multipleResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/rpc/hours_set_source_page');
  await contested.getByRole('button', { name: 'Toewijzing vastleggen' }).click();
  expect((await multipleResponse).status(), 'recording it as several employees is allowed').toBe(200);
  await expect(sourceCard(page, fileName).getByText(/Pagina 3 — Meerdere medewerkers/)).toBeVisible();
  const pageThree = sourceCard(page, fileName).locator('div').filter({ hasText: /^Pagina 3 — Meerdere medewerkers$/ });
  await expect(pageThree.getByRole('button', { name: 'Hele pagina overnemen' })).toHaveCount(0);
  record('page with two employees refused on one name and recorded as several', {
    distinctMembers: 2, oneNameRefused: true, recordedAssignment: 'multiple',
  });

  // --- the employee never sees the internal page decisions ----------------
  const portalContext = await browser.newContext();
  const portalPage = await portalContext.newPage();
  observe(portalPage, 'portal');
  await login(portalPage, 'portal');
  const pageProbe = await browserRequest(portalPage, '/rest/v1/hours_source_pages?select=id');
  expect(pageProbe.body, 'the employee sees no page decisions').toEqual([]);
  const intakeProbe = await browserRequest(portalPage, '/rest/v1/rpc/hours_get_week_sources', { p_week_id: fixture.weekId });
  expect(intakeProbe.status, 'the intake projection refuses a portal user').toBe(403);
  record('page decisions stay internal', { pagesVisibleToEmployee: 0, intakeProjectionStatus: intakeProbe.status });

  expect(pageErrors, 'no JavaScript page errors').toEqual([]);
  expect(network.filter(item => item.status >= 500), 'no server errors').toEqual([]);

  const finalWeek = await readWeek(page, fixture.weekId);
  const writtenDays = finalWeek.members.flatMap(member => member.days).filter(day => day.current_revision !== null);
  expect(writtenDays.map(day => day.id).sort(), 'exactly the two intended workdays were claimed by this run')
    .toEqual([fixture.applyDayId, fixture.takeoverDayIds[0]].sort());

  Object.assign(evidence, {
    result: 'pages-flow-passed',
    organizationId: DEMO_ORG, companyName: fixture.companyName, weekId: fixture.weekId,
    runId, workdaysClaimed: writtenDays.length,
    network, pageErrors, messagesSent: 0, paidAiCalls: 0,
    verifiedAt: new Date().toISOString(),
  });
  const directory = process.env.HOURS_PAGES_EVIDENCE_DIR;
  if (directory) {
    mkdirSync(resolve(directory), { recursive: true });
    writeFileSync(resolve(directory, 'result.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  await portalContext.close();
  await internal.close();
});
