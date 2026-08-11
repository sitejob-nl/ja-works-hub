// Observability voor edge functions — Sentry zonder SDK.
//
// WAAROM GEEN @sentry/deno: die trekt een hele dependency-boom via esm.sh in élke
// edge function die 'm importeert (bundle-gewicht + supply-chain-risico op een pad dat
// BSN/IBAN-verwerkende functies raakt). Het Sentry-ingest-protocol is een simpel
// envelope-formaat over één POST; dat bouwen we hier met alleen Deno-globals
// (fetch, crypto.randomUUID, AbortSignal.timeout). ZERO imports — bewust.
//
// STRIKTE NO-OP zonder een parseerbare `SENTRY_DSN_EDGE`: lokaal, preview, CI en elke
// omgeving zonder secret sturen niets en gedragen zich alsof dit bestand er niet is.
//
// FAIL-OPEN: geen enkele export gooit ooit. Alles zit in try/catch en het netwerk staat
// onder AbortSignal.timeout(5000), zodat een Sentry-storing nooit een cron kan laten
// hangen. `withCronMonitor` is de enige die gooit — en dan bewust de ORIGINELE fout van
// het werk, nooit een fout uit de rapportage.
//
// PRIVACY (HR-app met BSN/IBAN/e-mail/telefoon van arbeidsmigranten): we sturen NOOIT
// request-bodies of headers mee, en élke string die de deur uit gaat (message, exception
// value, stacktrace-frames, extra-waarden) gaat door `scrubText`. De scrub is bewust
// ruimer dan `cv-pseudonymize.ts`:
//   - telefoon: daar alleen NL (+31/0), hier ook buitenlandse landcodes (+48 PL, +40 RO,
//     …) — de doelgroep is arbeidsmigranten, dus buitenlandse nummers zijn de regel;
//   - BSN: daar met 11-proef, hier élke losse 9-cijferreeks. In een logcontext is
//     over-maskeren gratis en onder-maskeren een datalek;
//   - extra: JWT/bearer-tokens → [TOKEN], want edge functions loggen graag headers-achtige
//     strings mee.
// Naam blijft een restrisico (geen betrouwbaar patroon); gemitigeerd doordat we geen
// bodies meesturen en sensitieve sleutels in `extra` redacten.

/* -------------------------------------------------------------------------- */
/* Env-toegang                                                                 */
/* -------------------------------------------------------------------------- */

