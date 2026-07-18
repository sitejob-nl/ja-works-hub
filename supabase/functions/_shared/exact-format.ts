// Pure helpers voor de Exact Online-koppeling: formatteren, classificeren en
// selecteren. Bewust vrij van Deno- en fetch-afhankelijkheden zodat deze regels
// ook vanuit de frontend-testsuite (vitest) uitgevoerd kunnen worden.

export type ExactProviderErrorKind =
  | "division_scope_error"
  | "needs_reauth"
  | "tenant_not_found"
  | "provider_forbidden"
  | "provider_unavailable"
  | "unknown_provider_error";

export type ExactProviderErrorClassification = {
  kind: ExactProviderErrorKind;
  publicCode:
    | "exact_division_scope_error"
    | "needs_reauth"
    | "exact_tenant_not_found"
    | "exact_provider_forbidden"
    | "exact_provider_unavailable"
    | "exact_provider_error";
  httpStatus: number;
  providerStatus: number | null;
  detail: string;
};

export class ExactApiError extends Error {
  method: string;
  path: string;
  status: number;
  detail: string;

  constructor(args: { method: string; path: string; status: number; detail: string }) {
    super(`Exact ${args.method} ${args.path} -> ${args.status}: ${args.detail}`);
    this.name = "ExactApiError";
    this.method = args.method;
    this.path = args.path;
    this.status = args.status;
    this.detail = args.detail;
  }
}

