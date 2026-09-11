import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Connected QA for the durable mail intake (ticket T7) against the verified demo
 * tenant. Load credentials with node --env-file; never copy them into fixtures
 * or evidence.
 *
 * The mailbox is the sharp edge here, so this run is deliberately narrow and
 * strictly reading. The demo organisation has exactly one connected Outlook
 * mailbox and it is a real business mailbox of a real person, with hundreds of
 * real messages in its inbox. This run therefore follows exactly one **empty**
 * folder of that mailbox and proves at the end that every folder is exactly as
 * it was: same item counts, same unread counts.
 *
 * What only a real mailbox can prove is proven here — that the stored token is
 * decrypted and used, that a delta query answers, that the cursor Graph hands
 * back is stored and resumed on the next pass, that no folder of another tenant
 * is polled, and that reading changed nothing at all.
 *
 * What is deliberately **not** proven here is a real message being read into a
 * proposal. Staging one would mean writing into somebody's real mailbox, and
 * this account is configured read-and-send only: it cannot move a message into a
 * test folder. That path is covered by fixed Graph answers over the real handler
 * and by real PostgreSQL in the database harness.
 *
 * There is no paid call anywhere on this route.
 */
const DEMO_ORG = '6dedabe4-f62c-479e-b5fc-ebfcb824d76f';
const JA_WERKT_ORG = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const API = 'https://noaupcteygfvlyymqtew.supabase.co';
const AUTH_KEY = 'sb-noaupcteygfvlyymqtew-auth-token';
/** The one folder this run follows: empty before, and untouched after. */
const TEST_FOLDER_NAME = 'Archiveren';

type Fixture = { runId: string; organizationId: string; companyId: string; weekId: string };
type Folder = { id: string; display_name: string; total_item_count: number; unread_item_count: number };
type Overview = {
  can_manage: boolean;
  folders: { id: string; folder_label: string; has_cursor: boolean; pending: number; filed: number;
    last_error: string | null; resync_count: number }[];
  attention: unknown[];
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

async function login(page: Page) {
  await page.goto('/login');
  expect(await page.evaluate(key => sessionStorage.getItem(key), AUTH_KEY),
    'fresh login has no inherited session').toBeNull();
  await page.locator('#email').fill(required('DEMO_ORG_EMAIL'));
  await page.locator('#password').fill(required('DEMO_ORG_PASSWORD'));
  const loginResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/auth/v1/token' && response.request().method() === 'POST');
  await page.locator('form').getByRole('button', { name: /Inloggen|Log in/i }).click();
  expect((await loginResponse).status(), 'internal form authentication').toBe(200);
  await page.waitForURL(url => !url.pathname.endsWith('/login'));
}

function observe(page: Page) {
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== API) return;
    // Paths and statuses only: no query strings, headers, bodies or addresses.
    network.push({ method: response.request().method(), path: url.pathname, status: response.status() });
  });
  page.on('pageerror', error => pageErrors.push(error.name));
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

const rpc = (page: Page, name: string, args: Record<string, unknown>) =>
  browserRequest(page, `/rest/v1/rpc/${name}`, args);
const fn = (page: Page, name: string, body: Record<string, unknown>) =>
  browserRequest(page, `/functions/v1/${name}`, body);

async function folders(page: Page, accountId: string): Promise<Folder[]> {
  const answer = await fn(page, 'outlook-mail', { action: 'folders', account_id: accountId });
  expect(answer.status, 'reading the folder list of the demo mailbox').toBe(200);
  return (answer.body as { folders: Folder[] }).folders;
}

/** Item and unread counts of every folder: the proof that reading changed nothing. */
const shape = (list: Folder[]) => Object.fromEntries(list
  .map(folder => [folder.display_name, `${folder.total_item_count}/${folder.unread_item_count}`]));

