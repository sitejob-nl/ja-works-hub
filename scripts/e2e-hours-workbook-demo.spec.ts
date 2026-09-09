import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildWorkbookFile, text, formula } from '../src/test/support/xlsx-workbook';

/**
 * Connected QA for reading proposals out of a delivered workbook (ticket T3)
 * against the verified demo tenant. Run only after the spreadsheet migration is
 * deployed. Load credentials with node --env-file; never copy them into
 * fixtures or evidence. Every business write below goes through the real
 * product forms with a real login. The reader is deterministic, so this flow
 * makes no paid call, and it has no outgoing message path. It applies exactly
 * one proposal, so it claims exactly one untouched workday.
 */
const DEMO_ORG = '6dedabe4-f62c-479e-b5fc-ebfcb824d76f';
const API = 'https://noaupcteygfvlyymqtew.supabase.co';
const AUTH_KEY = 'sb-noaupcteygfvlyymqtew-auth-token';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fixturePath = process.env.HOURS_WORKBOOK_FIXTURE;

type Fixture = {
  runId: string; organizationId: string; companyId: string; companyName: string;
  weekId: string; weekStart: string;
  primaryCandidateId: string; primaryMemberId: string;
  secondaryCandidateId: string; secondaryMemberId: string;
  applyDayId: string; applyWorkDate: string;
  takeoverDayIds: string[]; takeoverWorkDates: string[];
  existingSourceCount: number;
};
type Revision = { id: string; minutes: number; source_references: { kind: string; label: string; reference: string | null }[] };
type Day = { id: string; work_date: string; current_revision: Revision | null };
type Member = { id: string; candidate_id: string; candidate_name: string; days: Day[] };
type Week = { id: string; members: Member[] };
type Proposal = {
  id: string; day_id: string; member_id: string; status: string; minutes: number;
  no_hours_reason: string | null; source_input: { categories?: { sourceCode: string; minutes: number }[] } | null;
  page_number: number | null; page_label: string | null; assignment_uncertain: boolean;
};
type Sources = {
  week_id: string; can_manage: boolean; open_proposals: number; undecided_assignments: number;
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

const panel = (page: Page) => page.getByRole('region', { name: 'Klantweek uren', exact: true });
/** Scope every action to this run's own source, never an earlier run's. */
const sourceCard = (page: Page, fileName: string) => panel(page).getByRole('group', { name: `Bron ${fileName}` });
const readingPanel = (page: Page) => page.getByRole('group', { name: 'Uitlezing van deze bron' });
const bytesOf = (buffer: ArrayBuffer) => Buffer.from(new Uint8Array(buffer));

test('connected demo: a delivered workbook is read into reviewable proposals', async ({ browser }) => {
  test.skip(process.env.HOURS_WORKBOOK_LIVE_READY !== '1',
    'Requires an explicitly deployed spreadsheet migration and a scoped demo fixture.');
  if (!fixturePath) throw new Error('Set HOURS_WORKBOOK_FIXTURE to the prepared fixture file');
  const fixture = JSON.parse(readFileSync(resolve(fixturePath), 'utf8')) as Fixture;
  expect(fixture.organizationId, 'the fixture must target the verified demo organization').toBe(DEMO_ORG);

  const internal = await browser.newContext();
  const page = await internal.newPage();
  observe(page, 'internal');
  await login(page, 'internal');

  await page.goto(`/uren/weken/${fixture.weekId}`);
  await expect(page.getByText('Ontvangen bronnen', { exact: true })).toBeVisible();
  const week = await readWeek(page, fixture.weekId);
  const primary = week.members.find(member => member.id === fixture.primaryMemberId)!;
  const secondary = week.members.find(member => member.id === fixture.secondaryMemberId)!;
  const applyDate = primary.days.find(day => day.id === fixture.applyDayId)!.work_date;
  // The grid needs two different dates, and the colleague's day has to be an
  // untouched one on the other date.
  const secondDay = secondary.days.find(day => day.current_revision === null && day.work_date !== applyDate);
  expect(secondDay, 'the QA week needs an untouched colleague day on another date').toBeDefined();
  const secondDate = secondDay!.work_date;
  // Earlier runs may already have claimed days in this week; this run adds one.
  const claimedBefore = week.members.flatMap(member => member.days)
    .filter(day => day.current_revision !== null).map(day => day.id).sort();
  const dutch = (iso: string) => iso.split('-').reverse().join('-');
  const runId = process.env.HOURS_WORKBOOK_RUN_ID ?? fixture.runId;
  // A rerun must deliver different bytes, or the week would recognise it as the
  // same file and refuse a second intake.
  const attempt = `poging-${Date.now()}`;
  record('week opens with the intake panel', { weekId: fixture.weekId, members: week.members.length });

  // --- a file that only claims to be a workbook never reaches storage ------
  const csvName = `nep-werkmap-${runId}-${attempt}.xls`;
  await panel(page).getByLabel('Urenbriefje uploaden')
    .setInputFiles({ name: csvName, mimeType: 'application/vnd.ms-excel',
      buffer: Buffer.from(`naam;datum;uren\nSynthetisch;07-09-2026;8\n# ${attempt}\n`, 'utf8') });
  await expect(panel(page).getByText(/geen Excel-werkmap/i)).toBeVisible();
  const afterRefusal = await readSources(page, fixture.weekId);
  expect(afterRefusal.sources.some(item => item.file_name === csvName),
    'a file that is not a workbook is refused before it is stored').toBe(false);
  record('a mislabelled csv is refused before storage', { fileName: csvName, stored: false });

  // --- a real workbook records its worksheets as its pages ------------------
  // A cross-table of the real week members. The total column carries a formula
  // whose stored result deliberately disagrees, so the reader is shown to read
  // what was saved rather than to calculate.
  const fileName = `urenoverzicht-${fixture.weekStart}-${runId}-${attempt}.xlsx`;
  const workbook = bytesOf(buildWorkbookFile([
    { name: 'Week', rows: [
      [text('Medewerker'), text(dutch(applyDate)), text(dutch(secondDate)), text('Totaal')],
      [text(primary.candidate_name), text('8:30'), text(''), formula('SUM(B2:C2)', '0.354166666666667')],
      [text(secondary.candidate_name), text(''), text('7,25'), text('7:15')],
    ] },
    { name: 'Toelichting', rows: [[text(`Synthetische QA-bron ${attempt}, geen echte urenverantwoording.`)]] },
  ]));
  const registerResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/rest/v1/rpc/hours_add_week_source');
  await panel(page).getByLabel('Urenbriefje uploaden')
    .setInputFiles({ name: fileName, mimeType: XLSX, buffer: workbook });
  expect((await registerResponse).status(), 'the workbook was registered').toBe(200);
  await expect(page.getByText(`“${fileName}” is als bron bewaard.`)).toBeVisible();
  const stored = await readSources(page, fixture.weekId);
  const source = stored.sources.find(item => item.file_name === fileName)!;
  expect(source.content_type, 'stored as a modern workbook').toBe(XLSX);
  expect(source.page_count, 'a worksheet is this format’s page').toBe(2);
  record('workbook stored with its worksheet count', { pageCount: source.page_count, contentType: source.content_type });

  // --- reading it shows what the file says, and nothing more ---------------
  const signedUrl = page.waitForResponse(response => new URL(response.url()).pathname.includes('/object/sign/'));
  await sourceCard(page, fileName).getByRole('button', { name: 'Uitlezen' }).click();
  expect((await signedUrl).status(), 'the stored original is fetched over a signed link').toBe(200);
  const reading = readingPanel(page);
  await expect(reading).toBeVisible();
  await expect(reading.getByText('8:30 uur')).toBeVisible();
  await expect(reading.getByText('7:15 uur')).toBeVisible();
  await expect(reading.getByText(/Dit werkblad is niet gelezen/)).toBeVisible();
  await expect(reading.getByText('Toelichting')).toBeVisible();
  expect((await readSources(page, fixture.weekId)).sources.find(item => item.id === source.id)!.proposals,
    'reading a file writes nothing at all').toEqual([]);
  record('reading shows the delivered rows and names the worksheet it skipped', {
    rowsRead: 2, worksheetsIgnored: 1, proposalsBeforeSaving: 0,
  });

  // --- the delivered total reconciles, which is the whole point ------------
  // 0,354166… is 8:30 stored as an elapsed-time serial: a reader that took it
  // for a decimal would make it 0:21 and report a difference the file does not
  // have. The formula next to it says SUM, which a calculating reader would
  // have resolved differently again. Neither happens.
  await expect(reading.getByText(/Een aangeleverd totaal klopt niet/)).toHaveCount(0);
  record('an elapsed-time total resolved against the days of its own row', {
    storedSerial: '0.354166666666667', readAs: '8:30', mismatchesReported: 0,
  });

  // --- saving the reading makes proposals, never hours ---------------------
  const saveResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/rest/v1/rpc/hours_create_source_proposals');
  await reading.getByRole('button', { name: '2 voorstellen bewaren' }).click();
  expect((await saveResponse).status(), 'the whole reading was recorded in one handling').toBe(200);
  const saved = (await readSources(page, fixture.weekId)).sources.find(item => item.id === source.id)!.proposals;
  expect(saved).toHaveLength(2);
  expect(saved.every(item => item.status === 'open'), 'a reading is still only proposals').toBe(true);
  expect(new Set(saved.map(item => item.member_id)), 'one proposal per employee and day')
    .toEqual(new Set([fixture.primaryMemberId, fixture.secondaryMemberId]));
  expect(saved.map(item => item.day_id).sort(), 'each proposal lands on the delivered date')
    .toEqual([fixture.applyDayId, secondDay!.id].sort());
  expect(saved.every(item => item.page_number === 1), 'every proposal names the worksheet it came from').toBe(true);
  expect(saved.every(item => (item.page_label ?? '').startsWith('blad Week · rij')), 'and the row inside it').toBe(true);
  const beforeApplying = await readWeek(page, fixture.weekId);
  expect(beforeApplying.members.flatMap(member => member.days).filter(day => day.current_revision !== null)
    .map(day => day.id).sort(), 'recording a reading wrote no day version').toEqual(claimedBefore);
  record('a whole reading recorded as proposals in one handling', {
    proposals: saved.length, revisionsWritten: 0, pageNumbers: [...new Set(saved.map(item => item.page_number))],
  });

  // --- applying takes the proposal literally, with the worksheet as origin -
  const applyProposal = saved.find(item => item.day_id === fixture.applyDayId)!;
  expect(applyProposal.minutes, 'the reader read 8:30 as 510 minutes').toBe(510);
  const proposalRow = sourceCard(page, fileName)
    .getByRole('group', { name: new RegExp(`Voorstel .* ${applyDate}`) });
  const applyResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/rest/v1/rpc/hours_apply_source_proposal');
  await proposalRow.getByRole('button', { name: 'Toepassen als dagversie' }).click();
  expect((await applyResponse).status(), 'applying succeeded').toBe(200);
  await expect(proposalRow.getByText(/Toegepast als nieuwe dagversie/)).toBeVisible();

  const applied = await readWeek(page, fixture.weekId);
  const writtenDays = applied.members.flatMap(member => member.days).filter(day => day.current_revision !== null);
  expect(writtenDays.map(day => day.id).sort(), 'exactly one workday was added to what was already claimed')
    .toEqual([...claimedBefore, fixture.applyDayId].sort());
  const revision = writtenDays.find(day => day.id === fixture.applyDayId)!.current_revision!;
  expect(revision.minutes, 'the day version is literally what the proposal said').toBe(510);
  expect(revision.source_references, 'the worksheet and row are the origin of these hours').toEqual([
    { kind: 'upload', label: fileName, reference: `pagina 1 · ${saved.find(item => item.day_id === fixture.applyDayId)!.page_label}` },
  ]);
  record('applying wrote exactly one day version from the workbook', {
    workdaysClaimedByThisRun: 1, workdaysClaimedBefore: claimedBefore.length,
    minutes: revision.minutes, origin: revision.source_references,
  });

  // --- a workbook the reader cannot lay out blocks, and records nothing ----
  const oddName = `onbekende-indeling-${runId}-${attempt}.xlsx`;
  const odd = bytesOf(buildWorkbookFile([{ name: 'Blad1', rows: [
    [text(`Overzicht ${attempt}`)], [text(primary.candidate_name), text('maandag'), text('lang gewerkt')],
  ] }]));
  await panel(page).getByLabel('Urenbriefje uploaden')
    .setInputFiles({ name: oddName, mimeType: XLSX, buffer: odd });
  await expect(page.getByText(`“${oddName}” is als bron bewaard.`)).toBeVisible();
  await sourceCard(page, oddName).getByRole('button', { name: 'Uitlezen' }).click();
  await expect(page.getByText('Deze bron is niet uitgelezen.')).toBeVisible();
  await expect(page.getByText(/Geen enkel werkblad heeft een herkenbare indeling/)).toBeVisible();
  const afterBlock = await readSources(page, fixture.weekId);
  expect(afterBlock.sources.find(item => item.file_name === oddName)!.proposals,
    'an unrecognised layout produces no half set of proposals').toEqual([]);
  record('an unrecognised layout blocks without producing proposals', { fileName: oddName, proposals: 0 });

  // --- the employee never sees the intake ---------------------------------
  const portalContext = await browser.newContext();
  const portalPage = await portalContext.newPage();
  observe(portalPage, 'portal');
  await login(portalPage, 'portal');
  const intakeProbe = await browserRequest(portalPage, '/rest/v1/rpc/hours_get_week_sources', { p_week_id: fixture.weekId });
  expect(intakeProbe.status, 'the intake projection refuses a portal user').toBe(403);
  const readingProbe = await browserRequest(portalPage, '/rest/v1/rpc/hours_create_source_proposals',
    { p_source_id: source.id, p_entries: [{ day_id: fixture.applyDayId, minutes: 60, page_number: 1 }] });
  expect(readingProbe.status, 'a portal user may not record a reading').toBe(403);
  record('the intake and the reader stay internal', {
    intakeProjectionStatus: intakeProbe.status, readingStatus: readingProbe.status,
  });

  expect(pageErrors, 'no JavaScript page errors').toEqual([]);
  expect(network.filter(item => item.status >= 500), 'no server errors').toEqual([]);
  expect(network.some(item => item.path.includes('timesheets')), 'nothing touched the legacy hours route').toBe(false);

  const finalWeek = await readWeek(page, fixture.weekId);
  expect(finalWeek.members.flatMap(member => member.days).filter(day => day.current_revision !== null)
    .map(day => day.id).sort(), 'this run claimed exactly one extra workday and no more')
    .toEqual([...claimedBefore, fixture.applyDayId].sort());

  Object.assign(evidence, {
    result: 'workbook-flow-passed',
    organizationId: DEMO_ORG, companyName: fixture.companyName, weekId: fixture.weekId,
    runId, attempt, workdaysClaimed: 1,
    network, pageErrors, messagesSent: 0, paidAiCalls: 0,
    verifiedAt: new Date().toISOString(),
  });
  const directory = process.env.HOURS_WORKBOOK_EVIDENCE_DIR;
  if (directory) {
    mkdirSync(resolve(directory), { recursive: true });
    writeFileSync(resolve(directory, 'result.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  await portalContext.close();
  await internal.close();
});
