import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Connected QA for reading a delivered scan or photo into reviewable proposals
 * (ticket T4) against the verified demo tenant. Run only after the scan
 * migration and the hours-read-scan function are deployed. Load credentials
 * with node --env-file; never copy them into fixtures or evidence.
 *
 * This flow makes REAL PAID AI CALLS, so it is deliberately small: one reading
 * of one synthetic timesheet. Everything else that had to be proven — a refused
 * media type, an exhausted budget, an unusable answer — is covered by fixed
 * provider answers in the unit tests, because proving them here would cost
 * money for nothing.
 *
 * Every business write below goes through the real product forms with a real
 * login. It applies exactly one proposal, so it claims exactly one untouched
 * workday. It has no outgoing message path.
 */
const DEMO_ORG = '6dedabe4-f62c-479e-b5fc-ebfcb824d76f';
const API = 'https://noaupcteygfvlyymqtew.supabase.co';
const AUTH_KEY = 'sb-noaupcteygfvlyymqtew-auth-token';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fixturePath = process.env.HOURS_SCAN_FIXTURE;

type Fixture = {
  runId: string; organizationId: string; companyId: string; companyName: string;
  weekId: string; weekStart: string;
  primaryCandidateId: string; primaryMemberId: string;
  secondaryCandidateId: string; secondaryMemberId: string;
  applyDayId: string; applyWorkDate: string;
  takeoverDayIds: string[]; takeoverWorkDates: string[];
};
type Revision = { id: string; minutes: number; source_references: { kind: string; label: string; reference: string | null }[] };
type Day = { id: string; work_date: string; current_revision: Revision | null };
type Member = { id: string; candidate_id: string; candidate_name: string; days: Day[] };
type Week = { id: string; members: Member[] };
type Proposal = {
  id: string; day_id: string; member_id: string; status: string; minutes: number;
  no_hours_reason: string | null; page_number: number | null; page_label: string | null;
  assignment_uncertain: boolean; uncertain_fields: string[] | null; values_confirmed_at: string | null;
};
type Sources = {
  week_id: string; can_manage: boolean; open_proposals: number; undecided_assignments: number;
  uncertain_values: number;
  sources: { id: string; file_name: string; content_type: string; page_count: number | null; proposals: Proposal[] }[];
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
  const loginResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/auth/v1/token' && response.request().method() === 'POST');
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

/**
 * A synthetic timesheet rendered to a photo. It proves the chain — bytes to
 * storage, storage to the reader, reading to proposals — not the model's
 * handwriting quality; that belongs to the acceptance set of ticket T14.
 */
async function renderTimesheet(page: Page, rows: { name: string; date: string; hours: string; start: string; end: string; pause: string }[],
  marker: string): Promise<Buffer> {
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff;font-family:Georgia,serif">
  <div style="width:900px;padding:40px">
    <h1 style="font-size:30px;margin:0 0 6px">Urenbriefje</h1>
    <p style="font-size:17px;margin:0 0 22px">Synthetische QA-aanlevering ${marker} — geen echte urenverantwoording</p>
    <table style="width:100%;border-collapse:collapse;font-size:22px">
      <tr style="background:#eee">
        <th style="border:2px solid #333;padding:10px;text-align:left">Naam</th>
        <th style="border:2px solid #333;padding:10px;text-align:left">Datum</th>
        <th style="border:2px solid #333;padding:10px;text-align:left">Begin</th>
        <th style="border:2px solid #333;padding:10px;text-align:left">Eind</th>
        <th style="border:2px solid #333;padding:10px;text-align:left">Pauze</th>
        <th style="border:2px solid #333;padding:10px;text-align:left">Totaal</th>
      </tr>
      ${rows.map(row => `<tr>
        <td style="border:2px solid #333;padding:10px">${row.name}</td>
        <td style="border:2px solid #333;padding:10px">${row.date}</td>
        <td style="border:2px solid #333;padding:10px">${row.start}</td>
        <td style="border:2px solid #333;padding:10px">${row.end}</td>
        <td style="border:2px solid #333;padding:10px;font-style:italic">${row.pause}</td>
        <td style="border:2px solid #333;padding:10px">${row.hours}</td>
      </tr>`).join('')}
    </table>
  </div></body>`;
  await page.setContent(html);
  return page.locator('body').screenshot({ type: 'png' });
}

const panel = (page: Page) => page.getByRole('region', { name: 'Klantweek uren', exact: true });
const sourceCard = (page: Page, fileName: string) => panel(page).getByRole('group', { name: `Bron ${fileName}` });
const readingPanel = (page: Page) => page.getByRole('group', { name: 'Uitlezing van deze bron' });

test('connected demo: a delivered scan is read into reviewable proposals', async ({ browser }) => {
  test.skip(process.env.HOURS_SCAN_LIVE_READY !== '1',
    'Requires the deployed scan migration, the deployed reader, and a scoped demo fixture. Makes real paid calls.');
  if (!fixturePath) throw new Error('Set HOURS_SCAN_FIXTURE to the prepared fixture file');
  const fixture = JSON.parse(readFileSync(resolve(fixturePath), 'utf8')) as Fixture;
  expect(fixture.organizationId, 'the fixture must target the verified demo organization').toBe(DEMO_ORG);
  // This flow logs in with real credentials, spends real credits and writes
  // immutable rows. If the base URL is not the local build under review, none of
  // that is a test — it is production traffic reporting a pass.
  const target = new URL(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8093');
  expect(['127.0.0.1', 'localhost'], 'the scan QA only runs against a local build').toContain(target.hostname);

  const internal = await browser.newContext();
  const page = await internal.newPage();
  observe(page, 'internal');
  await login(page, 'internal');

  await page.goto(`/uren/weken/${fixture.weekId}`);
  await expect(page.getByText('Ontvangen bronnen', { exact: true })).toBeVisible();
  const week = await readWeek(page, fixture.weekId);
  const primary = week.members.find(member => member.id === fixture.primaryMemberId)!;
  const secondary = week.members.find(member => member.id === fixture.secondaryMemberId)!;
  // The fixture names a day, but an earlier run may already have claimed it.
  // Picking an untouched one here keeps a rerun honest: this run still claims
  // exactly one workday, and never rewrites a day that is already recorded.
  const applyDay = primary.days.find(day => day.id === fixture.applyDayId && day.current_revision === null)
    ?? primary.days.find(day => day.current_revision === null);
  expect(applyDay, 'the QA week needs an untouched day for this run to claim').toBeDefined();
  const applyDayId = applyDay!.id;
  const applyDate = applyDay!.work_date;
  const secondDay = secondary.days.find(day => day.current_revision === null && day.work_date !== applyDate);
  expect(secondDay, 'the QA week needs an untouched colleague day on another date').toBeDefined();
  const claimedBefore = week.members.flatMap(member => member.days)
    .filter(day => day.current_revision !== null).map(day => day.id).sort();
  const dutch = (iso: string) => iso.split('-').reverse().join('-');
  const runId = process.env.HOURS_SCAN_RUN_ID ?? fixture.runId;
  // A rerun must deliver different bytes, or the week would recognise it as the
  // same file and refuse a second intake.
  const attempt = `poging-${Date.now()}`;
  record('week opens with the intake panel', { weekId: fixture.weekId, members: week.members.length });

  // --- a workbook is never offered the paid route --------------------------
  const bookName = `werkmap-${runId}-${attempt}.xlsx`;
  const { buildWorkbookFile, text } = await import('../src/test/support/xlsx-workbook');
  await panel(page).getByLabel('Urenbriefje uploaden').setInputFiles({
    name: bookName, mimeType: XLSX,
    buffer: Buffer.from(new Uint8Array(buildWorkbookFile([{ name: 'Week', rows: [[text(`QA ${attempt}`)]] }]))),
  });
  await expect(page.getByText(`“${bookName}” is als bron bewaard.`)).toBeVisible();
  await expect(sourceCard(page, bookName).getByRole('button', { name: 'Uitlezen met AI' }),
    'a workbook has its own free reader and is offered no paid one').toHaveCount(0);
  const bookSource = (await readSources(page, fixture.weekId)).sources.find(item => item.file_name === bookName)!;
  const bookProbe = await browserRequest(page, '/rest/v1/rpc/hours_get_source_reading_context',
    { p_source_id: bookSource.id });
  expect(bookProbe.status, 'and the database refuses it too').toBe(400);
  record('a workbook gets no paid reading route', { fileName: bookName, contextStatus: bookProbe.status });

  // --- a photo of a timesheet ---------------------------------------------
  const scanPage = await internal.newPage();
  const photo = await renderTimesheet(scanPage, [
    { name: primary.candidate_name, date: dutch(applyDate), start: '07:00', end: '16:00', pause: '30 min', hours: '8,5' },
    { name: secondary.candidate_name, date: dutch(secondDay!.work_date), start: '08:00', end: '16:15', pause: '30 min', hours: '7:45' },
  ], attempt);
  await scanPage.close();

  const fileName = `urenbriefje-${fixture.weekStart}-${runId}-${attempt}.png`;
  const registerResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/rest/v1/rpc/hours_add_week_source');
  await panel(page).getByLabel('Urenbriefje uploaden')
    .setInputFiles({ name: fileName, mimeType: 'image/png', buffer: photo });
  expect((await registerResponse).status(), 'the photo was registered').toBe(200);
  await expect(page.getByText(`“${fileName}” is als bron bewaard.`)).toBeVisible();
  const stored = await readSources(page, fixture.weekId);
  const source = stored.sources.find(item => item.file_name === fileName)!;
  expect(source.content_type).toBe('image/png');
  expect(source.page_count, 'a photo is one page by definition').toBe(1);
  record('photo stored as a single-page source', { pageCount: source.page_count, bytes: photo.byteLength });

  // --- ONE paid reading ----------------------------------------------------
  const readResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/functions/v1/hours-read-scan');
  await sourceCard(page, fileName).getByRole('button', { name: 'Uitlezen met AI' }).click();
  const readStatus = (await readResponse).status();
  expect(readStatus, 'the reader answered').toBe(200);
  const reading = readingPanel(page);
  await expect(reading).toBeVisible();
  await expect(reading.getByText(/Deze uitlezing kostte €/), 'what it cost is never invisible').toBeVisible();
  const priceText = await reading.getByText(/Deze uitlezing kostte €/).innerText();
  await expect(reading.getByText('8:30 uur')).toBeVisible();
  await expect(reading.getByText('7:45 uur')).toBeVisible();
  expect((await readSources(page, fixture.weekId)).sources.find(item => item.id === source.id)!.proposals,
    'reading a file writes nothing at all').toEqual([]);
  record('one paid reading returned the delivered rows and wrote nothing', {
    httpStatus: readStatus, priceLine: priceText, proposalsBeforeSaving: 0,
  });

  // --- saving the reading makes proposals, never hours ---------------------
  const saveButton = reading.getByRole('button', { name: /voorstel(len)? bewaren$/ });
  const saveResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/rest/v1/rpc/hours_create_source_proposals');
  await saveButton.click();
  expect((await saveResponse).status(), 'the whole reading was recorded in one handling').toBe(200);
  const afterSaving = await readSources(page, fixture.weekId);
  const saved = afterSaving.sources.find(item => item.id === source.id)!.proposals;
  expect(saved.length, 'both delivered rows became proposals').toBe(2);
  expect(saved.every(item => item.status === 'open'), 'a reading is still only proposals').toBe(true);
  expect(saved.every(item => item.page_number === 1), 'every proposal names the page it came from').toBe(true);
  const beforeApplying = await readWeek(page, fixture.weekId);
  expect(beforeApplying.members.flatMap(member => member.days).filter(day => day.current_revision !== null)
    .map(day => day.id).sort(), 'recording a reading wrote no day version').toEqual(claimedBefore);
  record('a whole reading recorded as proposals in one handling', {
    proposals: saved.length, revisionsWritten: 0,
    uncertainValues: afterSaving.uncertain_values, undecidedAssignments: afterSaving.undecided_assignments,
  });

  // --- applying takes the proposal literally, with the page as origin ------
  const applyProposal = saved.find(item => item.day_id === applyDayId)!;
  expect(applyProposal.minutes, 'the reader read 8,5 as 510 minutes').toBe(510);
  const proposalRow = sourceCard(page, fileName)
    .getByRole('group', { name: new RegExp(`Voorstel .* ${applyDate}`) });
  // Both doubts have to be settled before applying — who this is about, and
  // what the reading made of the paper. Each is its own act, so each is done
  // separately here, exactly as a reviewer would.
  const settled: string[] = [];
  for (const [label, rpc] of [
    ['Toewijzing bevestigen', 'hours_confirm_proposal_assignment'],
    ['Gelezen gegevens bevestigen', 'hours_confirm_proposal_values'],
  ] as const) {
    const button = proposalRow.getByRole('button', { name: label });
    if (await button.count() === 0) continue;
    await button.click();
    const confirmResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === `/rest/v1/rpc/${rpc}`);
    await proposalRow.getByRole('button', { name: label }).click();
    expect((await confirmResponse).status(), `settling ${label} succeeded`).toBe(200);
    settled.push(label);
  }
  const hadDoubt = settled.length > 0;
  const applyResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/rest/v1/rpc/hours_apply_source_proposal');
  await proposalRow.getByRole('button', { name: 'Toepassen als dagversie' }).click();
  expect((await applyResponse).status(), 'applying succeeded').toBe(200);
  await expect(proposalRow.getByText(/Toegepast als nieuwe dagversie/)).toBeVisible();

  const applied = await readWeek(page, fixture.weekId);
  const writtenDays = applied.members.flatMap(member => member.days).filter(day => day.current_revision !== null);
  expect(writtenDays.map(day => day.id).sort(), 'exactly one workday was added to what was already claimed')
    .toEqual([...claimedBefore, applyDayId].sort());
  const revision = writtenDays.find(day => day.id === applyDayId)!.current_revision!;
  expect(revision.minutes, 'the day version is literally what the proposal said').toBe(510);
  expect(revision.source_references[0].kind).toBe('upload');
  expect(revision.source_references[0].label).toBe(fileName);
  record('applying wrote exactly one day version from the scan', {
    workdaysClaimedByThisRun: 1, workdaysClaimedBefore: claimedBefore.length,
    minutes: revision.minutes, origin: revision.source_references, doubtSettledFirst: hadDoubt,
  });

  // --- the employee never reaches the reader ------------------------------
  const portalContext = await browser.newContext();
  const portalPage = await portalContext.newPage();
  observe(portalPage, 'portal');
  await login(portalPage, 'portal');
  const contextProbe = await browserRequest(portalPage, '/rest/v1/rpc/hours_get_source_reading_context',
    { p_source_id: source.id });
  expect(contextProbe.status, 'the reading context refuses a portal user').toBe(403);
  const readerProbe = await portalPage.evaluate(async ({ api, key, publicKey, sourceId }) => {
    const session = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    const response = await fetch(`${api}/functions/v1/hours-read-scan`, {
      method: 'POST',
      headers: { apikey: publicKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: sourceId }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { api: API, key: AUTH_KEY, publicKey: required('VITE_SUPABASE_PUBLISHABLE_KEY'), sourceId: source.id });
  expect(readerProbe.status, 'and a portal user may not spend a cent of the budget').toBe(403);
  record('the reader stays internal', {
    contextStatus: contextProbe.status, readerStatus: readerProbe.status,
  });

  expect(pageErrors, 'no JavaScript page errors').toEqual([]);
  expect(network.filter(item => item.status >= 500), 'no server errors').toEqual([]);
  // The employee portal still has its own legacy hours page and reads that
  // table when it loads; what this flow may never do is write to it, and the
  // internal side may not reach it at all.
  expect(network.filter(item => item.path.includes('timesheets')
    && (item.method !== 'GET' || item.path.startsWith('internal:'))),
    'nothing wrote to the legacy hours route').toEqual([]);
  const paidCalls = network.filter(item => item.path.endsWith('/functions/v1/hours-read-scan')
    && item.path.startsWith('internal:'));
  expect(paidCalls.length, 'this run asked for exactly one reading').toBe(1);
  // The reading log is what the office can answer "which document went out" from.
  const log = await browserRequest(page,
    `/rest/v1/hours_source_readings?source_id=eq.${source.id}&select=status,cost_cents,line_count`);
  expect(log.status).toBe(200);
  expect((log.body as unknown[]).length, 'the paid reading left a record').toBe(1);
  record('the paid reading is recorded with what it cost', { log: log.body });

  const finalWeek = await readWeek(page, fixture.weekId);
  expect(finalWeek.members.flatMap(member => member.days).filter(day => day.current_revision !== null)
    .map(day => day.id).sort(), 'this run claimed exactly one extra workday and no more')
    .toEqual([...claimedBefore, applyDayId].sort());

  Object.assign(evidence, {
    result: 'scan-flow-passed',
    organizationId: DEMO_ORG, companyName: fixture.companyName, weekId: fixture.weekId,
    runId, attempt, workdaysClaimed: 1,
    network, pageErrors, messagesSent: 0, paidAiCallsRequested: paidCalls.length,
    verifiedAt: new Date().toISOString(),
  });
  const directory = process.env.HOURS_SCAN_EVIDENCE_DIR;
  if (directory) {
    mkdirSync(resolve(directory), { recursive: true });
    writeFileSync(resolve(directory, 'hours-scan-demo-qa.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  }
});
