// Observability — Sentry frontend (Track C).
//
// ADDITIEF bovenop de bestaande pipeline: de ErrorBoundary + initGlobalErrorLogging
// blijven naar de `client_errors`-tabel schrijven (RLS-beschermd, EU-resident). Sentry
// is de rijkere triage-laag ernaast.
//
// STRIKTE NO-OP zonder `VITE_SENTRY_DSN`: lokaal, preview en CI sturen dus niets en
// laden Sentry niet eens als telemetrie-bron. Geen enkele functie hier mag ooit throwen
// (captureAppException wordt aangeroepen binnen de try van ErrorBoundary.logError).
//
// PRIVACY (HR-app met BSN/IBAN/e-mail/telefoon): geen session replay, geen tracing,
// `sendDefaultPii: false`, user-context = alleen id + organization_id. De scrub combineert:
//   1. querystring-stripping van élke URL (Supabase-fetch-breadcrumbs bevatten PII in
//      filters als `email.eq.` / `phone=`) — robuuster dan per-PII-regex op URLs;
//   2. één recursieve `deepScrub` die zowel sensitieve SLEUTELS redact als value-level
//      regex (BSN/IBAN/e-mail/telefoon) op élke string-waarde toepast — ook in extra,
//      contexts, breadcrumb.data en stacktrace-frame-variabelen, want PII komt net zo
//      vaak als wáárde voor als onder een sensitieve sleutel.
// Naam blijft een restrisico (niet betrouwbaar regex-baar); gemitigeerd door
// sendDefaultPii:false + geen replay + key-redactie van first_name/last_name/name-velden.
import * as Sentry from '@sentry/react';

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const ENABLED = Boolean(DSN);

const BSN_RE = /\b\d{9}\b/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){10,30}\b/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// NL telefoon (mobiel + vast), met +31/0-prefix en optionele scheidingstekens.
const PHONE_RE = /(?:\+31[\s-]?|0)[1-9](?:[\s-]?\d){8}\b/g;

const SENSITIVE_KEY_RE =
  /bsn|iban|password|token|secret|api[_-]?key|authorization|client[_-]?secret|refresh[_-]?token|access[_-]?token|e?mail|phone|telefoon|first_?name|last_?name|voornaam|achternaam|(^|_)naam($|_)|(^|_)name($|_)|address|adres|date_of_birth|geboortedatum/i;

const REDACTED = '[REDACTED]';

export const scrubText = <T>(value: T): T => {
  if (typeof value !== 'string') return value;
  return value
    .replace(EMAIL_RE, '[EMAIL]')
    .replace(IBAN_RE, '[IBAN]')
    .replace(PHONE_RE, '[TEL]')
    .replace(BSN_RE, '[BSN]') as unknown as T;
};

// Querystring weghalen: voor triage is het pad genoeg, de query is puur PII-risico.
export const stripQuery = (url: unknown): unknown => {
  if (typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url.split('?')[0];
  }
};

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

// Recursief: redact sensitieve sleutels, scrub PII in alle string-waarden, en laat
// niet-plain objecten (Date, class-instances) met rust zodat triage-context heel blijft.
// deno-lint-ignore no-explicit-any
export function deepScrub(value: any): any {
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map(deepScrub);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? REDACTED : deepScrub(v);
    }
    return out;
  }
  return value;
}

// deno-lint-ignore no-explicit-any
function scrubEvent(event: any) {
  try {
    if (event.message) event.message = scrubText(event.message);
    for (const ex of event.exception?.values ?? []) {
      if (ex.value) ex.value = scrubText(ex.value);
      for (const frame of ex.stacktrace?.frames ?? []) {
        if (frame.vars) frame.vars = deepScrub(frame.vars);
      }
    }
    if (event.request) {
      if (event.request.url) event.request.url = stripQuery(event.request.url);
      delete event.request.query_string; // querystring = puur PII-risico
      event.request = deepScrub(event.request);
    }
    if (event.extra) event.extra = deepScrub(event.extra);
    if (event.contexts) event.contexts = deepScrub(event.contexts);
  } catch {
    /* scrub mag de rapportage nooit breken */
  }
  return event;
}

// deno-lint-ignore no-explicit-any
function scrubBreadcrumb(crumb: any) {
  try {
    if (crumb.message) crumb.message = scrubText(crumb.message);
    if (crumb.data) {
      if (typeof crumb.data.url === 'string') crumb.data.url = stripQuery(crumb.data.url);
      crumb.data = deepScrub(crumb.data);
    }
  } catch {
    /* idem */
  }
  return crumb;
}

/** Init Sentry vóór render. No-op zonder DSN; throwt nooit. */
export function initSentry() {
  if (!ENABLED) return;
  try {
    Sentry.init({
      dsn: DSN,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_APP_RELEASE as string | undefined,
      sendDefaultPii: false,
      // Geen tracing/replay: scheelt PII-lek via supabase-URL-breadcrumbs en zware payloads.
      tracesSampleRate: 0,
      beforeSend: (event) => scrubEvent(event),
      beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
    });
  } catch {
    /* observability mag de app nooit breken */
  }
}

/**
 * Forward een fout naar Sentry. No-op zonder DSN en throwt nooit — veilig om aan te
 * roepen binnen de ErrorBoundary (de `client_errors`-insert blijft daar leidend).
 */
export function captureAppException(error: unknown, context?: Record<string, unknown>) {
  if (!ENABLED) return;
  try {
    Sentry.captureException(error, context ? { extra: deepScrub(context) } : undefined);
  } catch {
    /* nooit de bestaande foutafhandeling breken */
  }
}

/**
 * Zet de user-context op id + organization_id (NOOIT e-mail/naam). Aangeroepen vanuit
 * één mountpunt (AppLayout); `userId` leeg → context wissen (bv. na uitloggen).
 */
export function setObservabilityUser(userId?: string | null, organizationId?: string | null) {
  if (!ENABLED) return;
  try {
    if (userId) {
      Sentry.setUser({ id: userId });
      Sentry.setTag('organization_id', organizationId ?? 'unknown');
    } else {
      Sentry.setUser(null);
    }
  } catch {
    /* no-op */
  }
}