test('de inname leest een gevolgde map en laat de postbus met rust', async ({ page }) => {
  test.setTimeout(600_000);
  observe(page);
  const fixture = JSON.parse(readFileSync(resolve(required('HOURS_MAIL_FIXTURE')), 'utf8')) as Fixture;
  expect(fixture.organizationId, 'the fixture must be the verified demo tenant').toBe(DEMO_ORG);
  await login(page);

  // --- the one mailbox, and the one folder this run may follow --------------
  const accounts = await fn(page, 'outlook-accounts', { action: 'visible', capability: 'mail_read' });
  expect(accounts.status).toBe(200);
  const mailboxes = (accounts.body as { accounts: { id: string; scope: string; email: string }[] }).accounts;
  const company = mailboxes.filter(account => account.scope === 'organization');
  expect(company, 'the demo tenant has exactly one connected company mailbox').toHaveLength(1);
  const mailbox = company[0];

  const before = await folders(page, mailbox.id);
  const testFolder = before.find(folder => folder.display_name === TEST_FOLDER_NAME);
  expect(testFolder, `this run needs the folder ${TEST_FOLDER_NAME}`).toBeTruthy();
  expect(testFolder!.total_item_count,
    'the followed folder must be empty, so no real mail is recorded').toBe(0);
  const shapeBefore = shape(before);
  record('mailbox', {
    company_mailboxes: 1, followed_folder: TEST_FOLDER_NAME,
    items_in_followed_folder: 0, folders_in_mailbox: before.length,
  });

  // --- the request reference, through the real route ------------------------
  const issued = await rpc(page, 'hours_issue_week_request',
    { p_week_id: fixture.weekId, p_label: `QA ${fixture.runId}`, p_valid_days: 1 });
  expect(issued.status, 'issuing a request reference').toBe(200);
  const { code, request_id: requestId } = issued.body as { code: string; request_id: string };
  expect(code, 'the code is readable and carries no confusable characters')
    .toMatch(/^UR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
  record('reference', { issued: true, valid_days: 1, shape_ok: true });

  // --- following that folder, and two unattended passes ---------------------
  const followed = await rpc(page, 'hours_mail_set_folder', {
    p_mail_account_id: mailbox.id, p_folder_id: testFolder!.id,
    p_folder_label: `QA ${TEST_FOLDER_NAME}`, p_enabled: true,
  });
  expect(followed.status, 'following the test folder with a real read grant').toBe(200);

  const first = await fn(page, 'hours-mail-intake', {});
  expect(first.status, 'one pass over the followed folder').toBe(200);
  const firstRun = first.body as { mode: string; folders: number; filed: number; attention: number; errors: string[] };
  expect(firstRun.mode).toBe('user');
  expect(firstRun.folders, 'exactly this tenant\'s one folder was polled').toBe(1);
  expect(firstRun.errors, 'the real Graph delta query answered').toEqual([]);
  expect(firstRun.filed, 'an empty folder yields nothing').toBe(0);
  record('first_pass', firstRun);

  const afterFirst = (await rpc(page, 'hours_mail_overview', {})).body as Overview;
  const followedFolder = afterFirst.folders.find(entry => entry.folder_label === `QA ${TEST_FOLDER_NAME}`);
  expect(followedFolder, 'the followed folder is on the screen').toBeTruthy();
  expect(followedFolder!.has_cursor, 'Graph handed back a delta cursor and it was stored').toBe(true);
  expect(followedFolder!.last_error, 'the pass finished cleanly').toBeNull();
  expect(followedFolder!.pending, 'nothing is waiting in the queue').toBe(0);
  expect(afterFirst.attention, 'nothing is waiting in the control bin').toHaveLength(0);
  record('cursor', { stored: true, resync_count: followedFolder!.resync_count });

  const second = await fn(page, 'hours-mail-intake', {});
  expect(second.status).toBe(200);
  expect((second.body as { errors: string[] }).errors,
    'the stored cursor is accepted by Graph on the next pass').toEqual([]);
  const afterSecond = (await rpc(page, 'hours_mail_overview', {})).body as Overview;
  const again = afterSecond.folders.find(entry => entry.folder_label === `QA ${TEST_FOLDER_NAME}`)!;
  expect(again.resync_count, 'a valid cursor is never thrown away').toBe(followedFolder!.resync_count);
  expect(again.last_error).toBeNull();
  record('second_pass', { resumed: true, resync_count: again.resync_count });

  // --- nothing was recorded, because there was nothing to record ------------
  const observed = await browserRequest(page,
    `/rest/v1/hours_mail_messages?select=id&organization_id=eq.${DEMO_ORG}`);
  expect(observed.body, 'an empty folder records no message metadata at all').toEqual([]);

  // --- the mailbox is exactly as it was -------------------------------------
  const afterFolders = await folders(page, mailbox.id);
  expect(shape(afterFolders), 'every folder has the same item and unread count as before')
    .toEqual(shapeBefore);
  record('mailbox_untouched', { folders_compared: Object.keys(shapeBefore).length });

  // --- the other tenant is never polled, and no hours were written ----------
  const jaWerkt = await browserRequest(page,
    `/rest/v1/hours_mail_folders?select=id&organization_id=eq.${JA_WERKT_ORG}`);
  expect(jaWerkt.body, 'no folder is followed in the JA Werkt tenant').toEqual([]);
  // Read through the week projection: a revision belongs to a day, not to a week.
  const week = (await rpc(page, 'hours_get_week', { p_week_id: fixture.weekId }))
    .body as { members: { days: { current_revision: unknown | null }[] }[] };
  const written = week.members.flatMap(member => member.days)
    .filter(day => day.current_revision !== null);
  expect(written, 'no day revision was written by this run').toEqual([]);
  const timesheets = await browserRequest(page,
    `/rest/v1/timesheets?select=id&organization_id=eq.${DEMO_ORG}&created_at=gte.${new Date(Date.now() - 3600_000).toISOString()}`);
  expect(timesheets.body, 'the legacy hours route is never written').toEqual([]);

  // --- the screen says what happened ----------------------------------------
  await page.goto('/uren/mailinname');
  await expect(page.getByText(`QA ${TEST_FOLDER_NAME}`)).toBeVisible();
  await expect(page.getByText(/alleen gelezen/i)).toBeVisible();
  await expect(page.getByText(/Alles wat binnenkwam is geplaatst/i)).toBeVisible();

  // --- clean up: stop following and withdraw the reference ------------------
  const stopped = await rpc(page, 'hours_mail_set_folder', {
    p_mail_account_id: mailbox.id, p_folder_id: testFolder!.id,
    p_folder_label: `QA ${TEST_FOLDER_NAME}`, p_enabled: false,
  });
  expect(stopped.status).toBe(200);
  await rpc(page, 'hours_revoke_week_request', { p_request_id: requestId, p_note: 'QA afgerond' });
  record('cleanup', { folder_disabled: true, request_revoked: true });

  expect(pageErrors, 'no JavaScript errors').toEqual([]);
  expect(network.filter(entry => entry.status >= 500), 'no server errors').toEqual([]);

  evidence.summary = {
    run_id: fixture.runId, organization: DEMO_ORG,
    workdays_claimed: 0, outgoing_messages: 0, mailbox_writes: 0,
    paid_ai_calls: 0, timesheet_writes: 0, day_revisions: 0,
    message_metadata_recorded: 0,
    api_calls: network.length, javascript_errors: 0, server_errors: 0,
    not_proven_here: 'a real message read into a proposal; this mailbox is read-and-send only, '
      + 'so no message can be staged in a test folder',
    verified_at: new Date().toISOString(),
  };
  evidence.network = network;
  const directory = process.env.HOURS_MAIL_EVIDENCE_DIR ?? '../test-results/hours-mail';
  mkdirSync(resolve(directory), { recursive: true });
  writeFileSync(resolve(directory, 'hours-mail-demo-qa-result.json'),
    `${JSON.stringify(evidence, null, 2)}\n`);
});
