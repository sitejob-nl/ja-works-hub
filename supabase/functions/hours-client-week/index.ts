import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CORS_HEADERS as corsHeaders } from '../_shared/http.ts';
import {
  buildClientEntries,
  clientLinkStatusFromCode,
  clientRefusalMessage,
  clientReportNote,
  isAlreadyStoredObject,
  isClientLinkCode,
  type ClientLinkStatus,
} from '../_shared/hours-client-entries.ts';

/**
 * The personal client week page (/urenweek/:token), without a login.
 *
 * There is no session here, so the released hours RPCs — which authorize an
 * active internal profile — do not apply. This function holds the service-role
 * key and is the only caller of the five `hours_client_week_*` functions, which
 * are executable by service_role alone.
 *
 * It authorizes nothing itself. Every rule lives in the database: the token
 * digest, the validity period, the withdrawal, the SaaS module, the enabled
 * client, and above all the scope — the week comes from the link, and every
 * workday and storage path is derived from that link. A token of client A
 * therefore cannot reach client B, and no payload from here can change that.
 *
 * What a client fills in lands as a *proposal*. Nothing in this file can write
 * a day revision; only `hours_apply_source_proposal` does, and that still needs
 * a named internal user.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/**
 * Public and unauthenticated, so guessing a token has to run into a wall.
 *
 * A 244-bit token is not going to be guessed; these limits exist against
 * scripted noise and against bandwidth. The per-IP ceiling is generous because
 * a whole planning office sits behind one address: four planners each filling in
 * a week and attaching photos on deadline day must not lock each other out.
 *
 * The narrow limit covers both halves of delivering a file. `upload` only mints
 * a signed address, but `register` downloads the whole object and hashes it
 * inside this function, so that is where the bytes and the work actually are.
 * The global counter is a last-resort brake shared by every organization, so it
 * sits far above any realistic use — a low ceiling there would let one abuser
 * stop the platform.
 */
const MAX_PER_IP_PER_HOUR = 600;
const FILE_ACTIONS = new Set(['upload', 'register']);
const MAX_FILE_ACTIONS_PER_IP_PER_HOUR = 120;
const MAX_GLOBAL_PER_HOUR = 20_000;
/** How long an uploaded object may sit around before it has become a source. */
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
/** Bounded so one sweep stays fast; a client can upload far fewer per hour. */
const SWEEP_PAGE_SIZE = 100;
const SWEEP_PAGES = 5;
const ACTIONS = ['get', 'save', 'report', 'upload', 'register'] as const;
type Action = typeof ACTIONS[number];

const toHex = (digest: ArrayBuffer) =>
  [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');

async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function sha256Bytes(bytes: ArrayBuffer): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') || '';
  return forwarded.split(',')[0].trim() || 'unknown';
}

/**
 * Only a refusal about the *link itself* replaces the page. Everything else —
 * a workday outside this week, an unreadable duration, a switched-off client —
 * is reported verbatim, so the visitor keeps the page they were filling in.
 */
function linkRefusal(error: { code?: string | null } | null): ClientLinkStatus | null {
  return isClientLinkCode(error?.code) ? clientLinkStatusFromCode(error?.code) : null;
}

/**
 * A write refused by the database: a link problem the page can name, or this
 * module's own Dutch words about what it refused. Anything Postgres itself
 * phrased stays out of a page that anyone with a link can open.
 */
function refusal(error: { code?: string | null; message?: string } | null): Response {
  const link = linkRefusal(error);
  if (link) return json({ status: link });
  if (!isClientLinkCode(error?.code) && error?.code && !['22023', '42501'].includes(error.code)) {
    console.error('hours-client-week: refused write', error.code, error.message);
  }
  return json({ error: clientRefusalMessage(error) }, 400);
}

/** The builder is thenable, so awaiting it yields exactly this shape. */
type Call = (name: string, args?: Record<string, unknown>) =>
  PromiseLike<{ data: unknown; error: { code?: string | null; message?: string } | null }>;
/** Only the storage side is used here; the generic client type adds nothing. */
type Storage = { storage: ReturnType<typeof createClient>['storage'] };

/**
 * Removes the objects this link uploaded but never turned into a source, once
 * they are past the grace period. Best effort: a failure here must never block
 * a delivery, so it is logged and the upload continues.
 */