export function sanitizeExactErrorDetail(raw: unknown, maxLength = 500): string {
  const value = raw instanceof Error ? raw.message : String(raw ?? "onbekende fout");
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/access[_-]?token["':=\s]+[A-Za-z0-9._~+/=-]+/gi, "access_token=[redacted]")
    .replace(/refresh[_-]?token["':=\s]+[A-Za-z0-9._~+/=-]+/gi, "refresh_token=[redacted]")
    .slice(0, maxLength);
}

function providerStatusFromMessage(message: string): number | null {
  const match = /(?:->|failed\s*\()\s*(\d{3})/i.exec(message);
  if (!match?.[1]) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

export function classifyExactProviderError(error: unknown): ExactProviderErrorClassification {
  const message = sanitizeExactErrorDetail(error);
  const status = error instanceof ExactApiError
    ? error.status
    : providerStatusFromMessage(message);
  const normalized = message.toLowerCase();

  // Volgorde is belangrijk: een verdwenen tenant is géén reauth-geval. Opnieuw
  // autoriseren bij Exact lost niets op wanneer SiteJob Connect de registratie
  // zelf niet meer kent — er moet dan een nieuwe tenant geregistreerd worden.
  if (
    normalized.includes("tenant_not_found") ||
    normalized.includes("tenant not found")
  ) {
    return {
      kind: "tenant_not_found",
      publicCode: "exact_tenant_not_found",
      httpStatus: 409,
      providerStatus: status ?? 404,
      detail: message,
    };
  }

  if (
    normalized.includes("exact_needs_reauth") ||
    normalized.includes("reauth_required") ||
    normalized.includes("needs_reauth")
  ) {
    return {
      kind: "needs_reauth",
      publicCode: "needs_reauth",
      httpStatus: 409,
      providerStatus: status,
      detail: message,
    };
  }

  if (
    normalized.includes("user division is not within division scope") ||
    normalized.includes("wrongdivision") ||
    normalized.includes("division is not within division scope")
  ) {
    return {
      kind: "division_scope_error",
      publicCode: "exact_division_scope_error",
      httpStatus: 409,
      providerStatus: status ?? 403,
      detail: message,
    };
  }

  if (status === 401 || status === 403) {
    return {
      kind: "provider_forbidden",
      publicCode: "exact_provider_forbidden",
      httpStatus: 502,
      providerStatus: status,
      detail: message,
    };
  }

  if (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    normalized.includes("etimedout") ||
    normalized.includes("econnreset") ||
    normalized.includes("rate limit")
  ) {
    return {
      kind: "provider_unavailable",
      publicCode: "exact_provider_unavailable",
      httpStatus: 502,
      providerStatus: status,
      detail: message,
    };
  }

  return {
    kind: "unknown_provider_error",
    publicCode: "exact_provider_error",
    httpStatus: 502,
    providerStatus: status,
    detail: message,
  };
}

/**
 * Wacht-tijd vóór een retry. Exact hanteert 60 calls/minuut en 5.000/dag per app
 * per administratie en geeft dat terug via X-RateLimit-(Minutely-)Reset. Een
 * `Retry-After` bij 429 is niet officieel gedocumenteerd, dus die lezen we alleen
 * op wanneer hij er toevallig staat; verder vallen we terug op exponentieel.
 */
export function exactRetryDelayMs(headers: Headers, attempt: number, now = Date.now()): number {
  const retryAfter = Number(headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 30_000);
  }

  const resetRaw = headers.get("x-ratelimit-minutely-reset") ?? headers.get("x-ratelimit-reset");
  const reset = Number(resetRaw);
  if (Number.isFinite(reset) && reset > 0) {
    // Exact zet hier een epoch in milliseconden. Alleen gebruiken als de waarde
    // in de nabije toekomst ligt — anders is het formaat kennelijk anders en
    // vertrouwen we op de exponentiële fallback.
    const wait = reset - now;
    if (wait > 0 && wait <= 60_000) return wait + 250;
  }

  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

/** Pakt een OData v3-collectie uit: `{ d: { results: [...] } }` of `{ d: [...] }`. */
export function odataResults<T = Record<string, unknown>>(response: unknown): T[] {
  const d = (response as { d?: unknown })?.d;
  if (!d) return [];
  if (Array.isArray(d)) return d as T[];
  const results = (d as { results?: unknown }).results;
  return Array.isArray(results) ? (results as T[]) : [];
}

/** Escapet een string voor gebruik in een OData `$filter`-literal. */
export function odataString(value: unknown): string {
  return String(value ?? "").replace(/'/g, "''");
}

/**
 * Exact weigert het `/Date(…)/`-formaat als invoer; datums moeten als ISO zonder
 * tijdzone worden aangeleverd. Een `date`-kolom uit Postgres komt als
 * "2026-07-18" binnen, een timestamp als volledige ISO-string.
 */
export function toExactDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : `${value.toISOString().slice(0, 10)}T00:00:00`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  return match ? `${match[1]}T00:00:00` : null;
}

/** Leest Exact's `/Date(1234567890000)/`-notatie uit een respons. */
export function parseExactDate(value: unknown): Date | null {
  if (!value) return null;
  const match = /\/Date\((-?\d+)/.exec(String(value));
  if (match) {
    const date = new Date(Number(match[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// ── Verkoopfactuur-type ──────────────────────────────────────────────────────
export const EXACT_SALES_INVOICE_TYPE = 8020;
export const EXACT_SALES_CREDIT_NOTE_TYPE = 8021;

/** Een negatief factuurtotaal is in Exact een creditnota (Type 8021). */
export function exactSalesInvoiceType(total: unknown): number {
  const amount = Number(total);
  return Number.isFinite(amount) && amount < 0 ? EXACT_SALES_CREDIT_NOTE_TYPE : EXACT_SALES_INVOICE_TYPE;
}

// ── BTW-codes ────────────────────────────────────────────────────────────────
export type ExactVatCodeRow = {
  ID?: string;
  Code: string;
  Description?: string | null;
  Percentage?: number | string | null;
  Type?: string | null;
  VATTransactionType?: string | null;
  IsBlocked?: boolean | null;
};

/** Exact levert percentages soms als fractie (0.21) en soms als geheel (21). */
export function normalizeVatPercentage(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(num) || num < 0) return null;
  return num > 0 && num <= 1 ? num * 100 : num;
}

/**
 * Kiest de BTW-code die hoort bij een percentage. Bewust conservatief:
 * inkoop-only codes vallen af, en "verlegd"/intracommunautair scoort lager omdat
 * die alleen bewust gekozen horen te worden — niet als toevallige 0%-match.
 *
 * Geeft de Code **ongewijzigd** terug: Exact gebruikt vaste breedte met
 * spatie-padding ("6  ") en die padding hoort behouden te blijven.
 */
export function selectVatCodeForRate(rows: ExactVatCodeRow[], rate: unknown): string | null {
  const target = normalizeVatPercentage(rate);
  if (target === null) return null;

  const scored = (rows ?? [])
    .filter((row) => row?.Code && row.IsBlocked !== true)
    .filter((row) => {
      const pct = normalizeVatPercentage(row.Percentage);
      return pct !== null && Math.abs(pct - target) < 0.01;
    })
    .filter((row) => String(row.VATTransactionType ?? "").toUpperCase() !== "P")
    .map((row) => {
      const transactionType = String(row.VATTransactionType ?? "").toUpperCase();
      const type = String(row.Type ?? "").toUpperCase();
      const description = String(row.Description ?? "").toLowerCase();

      let score = 0;
      if (transactionType === "S") score += 3;
      else if (transactionType === "B") score += 2;
      else score += 1;

      // Onze regelprijzen zijn exclusief BTW → "Excluding" past het beste.
      if (type === "E") score += 2;
      if (target === 0 && (type === "B" || type === "N")) score += 1;

      if (description.includes("verleg")) score -= 3;
      if (description.includes("intracommunautair") || description.includes("eu ")) score -= 2;

      return { row, score };
    })
    .sort((a, b) => b.score - a.score || String(a.row.Code).localeCompare(String(b.row.Code)));

  return scored[0]?.row.Code ?? null;
}

// ── Relatie (Account) opzoeken ───────────────────────────────────────────────
export type ExactAccountMatchKeys = {
  kvkNumber?: string | null;
  vatNumber?: string | null;
  email?: string | null;
  name?: string | null;
};

/**
 * Zoeksleutels in volgorde van betrouwbaarheid. Naam staat bewust achteraan:
 * "JA Werkt B.V." en "JA Werkt BV" zijn dezelfde relatie maar matchen niet op
 * naam, terwijl KvK- en BTW-nummer wél uniek zijn.
 */
export function buildAccountMatchQueries(keys: ExactAccountMatchKeys): Array<{ key: string; filter: string }> {
  const queries: Array<{ key: string; filter: string }> = [];
  const clean = (value: unknown) => String(value ?? "").trim();

  const kvk = clean(keys.kvkNumber);
  if (kvk) queries.push({ key: "kvk", filter: `ChamberOfCommerce eq '${odataString(kvk)}'` });

  const vat = clean(keys.vatNumber).replace(/\s/g, "");
  if (vat) queries.push({ key: "btw", filter: `VATNumber eq '${odataString(vat)}'` });

  const email = clean(keys.email);
  if (email) queries.push({ key: "email", filter: `Email eq '${odataString(email)}'` });

  const name = clean(keys.name);
  if (name) queries.push({ key: "naam", filter: `Name eq '${odataString(name)}'` });

  return queries;
}