// Via globalThis i.p.v. bare `Deno.env`, zodat dit bestand ook importeerbaar is buiten
// de Deno-runtime (de unit-tests draaien onder vitest/Node). Deno.env.get gooit bovendien
// zonder --allow-env; vandaar de try/catch.
function readEnv(key: string): string | undefined {
  try {
    // deno-lint-ignore no-explicit-any
    const deno = (globalThis as any).Deno;
    if (typeof deno?.env?.get !== 'function') return undefined;
    const value = deno.env.get(key);
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* DSN-parsing                                                                 */
/* -------------------------------------------------------------------------- */

export interface ParsedDsn {
  /** Public key uit het DSN (het `user`-deel). */
  publicKey: string;
  /** Host inclusief eventuele poort. */
  host: string;
  /** Numeriek project-id (laatste padsegment). */
  projectId: string;
  /** Volledige ingest-URL: `<proto>//<host><prefix>/api/<projectId>/envelope/`. */
  envelopeUrl: string;
  /** Waarde voor de `X-Sentry-Auth`-header. */
  authHeader: string;
}

const SENTRY_CLIENT = 'jawerkt-edge/1.0';

/**
 * Parseert `https://<publicKey>@<host>[/<prefix>]/<projectId>` naar de ingest-URL en
 * auth-header. Returnt `null` bij alles wat niet klopt (leeg, rommel, geen key, geen
 * project-id, ander protocol) — de aanroeper valt dan terug op no-op.
 */
export function parseDsn(dsn: string | null | undefined): ParsedDsn | null {
  if (!dsn || typeof dsn !== 'string') return null;
  try {
    const url = new URL(dsn.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

    const publicKey = decodeURIComponent(url.username || '');
    if (!publicKey) return null;
    if (!url.host) return null;

    const segments = url.pathname.split('/').filter(Boolean);
    const projectId = segments.pop() ?? '';
    // Sentry-project-ids zijn altijd numeriek; dit vangt `https://key@host/api/` e.d. af.
    if (!/^\d+$/.test(projectId)) return null;

    const prefix = segments.length > 0 ? `/${segments.join('/')}` : '';
    return {
      publicKey,
      host: url.host,
      projectId,
      envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
      authHeader: `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=${SENTRY_CLIENT}`,
    };
  } catch {
    return null;
  }
}

// Micro-cache: readEnv + URL-parsing per aanroep is verspilling in een cron-loop, maar we
// lezen wél elke keer de env (zodat gedrag niet aan module-load-tijd vastzit).
let dsnCacheKey: string | undefined;
let dsnCacheValue: ParsedDsn | null = null;

function currentDsn(): ParsedDsn | null {
  const raw = readEnv('SENTRY_DSN_EDGE');
  if (!raw) return null;
  if (raw !== dsnCacheKey) {
    dsnCacheKey = raw;
    dsnCacheValue = parseDsn(raw);
  }
  return dsnCacheValue;
}

/** True als er een geldig, parseerbaar `SENTRY_DSN_EDGE` staat. Gooit nooit. */
export function sentryEnabled(): boolean {
  try {
    return currentDsn() !== null;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* PII-scrub                                                                   */
/* -------------------------------------------------------------------------- */

// Volgorde is kritisch (zie cv-pseudonymize.ts voor dezelfde les): structurele patronen
// die elkaars cijferreeksen kunnen opeten moeten van specifiek naar generiek.
//   1. JWT/bearer/secret-kv  — anders eet de IBAN-regex stukjes base64
//   2. e-mail
//   3. IBAN                  — vóór telefoon/BSN, anders wordt het staartnummer opgegeten
//   4. telefoon (intl + NL)
//   5. BSN (kale 9-cijferreeks)

const JWT_RE = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]+)?/g;
const BEARER_RE = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
// Supabase-sleutels (sb_secret_…, sbp_…) en vergelijkbare geprefixte tokens.
const PREFIXED_KEY_RE = /\bsb(?:p|_secret|_publishable)_[A-Za-z0-9_-]{8,}/g;
// `authorization: <waarde>` / `api_key="…"` en varianten in vrije tekst.
const TOKEN_KV_RE =
  /\b(authorization|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|service[_-]?role[_-]?key|webhook[_-]?secret|client[_-]?secret|password|secret|token)("?\s*[:=]\s*"?)([^\s"',;)}\]]{6,})/gi;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// IBAN in blokken van 4 (met of zonder spaties), eventueel met een cijferige restgroep.
// Bewust NIET `(?:[ ]?[A-Z0-9]){10,30}` zoals de frontend-variant: die is greedy over
// spaties en at hele woorden op ("NL91ABNA0417164300 betaald" → "[IBAN]").
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4})+(?:[ ]?\d{1,3})?\b/gi;

// Internationaal: +48 123 456 789 / 0031612345678 / +40-721-123-456. Landcode verplicht,
// daarna een cijferblok met scheidingstekens; het aantal cijfers valideren we in de callback.
const PHONE_INTL_RE = /(?:\+|\b00)\d[\d\s().-]{5,20}\d/g;
// Nationaal NL: 0612345678 / 06-12345678 / 06 12 34 56 78 / (020) 123 45 67.
const PHONE_NL_RE = /\b0\d[\d\s().-]{6,16}\d/g;

const BSN_RE = /\b\d{9}\b/g;

const MAX_STRING_LEN = 4000;

function maskIban(match: string): string {
  const compact = match.replace(/\s/g, '');
  // IBAN is 15-34 tekens; korter/langer is een hash, artikelnummer of iets anders.
  if (compact.length < 15 || compact.length > 34) return match;
  return '[IBAN]';
}

function maskPhone(match: string): string {
  const digits = match.replace(/\D/g, '');
  // < 9 cijfers: geen telefoonnummer (versienummers, bedragen). > 15: buiten E.164.
  if (digits.length < 9 || digits.length > 15) return match;
  return '[TELEFOON]';
}

/**
 * Maskeert PII in één string. Idempotent genoeg om meerdere keren te draaien.
 * Gooit nooit; niet-strings gaan ongewijzigd terug.
 */
export function scrubText(value: string): string {
  if (typeof value !== 'string' || value.length === 0) return value;
  try {
    let out = value.length > MAX_STRING_LEN ? `${value.slice(0, MAX_STRING_LEN)}…[afgekapt]` : value;
    out = out
      .replace(JWT_RE, '[TOKEN]')
      .replace(BEARER_RE, (_m, scheme: string) => `${scheme} [TOKEN]`)
      .replace(PREFIXED_KEY_RE, '[TOKEN]')
      .replace(TOKEN_KV_RE, (_m, key: string, sep: string) => `${key}${sep}[TOKEN]`)
      .replace(EMAIL_RE, '[EMAIL]')
      .replace(IBAN_RE, maskIban)
      .replace(PHONE_INTL_RE, maskPhone)
      .replace(PHONE_NL_RE, maskPhone)
      .replace(BSN_RE, '[BSN]');
    return out;
  } catch {
    // Liever een generieke placeholder dan ongescrubde tekst naar een derde partij.
    return '[SCRUB_FAILED]';
  }
}

const SENSITIVE_KEY_RE =
  /bsn|iban|password|passw|token|secret|api[_-]?key|authorization|first_?name|last_?name|voornaam|achternaam|e?mail|phone|telefoon|address|adres|date_of_birth|geboortedatum/i;

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 4;
const MAX_KEYS = 40;
const MAX_ARRAY = 20;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursieve scrub voor `extra`-achtige structuren: sensitieve SLEUTELS worden geredact,
 * élke string-WAARDE gaat door `scrubText` (PII komt net zo vaak als waarde voor als
 * onder een herkenbare sleutel). Diepte/omvang begrensd zodat een dikke payload nooit
 * de check-in-latency opblaast.
 */
// deno-lint-ignore no-explicit-any
export function scrubDeep(value: any, depth = 0): any {
  try {
    if (typeof value === 'string') return scrubText(value);
    if (value === null || value === undefined) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth >= MAX_DEPTH) return '[DIEPTE_LIMIET]';
    if (Array.isArray(value)) {
      const sliced = value.slice(0, MAX_ARRAY).map((v) => scrubDeep(v, depth + 1));
      if (value.length > MAX_ARRAY) sliced.push(`…+${value.length - MAX_ARRAY} meer`);
      return sliced;
    }
    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      let n = 0;
      for (const [k, v] of Object.entries(value)) {
        if (n++ >= MAX_KEYS) {
          out['…'] = 'afgekapt';
          break;
        }
        out[k] = SENSITIVE_KEY_RE.test(k) ? REDACTED : scrubDeep(v, depth + 1);
      }
      return out;
    }
    // Errors, Dates, class-instances: naar een gescrubde string i.p.v. `{}`.
    return scrubText(String(value));
  } catch {
    return '[SCRUB_FAILED]';
  }
}

/* -------------------------------------------------------------------------- */
/* Envelope                                                                    */
/* -------------------------------------------------------------------------- */

function eventId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '');
  } catch {
    // Uiterst onwaarschijnlijk, maar een id zonder crypto is beter dan geen rapport.
    let s = '';
    while (s.length < 32) s += Math.floor(Math.random() * 16).toString(16);
    return s.slice(0, 32);
  }
}

