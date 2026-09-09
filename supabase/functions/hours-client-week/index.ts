import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CORS_HEADERS as corsHeaders } from '../_shared/http.ts';
import {
  buildClientEntries,
  clientLinkStatusFromCode,
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

// Public and unauthenticated, so guessing a token has to run into a wall.
const MAX_PER_IP_PER_HOUR = 120;
const MAX_GLOBAL_PER_HOUR = 2000;
const ACTIONS = ['get', 'save', 'report', 'upload', 'register'] as const;
type Action = typeof ACTIONS[number];

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
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

/** A write refused by the database: a link problem the page can name, or the server's own words. */
function refusal(error: { code?: string | null; message?: string } | null): Response {
  const link = linkRefusal(error);
  return link ? json({ status: link }) : json({ error: error?.message ?? 'Dit kon niet worden opgeslagen.' }, 400);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const requested = typeof body.action === 'string' ? body.action : 'get';
    const action = (ACTIONS as readonly string[]).includes(requested) ? requested as Action : 'get';
    if (!token) return json({ status: 'invalid' });

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const tokenHash = await sha256Hex(token);
    const ipHash = await sha256Hex(clientIp(req));
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const [{ count: ipCount }, { count: globalCount }] = await Promise.all([
      service.from('hours_client_link_attempts').select('id', { count: 'exact', head: true })
        .eq('ip_hash', ipHash).gte('created_at', since),
      service.from('hours_client_link_attempts').select('id', { count: 'exact', head: true })
        .gte('created_at', since),
    ]);
    if ((ipCount ?? 0) >= MAX_PER_IP_PER_HOUR || (globalCount ?? 0) >= MAX_GLOBAL_PER_HOUR) {
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
      if (error) return json({ status: clientLinkStatusFromCode(error.code) });
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
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : '';
      const { data, error } = await call('hours_client_week_report', { p_kind: kind, p_note: note || null });
      if (error) return refusal(error);
      return json({ status: 'ok', week: data });
    }

    // Uploading is a two-step handshake. The database derives the storage path
    // from the link, so a client can only ever write inside its own week; the
    // bucket keeps enforcing the 25 MiB limit and the media types. The bytes
    // themselves never pass through this function.
    if (action === 'upload') {
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
    const { data, error } = await call('hours_client_week_add_source', {
      p_content_hash: typeof body.content_hash === 'string' ? body.content_hash : '',
      p_file_name: typeof body.file_name === 'string' ? body.file_name : '',
      p_content_type: typeof body.content_type === 'string' ? body.content_type : '',
      p_page_count: Number.isInteger(body.page_count) ? body.page_count : null,
    });
    if (error) return refusal(error);
    return json({ status: 'ok', week: data });
  } catch (error) {
    console.error('hours-client-week failed', error);
    return json({ error: 'Er ging iets mis. Probeer het later opnieuw.' }, 400);
  }
});
