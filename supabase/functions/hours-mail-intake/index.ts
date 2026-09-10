import { createAdminClient, jsonResponse, requireRolePermission } from '../_shared/auth.ts';
import { CORS_HEADERS } from '../_shared/http.ts';
import { readBoundedStream } from '../_shared/bounded-read.ts';
import {
  createHoursMailIntakeHandler, type HoursMailAuth,
} from '../_shared/hours-mail-intake.ts';
import {
  graphUrl, loadAccount, mailboxBasePath, accessTokenForCredential, loadProviderForAccount,
} from '../_shared/outlook-accounts.ts';

/**
 * Durable mail intake, as a cron target and as a manual run.
 *
 * Two entrances, one body. The unattended run validates `x-cron-secret` exactly
 * like the four existing cron jobs and walks every organisation that has the
 * hours module switched on; a person with `finance.manage` runs the very same
 * code over their own tenant.
 *
 * The mailbox is only ever read. The two ports below issue plain GETs and there
 * is no third: nothing is marked as read, moved, deleted or sent. Reading also
 * never costs anything — an attachment is stored, and the paid scan route stays
 * a deliberate act of a person behind the same monthly budget.
 */

const CORS = { ...CORS_HEADERS,
  'Access-Control-Allow-Headers': `${CORS_HEADERS['Access-Control-Allow-Headers']}, x-cron-secret` };

/** Above this a message is not stored; the delivered-source bucket refuses it too. */
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

async function authorize(req: Request): Promise<HoursMailAuth | Response> {
  const secret = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('x-cron-secret');
  if (secret && provided && provided === secret) return { mode: 'cron' };
  if (provided) return jsonResponse({ error: 'Onbekende cron-sleutel' }, 403, CORS);
  const auth = await requireRolePermission(req, 'finance.manage', CORS);
  if (auth instanceof Response) return auth;
  return { mode: 'user', organizationId: auth.organizationId };
}

/**
 * One mailbox request. A relative path is resolved against the mailbox this
 * account names — a shared mailbox is addressed by its own address, a personal
 * one by `/me` — so a caller can never point this at somebody else's mail.
 */
async function graphRequest(accountId: string, url: string, accept: string): Promise<Response> {
  const admin = createAdminClient();
  const { data: row } = await admin.from('mail_accounts')
    .select('organization_id').eq('id', accountId).is('deleted_at', null).maybeSingle();
  if (!row?.organization_id) throw new Error('mail_account_not_found');
  const provider = await loadProviderForAccount(admin, row.organization_id, {
    accountId, require: 'mail_read', bypassJaGrants: true,
  });
  // The request carries a bearer token for this mailbox, so where it goes is a
  // security question and not a routing one. An absolute URL is only ever a
  // follow-on link Graph itself handed back; anything else never gets the token.
  let target: URL;
  if (url.startsWith('https://')) {
    target = new URL(url);
    if (target.origin !== 'https://graph.microsoft.com') throw new Error('invalid_graph_url');
  } else {
    target = graphUrl(`${mailboxBasePath(provider.account)}${url}`);
  }
  const token = await accessTokenForCredential(admin, provider.credential);
  return await fetch(target, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: accept } });
}

Deno.serve(createHoursMailIntakeHandler({
  authorize,
  serviceRpc: (name, args) => createAdminClient().rpc(name, args),
  graphJson: async (accountId, url) => {
    const response = await graphRequest(accountId, url, 'application/json');
    if (!response.ok) { await response.body?.cancel(); return { status: response.status, body: {} }; }
    return { status: response.status, body: await response.json().catch(() => ({})) };
  },
  graphBytes: async (accountId, url) => {
    const response = await graphRequest(accountId, url, 'text/plain');
    if (!response.ok) { await response.body?.cancel(); return { status: response.status, bytes: new Uint8Array() }; }
    // The same bound the scan route uses, from the same place: a mailbox can
    // hold a message far larger than this module will ever store.
    const read = await readBoundedStream(response.body, MAX_MESSAGE_BYTES + 1);
    if (read.ok === false) return { status: read.reason === 'too_large' ? 413 : 502, bytes: new Uint8Array() };
    return { status: 200, bytes: read.value };
  },
  upload: async (path, bytes, contentType) => {
    const { error } = await createAdminClient().storage.from('hours-sources')
      .upload(path, bytes, { contentType, upsert: false });
    // The path is the digest, so an object that is already there holds these
    // very bytes; that is a duplicate delivery, not a failure.
    if (error && !/exists/i.test(error.message ?? '')) throw error;
  },
  digest: async (bytes) => {
    const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
    return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  },
}, CORS));