async function sweepUnregistered(service: Storage, call: Call): Promise<void> {
  try {
    const { data, error } = await call('hours_client_week_stored_paths');
    if (error) return;
    const { prefix, paths } = (data ?? {}) as { prefix?: string; paths?: string[] };
    if (!prefix) return;
    const registered = new Set(paths ?? []);
    // Ordered oldest first, and paged. The client picks the object *name* (it is
    // the digest it announced), so a listing on name would let it park files
    // under a high name that the window never reaches while fresh low names keep
    // it busy. Age is the one ordering it cannot choose.
    const cutoff = Date.now() - ORPHAN_GRACE_MS;
    const stale: string[] = [];
    for (let page = 0; page < SWEEP_PAGES; page += 1) {
      const listing = await service.storage.from('hours-sources').list(prefix, {
        limit: SWEEP_PAGE_SIZE, offset: page * SWEEP_PAGE_SIZE,
        sortBy: { column: 'created_at', order: 'asc' },
      });
      if (listing.error || !listing.data?.length) break;
      let reachedFresh = false;
      for (const entry of listing.data) {
        const created = Date.parse(entry.created_at ?? '');
        if (!Number.isFinite(created)) continue;
        // Oldest first, so the first fresh object ends the sweep.
        if (created >= cutoff) { reachedFresh = true; break; }
        const path = `${prefix}/${entry.name}`;
        if (!registered.has(path)) stale.push(path);
      }
      if (reachedFresh || listing.data.length < SWEEP_PAGE_SIZE) break;
    }
    if (!stale.length) return;
    const removal = await service.storage.from('hours-sources').remove(stale);
    if (removal.error) {
      console.error('hours-client-week: sweep failed', removal.error.message);
    }
  } catch (error) {
    console.error('hours-client-week: sweep failed', error instanceof Error ? error.message : 'unknown');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const requested = typeof body.action === 'string' ? body.action : 'get';
    if (!(ACTIONS as readonly string[]).includes(requested)) {
      return json({ error: 'Onbekende handeling.' }, 400);
    }
    const action = requested as Action;
    if (!token) return json({ status: 'invalid' });

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const tokenHash = await sha256Hex(token);
    const ipHash = await sha256Hex(clientIp(req));
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const deliveringFile = FILE_ACTIONS.has(action);
    const [perIp, global, uploads] = await Promise.all([
      service.from('hours_client_link_attempts').select('id', { count: 'exact', head: true })
        .eq('ip_hash', ipHash).gte('created_at', since),
      service.from('hours_client_link_attempts').select('id', { count: 'exact', head: true })
        .gte('created_at', since),
      deliveringFile
        ? service.from('hours_client_link_attempts').select('id', { count: 'exact', head: true })
            .eq('ip_hash', ipHash).in('action', [...FILE_ACTIONS]).gte('created_at', since)
        : Promise.resolve({ count: 0, error: null }),
    ]);
    // A count that fails or comes back empty says nothing about how many
    // attempts there were. Treating that as zero would quietly switch the
    // throttle off, so it closes just like a failing insert does below.
    if (perIp.error || global.error || uploads.error
        || perIp.count === null || global.count === null || uploads.count === null) {
      console.error('hours-client-week: throttle unreadable',
        perIp.error?.message ?? global.error?.message ?? uploads.error?.message ?? 'no count');
      return json({ error: 'Deze pagina is tijdelijk niet beschikbaar. Probeer het later opnieuw.' }, 503);
    }
    if (perIp.count >= MAX_PER_IP_PER_HOUR || global.count >= MAX_GLOBAL_PER_HOUR
        || (deliveringFile && uploads.count >= MAX_FILE_ACTIONS_PER_IP_PER_HOUR)) {
      return json({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }, 429);
    }
    // Logged before the token is resolved, and in its own statement: a database
    // exception would roll back a counter written inside the same transaction,
    // which is exactly the case a throttle has to survive. The prefix is of the
    // digest, never of the secret itself. If the log is unavailable the endpoint
    // closes rather than serving unthrottled.
    const { error: logError } = await service.from('hours_client_link_attempts')
      .insert({ ip_hash: ipHash, token_prefix: tokenHash.slice(0, 12), action });
    if (logError) {
      console.error('hours-client-week: throttle log unavailable', logError.message);
      return json({ error: 'Deze pagina is tijdelijk niet beschikbaar. Probeer het later opnieuw.' }, 503);
    }

    const call = (name: string, args: Record<string, unknown> = {}) =>
      service.rpc(name, { p_token_hash: tokenHash, ...args });

    if (action === 'get') {
      const { data, error } = await call('hours_client_week_view');
      if (error) {
        // A missing grant or a broken projection would otherwise show every
        // visitor "niet beschikbaar" while the logs stayed empty.
        if (!isClientLinkCode(error.code) && error.code !== '22023') {
          console.error('hours-client-week: read refused', error.code, error.message);
        }
        return json({ status: clientLinkStatusFromCode(error.code) });
      }
      return json({ status: 'ok', week: data });
    }

    if (action === 'save') {
      const { entries, issues } = buildClientEntries(body.entries);
      if (issues.length) return json({ error: issues[0].message, issues }, 400);
      if (!entries.length) return json({ error: 'Er is niets ingevuld om op te slaan.' }, 400);
      const { data, error } = await call('hours_client_week_save', { p_entries: entries });
      if (error) return refusal(error);
      return json({ status: 'ok', week: data });
    }

    if (action === 'report') {
      const kind = body.kind === 'later' || body.kind === 'complete' ? body.kind : null;
      if (!kind) return json({ error: 'Onbekende melding over deze aanlevering.' }, 400);
      const note = clientReportNote(body.note);
      if (note.ok === false) return json({ error: note.message }, 400);
      const { data, error } = await call('hours_client_week_report', { p_kind: kind, p_note: note.note });
      if (error) return refusal(error);
      return json({ status: 'ok', week: data });
    }

    // Uploading is a two-step handshake. The database derives the storage path
    // from the link, so a client can only ever write inside its own week; the
    // bucket keeps enforcing the 25 MiB limit and the media types. The bytes
    // themselves never pass through this function.
    if (action === 'upload') {
      // What this link uploaded but never registered has no owner, no lifecycle
      // and nothing that can find it. Each new upload sweeps up its own link's
      // leftovers, so a client cannot quietly fill the bucket by asking for
      // addresses and walking away.
      await sweepUnregistered(service, call);
      const { data, error } = await call('hours_client_week_upload_path', {
        p_content_hash: typeof body.content_hash === 'string' ? body.content_hash : '',
        p_content_type: typeof body.content_type === 'string' ? body.content_type : '',
      });
      if (error) return refusal(error);
      const objectPath = (data as { path?: string } | null)?.path;
      if (!objectPath) return json({ status: 'unavailable' });
      const { data: signed, error: signError } = await service.storage
        .from('hours-sources').createSignedUploadUrl(objectPath);
      if (signError) {
        // The path is the digest of the bytes, so an object that is already
        // there holds exactly this file: registering it yields one source, not
        // a second. Any other storage failure is a real failure, and calling it
        // "already delivered" would surface later as a misleading "not found".
        if (isAlreadyStoredObject(signError)) {
          return json({ status: 'ok', path: objectPath, already_uploaded: true });
        }
        console.error('hours-client-week: upload could not be signed', signError.message);
        return json({ error: 'Uw bestand kon nu niet worden aangeboden. Probeer het later opnieuw.' }, 503);
      }
      return json({ status: 'ok', path: objectPath, token: signed.token });
    }

    // action === 'register'
    //
    // Sweeps here as well as on upload: a client that delivers one file and
    // never returns still leaves through this path.
    await sweepUnregistered(service, call);
    //
    // The digest decides the storage path *and* the deduplication key. For the
    // internal route that is fine: only trusted internal code can write there,
    // and the reviewer sees the actual bytes. Here an outside party can write,
    // so an unverified digest would let a link holder park doctored bytes under
    // the digest of a file the office is about to upload — the office's upload
    // would then be deduplicated away and the reviewer would read the client's
    // file under the office's name. So for this route the digest is a promise
    // that gets checked before anything is recorded.
    const contentHash = typeof body.content_hash === 'string' ? body.content_hash.trim().toLowerCase() : '';
    const contentType = typeof body.content_type === 'string' ? body.content_type : '';
    const { data: pathData, error: pathError } = await call('hours_client_week_upload_path', {
      p_content_hash: contentHash, p_content_type: contentType,
    });
    if (pathError) return refusal(pathError);
    const storedPath = (pathData as { path?: string } | null)?.path;
    if (!storedPath) return json({ status: 'unavailable' });
    const stored = await service.storage.from('hours-sources').download(storedPath);
    if (stored.error || !stored.data) {
      return json({ error: 'Uw bestand is niet gevonden. Probeer het opnieuw te versturen.' }, 400);
    }
    const actualHash = await sha256Bytes(await stored.data.arrayBuffer());
    if (actualHash !== contentHash) {
      // Leaving it there would keep that digest occupied for everyone, so the
      // object goes; a failed removal is logged and still refuses the delivery.
      const removal = await service.storage.from('hours-sources').remove([storedPath]);
      if (removal.error) {
        console.error('hours-client-week: mismatching upload could not be removed', removal.error.message);
      }
      console.error('hours-client-week: upload did not match its digest', storedPath);
      return json({ error: 'Uw bestand kwam niet overeen met wat er werd aangekondigd en is niet bewaard.' }, 400);
    }
    const { data, error } = await call('hours_client_week_add_source', {
      p_content_hash: contentHash,
      p_file_name: typeof body.file_name === 'string' ? body.file_name : '',
      p_content_type: contentType,
      p_page_count: Number.isInteger(body.page_count) ? body.page_count : null,
    });
    if (error) return refusal(error);
    // The projection is returned with two extra keys; the client page reads the
    // week through its own schema, so they travel beside it rather than inside it.
    const { duplicate, source_id: sourceId, ...week } = (data ?? {}) as Record<string, unknown>;
    if (duplicate === true) {
      // The source already existed under another path — the office delivered the
      // same file, or another link did. This object will therefore never be
      // referenced by anything, so it goes now rather than waiting for a sweep
      // that only runs if this link happens to upload again.
      const { data: stored } = await call('hours_client_week_stored_paths');
      const paths = new Set(((stored ?? {}) as { paths?: string[] }).paths ?? []);
      if (!paths.has(storedPath)) {
        const removal = await service.storage.from('hours-sources').remove([storedPath]);
        if (removal.error) {
          console.error('hours-client-week: unreferenced upload could not be removed', removal.error.message);
        }
      }
    }
    return json({ status: 'ok', week, duplicate: duplicate === true, source_id: sourceId ?? null });
  } catch (error) {
    console.error('hours-client-week failed', error);
    return json({ error: 'Er ging iets mis. Probeer het later opnieuw.' }, 400);
  }
});
