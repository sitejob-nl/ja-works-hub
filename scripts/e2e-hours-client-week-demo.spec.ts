import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Connected QA for the personal client week page without a login (ticket T6),
 * against the verified demo tenant. Load credentials with node --env-file;
 * never copy them into fixtures or evidence.
 *
 * Every business write below goes through the real product forms. The client
 * side runs in its own browser context with no session at all, which is the
 * point: this page must work for someone who has never logged in, and must
 * refuse everything else. It applies exactly one proposal, so it claims exactly
 * one untouched workday. No outgoing message path, no paid AI call.
 */
const DEMO_ORG = '6dedabe4-f62c-479e-b5fc-ebfcb824d76f';
const API = 'https://noaupcteygfvlyymqtew.supabase.co';
const AUTH_KEY = 'sb-noaupcteygfvlyymqtew-auth-token';
const fixturePath = process.env.HOURS_CLIENT_FIXTURE;

type Fixture = {
  runId: string; organizationId: string; companyId: string; companyName: string;
  weekId: string; weekStart: string;
  primaryMemberId: string; secondaryMemberId: string;
  applyDayId: string; applyWorkDate: string;
  takeoverDayIds: string[]; takeoverWorkDates: string[];
};
type Revision = { id: string; minutes: number; source_references: { kind: string; label: string; reference: string | null }[] };
type Day = { id: string; work_date: string; current_revision: Revision | null };
type Member = { id: string; candidate_name: string; days: Day[] };
type Week = { id: string; members: Member[] };
type Proposal = { id: string; day_id: string; status: string; minutes: number; no_hours_reason: string | null; note: string | null };
type ClientLink = {
  id: string; label: string; expires_at: string; revoked_at: string | null;
  expected_days: number; provided_days: number; outstanding_days: number; complete: boolean;
  report: { kind: string; note: string | null } | null;
  proposals: Proposal[];
};
type Sources = { week_id: string; client_links: ClientLink[]; sources: unknown[] };

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

async function login(page: Page) {
  await page.goto('/login');
  expect(await page.evaluate(key => sessionStorage.getItem(key), AUTH_KEY),
    'fresh login has no inherited session').toBeNull();
  await page.locator('#email').fill(required('DEMO_ORG_EMAIL'));
  await page.locator('#password').fill(required('DEMO_ORG_PASSWORD'));
  const response = page.waitForResponse(candidate =>
    new URL(candidate.url()).pathname === '/auth/v1/token' && candidate.request().method() === 'POST');
  await page.locator('form').getByRole('button', { name: /Inloggen|Log in/i }).click();
  expect((await response).status(), 'internal form authentication').toBe(200);
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
}

function observe(page: Page, zone: string) {
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== API) return;
    // Paths and statuses only: no query strings, headers, bodies or secrets.
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
const linkCard = (page: Page, label: string) => panel(page).getByRole('group', { name: `Klantlink ${label}` });

/** A visitor with no session at all, which is exactly who this page is for. */
async function openAsClient(browser: Browser, address: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  observe(page, 'client');
  await page.goto(address);
  const session = await page.evaluate(key => sessionStorage.getItem(key), AUTH_KEY);
  expect(session, 'the public page runs without any session').toBeNull();
  return { context, page };
}

const dutchDay = (iso: string) => new Intl.DateTimeFormat('nl-NL',
  { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));