function byteLength(s: string): number {
  try {
    return new TextEncoder().encode(s).length;
  } catch {
    return s.length;
  }
}

/**
 * Serialiseert één envelope volgens het Sentry-formaat:
 *   <envelope-header>\n<item-header>\n<payload>\n
 * Geëxporteerd zodat de unit-tests het formaat kunnen vastpinnen.
 */
export function buildEnvelope(
  itemType: 'event' | 'check_in',
  payload: Record<string, unknown>,
  envelopeEventId?: string,
): string {
  const body = JSON.stringify(payload);
  const header: Record<string, unknown> = { sent_at: new Date().toISOString() };
  if (envelopeEventId) header.event_id = envelopeEventId;
  const itemHeader = JSON.stringify({
    type: itemType,
    length: byteLength(body),
    content_type: 'application/json',
  });
  return `${JSON.stringify(header)}\n${itemHeader}\n${body}\n`;
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    // deno-lint-ignore no-explicit-any
    const ctor = (AbortSignal as any);
    return typeof ctor?.timeout === 'function' ? ctor.timeout(ms) : undefined;
  } catch {
    return undefined;
  }
}

const NETWORK_TIMEOUT_MS = 5000;

async function sendEnvelope(
  dsn: ParsedDsn,
  itemType: 'event' | 'check_in',
  payload: Record<string, unknown>,
  envelopeEventId?: string,
): Promise<void> {
  try {
    const res = await fetch(dsn.envelopeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': dsn.authHeader,
      },
      body: buildEnvelope(itemType, payload, envelopeEventId),
      signal: timeoutSignal(NETWORK_TIMEOUT_MS),
    });
    // Body altijd consumeren: Deno lekt anders de connectie-resource.
    try {
      await res.text();
    } catch {
      /* leeg antwoord is prima */
    }
  } catch (err) {
    // Rapportage mag nooit het echte werk breken; alleen een spoor in de function-log.
    try {
      console.warn('[sentry] envelope niet verzonden:', err instanceof Error ? err.message : String(err));
    } catch {
      /* no-op */
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Exceptions                                                                  */
/* -------------------------------------------------------------------------- */

export interface EdgeExceptionContext {
  /** Naam van de edge function, bv. 'check-vehicle-apk'. Wordt tag `fn`. */
  fn?: string;
  /** Logische job binnen de function, bv. 'onboarding-reminders'. Wordt tag `job`. */
  job?: string;
  /** Organisatie-id (géén PII). Wordt tag `organization_id`. */
  orgId?: string;
  /** Vrije context. Sleutels + waarden worden gescrubd. NOOIT bodies/headers meegeven. */
  extra?: Record<string, unknown>;
}

interface SentryFrame {
  filename: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

const STACK_LINE_RE = /^\s*at\s+(?:async\s+)?(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
const VENDOR_RE = /(?:deno\.land|esm\.sh|jsr\.io|cdn\.skypack|node_modules|denoland)/i;
const MAX_FRAMES = 30;

/** Parseert een V8-stack naar Sentry-frames (oudste eerst, zoals Sentry verwacht). */
function parseStack(stack: string | undefined): SentryFrame[] | undefined {
  if (!stack || typeof stack !== 'string') return undefined;
  const frames: SentryFrame[] = [];
  for (const line of stack.split('\n')) {
    const m = STACK_LINE_RE.exec(line);
    if (!m) continue;
    const filename = scrubText(m[2]);
    frames.push({
      filename,
      function: m[1] ? scrubText(m[1]) : undefined,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !VENDOR_RE.test(filename),
    });
    if (frames.length >= MAX_FRAMES) break;
  }
  if (frames.length === 0) return undefined;
  return frames.reverse();
}

function describeError(error: unknown): { type: string; value: string; stack?: string } {
  if (error instanceof Error) {
    return { type: error.name || 'Error', value: error.message || String(error), stack: error.stack };
  }
  if (typeof error === 'string') return { type: 'Error', value: error };
  try {
    return { type: 'Error', value: JSON.stringify(error) ?? String(error) };
  } catch {
    return { type: 'Error', value: String(error) };
  }
}

function environment(): string {
  return readEnv('SENTRY_ENVIRONMENT') ?? 'production';
}

function cleanTags(ctx?: EdgeExceptionContext): Record<string, string> {
  const tags: Record<string, string> = {};
  if (ctx?.fn) tags.fn = scrubText(String(ctx.fn));
  if (ctx?.job) tags.job = scrubText(String(ctx.job));
  if (ctx?.orgId) tags.organization_id = String(ctx.orgId);
  return tags;
}

/**
 * Stuurt een error-event naar Sentry. No-op zonder DSN; gooit nooit — veilig om aan te
 * roepen in een catch-blok waar de bestaande foutafhandeling leidend blijft.
 */
export async function captureEdgeException(
  error: unknown,
  ctx?: EdgeExceptionContext,
): Promise<void> {
  try {
    const dsn = currentDsn();
    if (!dsn) return;

    const { type, value, stack } = describeError(error);
    const frames = parseStack(stack);
    const id = eventId();
    const payload: Record<string, unknown> = {
      event_id: id,
      timestamp: new Date().toISOString(),
      platform: 'javascript',
      level: 'error',
      environment: environment(),
      server_name: 'supabase-edge',
      logger: ctx?.fn ? `edge/${ctx.fn}` : 'edge',
      tags: cleanTags(ctx),
      exception: {
        values: [
          {
            type: scrubText(type),
            value: scrubText(value),
            stacktrace: frames ? { frames } : undefined,
            mechanism: { type: 'generic', handled: true },
          },
        ],
      },
    };
    if (ctx?.extra && Object.keys(ctx.extra).length > 0) {
      payload.extra = scrubDeep(ctx.extra);
    }
    await sendEnvelope(dsn, 'event', payload, id);
  } catch {
    /* observability mag nooit de aanroeper breken */
  }
}

/* -------------------------------------------------------------------------- */
/* Cron check-ins                                                              */
/* -------------------------------------------------------------------------- */

export interface CronCheckInOptions {
  /** Slug van de monitor in Sentry; wordt bij de eerste check-in automatisch aangemaakt. */
  monitorSlug: string;
  status: 'in_progress' | 'ok' | 'error';
  /** Hergebruik het id van de `in_progress`-check-in om de run te sluiten. */
  checkInId?: string;
  /** Crontab-expressie. Alleen zinvol bij `in_progress` (upsert van de monitor-config). */
  schedule?: string;
  /** IANA-tijdzone; default Europe/Amsterdam (alle cron-jobs draaien op NL-tijd). */
  timezone?: string;
  maxRuntimeMinutes?: number;
  checkinMarginMinutes?: number;
  /** Looptijd in SECONDEN (Sentry-eenheid) — meesturen bij `ok`/`error`. */
  duration?: number;
}

const DEFAULT_TIMEZONE = 'Europe/Amsterdam';

/**
 * Stuurt één cron check-in. Bij `in_progress` gaat er een `monitor_config` mee zodat
 * Sentry de monitor upsert — dát is wat een GEMISTE run überhaupt detecteerbaar maakt
 * (zonder bekend schema weet Sentry niet dat er iets had moeten draaien).
 *
 * Returnt het `check_in_id` (ook als de POST faalde, zodat de afsluitende check-in
 * dezelfde run-id gebruikt) of `null` als Sentry uit staat.
 */
export async function cronCheckIn(opts: CronCheckInOptions): Promise<string | null> {
  try {
    const dsn = currentDsn();
    if (!dsn) return null;
    if (!opts?.monitorSlug) return null;

    const checkInId = opts.checkInId ?? eventId();
    const payload: Record<string, unknown> = {
      check_in_id: checkInId,
      monitor_slug: opts.monitorSlug,
      status: opts.status,
      environment: environment(),
    };
    if (typeof opts.duration === 'number' && Number.isFinite(opts.duration)) {
      payload.duration = Math.max(0, Math.round(opts.duration * 1000) / 1000);
    }
    // monitor_config alleen op de openende check-in (Sentry-spec).
    if (opts.status === 'in_progress' && opts.schedule) {
      const config: Record<string, unknown> = {
        schedule: { type: 'crontab', value: opts.schedule },
        timezone: opts.timezone ?? DEFAULT_TIMEZONE,
      };
      if (typeof opts.checkinMarginMinutes === 'number') config.checkin_margin = opts.checkinMarginMinutes;
      if (typeof opts.maxRuntimeMinutes === 'number') config.max_runtime = opts.maxRuntimeMinutes;
      payload.monitor_config = config;
    }

    await sendEnvelope(dsn, 'check_in', payload, checkInId);
    return checkInId;
  } catch {
    return null;
  }
}

export interface CronMonitorConfig {
  monitorSlug: string;
  /** Crontab-expressie zoals in `cron.job` — bv. '45 2 * * *'. */
  schedule: string;
  timezone?: string;
  maxRuntimeMinutes?: number;
  checkinMarginMinutes?: number;
  /** Naam van de edge function, voor de `fn`-tag op een eventuele exception. */
  fn?: string;
}

/**
 * Wikkelt cron-werk in een in_progress → ok/error check-in-paar.
 *
 * Het resultaat van `work()` gaat ongewijzigd terug en een fout gaat ONGEWIJZIGD door,
 * zodat de edge function zijn eigen HTTP-antwoord houdt. Zonder DSN is dit precies
 * `await work()` met wat try/catch eromheen.
 */
export async function withCronMonitor<T>(cfg: CronMonitorConfig, work: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  let checkInId: string | null = null;
  try {
    checkInId = await cronCheckIn({
      monitorSlug: cfg.monitorSlug,
      status: 'in_progress',
      schedule: cfg.schedule,
      timezone: cfg.timezone,
      maxRuntimeMinutes: cfg.maxRuntimeMinutes,
      checkinMarginMinutes: cfg.checkinMarginMinutes,
    });
  } catch {
    /* fail-open: zonder openende check-in draait het werk gewoon door */
  }

  try {
    const result = await work();
    try {
      await cronCheckIn({
        monitorSlug: cfg.monitorSlug,
        status: 'ok',
        checkInId: checkInId ?? undefined,
        duration: (Date.now() - startedAt) / 1000,
      });
    } catch {
      /* no-op */
    }
    return result;
  } catch (err) {
    try {
      await cronCheckIn({
        monitorSlug: cfg.monitorSlug,
        status: 'error',
        checkInId: checkInId ?? undefined,
        duration: (Date.now() - startedAt) / 1000,
      });
      await captureEdgeException(err, { fn: cfg.fn, job: cfg.monitorSlug });
    } catch {
      /* rapportage mag de originele fout nooit vervangen */
    }
    throw err;
  }
}