test('connected demo: a client delivers its week through a personal link', async ({ browser, baseURL }) => {
  test.skip(process.env.HOURS_CLIENT_LIVE_READY !== '1',
    'Requires the deployed client-link migration, the deployed edge function and a scoped demo fixture.');
  if (!fixturePath) throw new Error('Set HOURS_CLIENT_FIXTURE to the prepared fixture file');
  const fixture = JSON.parse(readFileSync(resolve(fixturePath), 'utf8')) as Fixture;
  expect(fixture.organizationId, 'the fixture must target the verified demo organization').toBe(DEMO_ORG);
  const runId = process.env.HOURS_CLIENT_RUN_ID ?? fixture.runId;
  const attempt = `poging-${Date.now()}`;

  const internal = await browser.newContext();
  const page = await internal.newPage();
  observe(page, 'internal');
  await login(page);

  await page.goto(`/uren/weken/${fixture.weekId}`);
  await expect(page.getByText('Persoonlijke klantlinks', { exact: true })).toBeVisible();
  const week = await readWeek(page, fixture.weekId);
  const claimedBefore = week.members.flatMap(member => member.days)
    .filter(day => day.current_revision !== null).map(day => day.id).sort();
  const expectedDays = week.members.reduce((total, member) => total + member.days.length, 0);
  const secondary = week.members.find(member => member.id === fixture.secondaryMemberId)!;
  const partnerDay = secondary.days.find(day => day.current_revision === null
    && !fixture.takeoverDayIds.includes(day.id) && day.id !== fixture.applyDayId)!;
  expect(partnerDay, 'the QA week needs a second untouched day for the colleague').toBeDefined();
  record('week opens with the client link panel', { weekId: fixture.weekId, expectedDays });

  // --- handing out a link: the address is shown once ----------------------
  const label = `Planning ${attempt}`;
  await panel(page).getByRole('button', { name: 'Klantlink maken' }).click();
  await panel(page).getByLabel('Voor wie is deze link?').fill(label);
  await panel(page).getByRole('button', { name: 'Link aanmaken' }).click();
  const addressBox = panel(page).locator('code').first();
  await expect(addressBox).toBeVisible();
  const address = (await addressBox.innerText()).trim();
  expect(address, 'the address points at the public page').toContain('/urenweek/');
  const secret = address.split('/urenweek/')[1];
  expect(secret, 'the secret is a 64-character digest-sized token').toHaveLength(64);
  await expect(panel(page).getByText(/niet opnieuw te zien/i)).toBeVisible();

  const afterIssue = await readSources(page, fixture.weekId);
  const issued = afterIssue.client_links.find(link => link.label === label)!;
  expect(issued, 'the link is visible to the office').toBeDefined();
  expect(JSON.stringify(afterIssue), 'no projection ever carries the secret or its digest')
    .not.toContain(secret);
  expect(issued.expected_days).toBe(expectedDays);
  expect(issued.provided_days).toBe(0);
  record('a personal link is issued and its secret is never stored', {
    label, expectedDays: issued.expected_days, secretInProjection: false,
  });

  // --- the client opens the page without any login ------------------------
  const client = await openAsClient(browser, `${baseURL}/urenweek/${secret}`);
  await expect(client.page.getByRole('heading', { name: fixture.companyName })).toBeVisible();
  await expect(client.page.getByText(`0 van ${expectedDays} dagen aangeleverd`)).toBeVisible();
  const applyLabel = `Gewerkte uren ${dutchDay(fixture.applyWorkDate)}`;
  const partnerLabel = `Gewerkte uren ${dutchDay(partnerDay.work_date)}`;
  await expect(client.page.getByLabel(applyLabel).first()).toBeVisible();
  record('the client page opens without a session', { companyName: fixture.companyName });

  // --- 8,5 and 8:30 are the same duration; a blank day stays unknown -------
  await client.page.getByLabel(applyLabel).first().fill('8,5');
  await client.page.getByLabel(partnerLabel).last().fill('8:30');
  await client.page.getByRole('button', { name: 'Uren opslaan' }).click();
  await expect(client.page.getByText(/doorgegeven aan uw contactpersoon/i)).toBeVisible();

  const afterSave = await readSources(page, fixture.weekId);
  const delivered = afterSave.client_links.find(link => link.id === issued.id)!;
  const deliveredMinutes = delivered.proposals.filter(proposal => proposal.status === 'open')
    .map(proposal => proposal.minutes).sort((a, b) => a - b);
  expect(deliveredMinutes, 'both notations landed as the same duration').toEqual([510, 510]);
  expect(delivered.provided_days).toBe(2);
  expect(delivered.outstanding_days).toBe(expectedDays - 2);
  expect(delivered.complete, 'a partial delivery is not complete').toBe(false);
  const afterSaveWeek = await readWeek(page, fixture.weekId);
  expect(afterSaveWeek.members.flatMap(member => member.days).filter(day => day.current_revision !== null)
    .map(day => day.id).sort(), 'filling in the page writes no hours at all').toEqual(claimedBefore);
  record('client input lands as proposals and writes no hours', {
    minutes: deliveredMinutes, providedDays: delivered.provided_days,
    outstandingDays: delivered.outstanding_days, revisionsWritten: 0,
  });

  // --- a later delivery replaces the client's own earlier one -------------
  await client.page.getByLabel(applyLabel).first().fill('9:00');
  await client.page.getByRole('button', { name: 'Uren opslaan' }).click();
  await expect(client.page.getByText(/doorgegeven aan uw contactpersoon/i)).toBeVisible();
  const afterCorrection = await readSources(page, fixture.weekId);
  const corrected = afterCorrection.client_links.find(link => link.id === issued.id)!;
  const forApplyDay = corrected.proposals.filter(proposal => proposal.day_id === fixture.applyDayId);
  expect(forApplyDay.filter(proposal => proposal.status === 'open').map(proposal => proposal.minutes),
    'exactly one standing delivery per day').toEqual([540]);
  expect(forApplyDay.filter(proposal => proposal.status === 'discarded').map(proposal => proposal.minutes),
    'the earlier delivery is withdrawn, not rewritten').toEqual([510]);
  expect(corrected.provided_days, 'a correction does not count as an extra day').toBe(2);
  record('a correction replaces only the same link and day', {
    standing: 540, withdrawn: 510, providedDays: corrected.provided_days,
  });

  // --- announcing a later delivery does not make the week complete --------
  await client.page.getByRole('button', { name: 'Ik lever later aan' }).click();
  await client.page.getByLabel('Toelichting (optioneel)').fill(`Rest volgt (${attempt})`);
  await client.page.getByRole('button', { name: 'Melding versturen' }).click();
  await expect(client.page.getByText(/U heeft gemeld dat u later aanlevert/i)).toBeVisible();
  const afterReport = await readSources(page, fixture.weekId);
  const reported = afterReport.client_links.find(link => link.id === issued.id)!;
  expect(reported.report?.kind).toBe('later');
  expect(reported.complete, 'announcing is not delivering').toBe(false);
  expect(reported.outstanding_days).toBeGreaterThan(0);
  record('a partial delivery stays visible as incomplete', {
    report: reported.report?.kind, outstandingDays: reported.outstanding_days, complete: false,
  });

  // --- a token of one client never opens another --------------------------
  const strangerProbe = await client.page.evaluate(async ({ api, secret, otherDay }) => {
    const response = await fetch(`${api}/functions/v1/hours-client-week`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: secret, action: 'save', entries: [{ day_id: otherDay, hours: '8' }] }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { api: API, secret, otherDay: '00000000-0000-4000-8000-000000000000' });
  expect(strangerProbe.body?.error ?? strangerProbe.body?.status,
    'a day outside this link is refused').toBeTruthy();
  expect(strangerProbe.body?.week, 'a refused save returns no week').toBeUndefined();

  const guessProbe = await client.page.evaluate(async api => {
    const response = await fetch(`${api}/functions/v1/hours-client-week`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'f'.repeat(64), action: 'get' }),
    });
    return await response.json().catch(() => null);
  }, API);
  expect(guessProbe?.status, 'a guessed token opens nothing').toBe('invalid');
  expect(guessProbe?.week).toBeUndefined();
  record('scope holds: another week and a guessed token open nothing', {
    strangerRefused: true, guessedTokenStatus: guessProbe?.status,
  });

  // --- the office reviews and applies, which is the only write of hours ----
  const standing = forApplyDay.find(proposal => proposal.status === 'open')!;
  await page.reload();
  const card = linkCard(page, label);
  await expect(card).toBeVisible();
  await expect(card.getByText(/2 van .* dagen aangeleverd/)).toBeVisible();
  const proposalRow = card.getByRole('group', { name: new RegExp(`Voorstel .* ${fixture.applyWorkDate}`) });
  await proposalRow.getByRole('button', { name: 'Toepassen als dagversie' }).click();
  await expect(card.getByText(/Toegepast als nieuwe dagversie/)).toBeVisible();

  const applied = await readWeek(page, fixture.weekId);
  const appliedDay = applied.members.flatMap(member => member.days)
    .find(day => day.id === fixture.applyDayId)!;
  expect(appliedDay.current_revision?.minutes, 'the proposal is applied literally').toBe(540);
  const origin = appliedDay.current_revision!.source_references[0];
  expect(origin.kind, 'the origin says the client delivered this').toBe('client');
  expect(origin.label, 'the employee sees the client, never the internal link label')
    .toBe(fixture.companyName);
  expect(JSON.stringify(appliedDay.current_revision!.source_references)).not.toContain(label);
  record('only an internal user applies, and the origin names the client', {
    minutes: 540, originKind: origin.kind, originLabel: origin.label,
  });

  // --- withdrawing closes the link but keeps what it delivered ------------
  await card.getByRole('button', { name: 'Intrekken' }).click();
  await card.getByLabel('Waarom trekt u deze link in?').fill(`QA-afsluiting ${attempt}`);
  await card.getByRole('button', { name: 'Definitief intrekken' }).click();
  await expect(card.getByText('Ingetrokken')).toBeVisible();

  const afterRevoke = await readSources(page, fixture.weekId);
  const revoked = afterRevoke.client_links.find(link => link.id === issued.id)!;
  expect(revoked.revoked_at, 'the link is withdrawn').toBeTruthy();
  expect(revoked.proposals.length, 'withdrawing removes nothing the client delivered')
    .toBe(corrected.proposals.length);

  const closedProbe = await client.page.evaluate(async ({ api, secret }) => {
    const response = await fetch(`${api}/functions/v1/hours-client-week`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: secret, action: 'get' }),
    });
    return await response.json().catch(() => null);
  }, { api: API, secret });
  expect(closedProbe?.status, 'a withdrawn link opens nothing').toBe('revoked');
  expect(closedProbe?.week).toBeUndefined();
  record('a withdrawn link closes without erasing the delivery', {
    status: closedProbe?.status, proposalsKept: revoked.proposals.length,
  });

  // --- the public endpoint stays the only way in --------------------------
  const anonProbe = await client.page.evaluate(async api => {
    const response = await fetch(`${api}/rest/v1/rpc/hours_client_week_view`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token_hash: 'a'.repeat(64) }),
    });
    return response.status;
  }, API);
  expect(anonProbe, 'the public RPC is unreachable without the service key').toBeGreaterThanOrEqual(400);
  record('the database function is reachable only through the trusted function', { anonStatus: anonProbe });

  expect(pageErrors, 'no JavaScript page errors').toEqual([]);
  expect(network.filter(item => item.status >= 500), 'no server errors').toEqual([]);
  expect(network.some(item => item.path.includes('timesheets')), 'nothing touched the legacy hours route').toBe(false);

  const finalWeek = await readWeek(page, fixture.weekId);
  expect(finalWeek.members.flatMap(member => member.days).filter(day => day.current_revision !== null)
    .map(day => day.id).sort(), 'this run claimed exactly one extra workday and no more')
    .toEqual([...claimedBefore, fixture.applyDayId].sort());

  Object.assign(evidence, {
    result: 'client-week-flow-passed',
    organizationId: DEMO_ORG, companyName: fixture.companyName, weekId: fixture.weekId,
    runId, attempt, workdaysClaimed: 1,
    network, pageErrors, messagesSent: 0, paidAiCalls: 0,
    verifiedAt: new Date().toISOString(),
  });
  const directory = process.env.HOURS_CLIENT_EVIDENCE_DIR;
  if (directory) {
    mkdirSync(resolve(directory), { recursive: true });
    writeFileSync(resolve(directory, 'result.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  await client.context.close();
  await internal.close();
});
