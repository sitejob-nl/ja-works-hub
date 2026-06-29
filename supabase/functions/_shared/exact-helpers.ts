export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

export interface ExactTokenResponse {
  access_token: string;
  division: number;
  region: string;
  base_url: string;
  expires_at: string;
}

export type ExactProviderErrorKind =
  | "division_scope_error"
  | "needs_reauth"
  | "provider_forbidden"
  | "provider_unavailable"
  | "unknown_provider_error";

export type ExactProviderErrorClassification = {
  kind: ExactProviderErrorKind;
  publicCode:
    | "exact_division_scope_error"
    | "needs_reauth"
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

export type ExactWebhookConfig = {
  id: string;
  organization_id: string;
  tenant_id: string | null;
  webhook_secret: string | null;
  is_active: boolean;
};

export type VerifiedExactWebhookConfig = {
  config: ExactWebhookConfig;
  webhookSecret: string;
};

export function getExactConnectUrl(path: "exact-register-tenant" | "exact-token" | "exact-webhook-router"): string {
  const baseUrl = Deno.env.get("SITEJOB_CONNECT_FUNCTIONS_URL")
    ?? Deno.env.get("CONNECT_FUNCTIONS_URL")
    ?? "https://xeshjkznwdrxjjhbpisn.supabase.co/functions/v1";
  return `${baseUrl.replace(/\/$/, "")}/${path}`;
}

export function getExactWebhookCallbackUrl(): string {
  return Deno.env.get("EXACT_WEBHOOK_CALLBACK_URL")
    ?? Deno.env.get("CONNECT_EXACT_WEBHOOK_ROUTER_URL")
    ?? getExactConnectUrl("exact-webhook-router");
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

function organizationIdFromRequest(req: Request): string | null {
  const url = new URL(req.url);
  return url.searchParams.get("organization_id") || url.searchParams.get("org");
}

async function storedWebhookSecretMatches(
  serviceClient: any,
  config: ExactWebhookConfig,
  incomingSecret: string,
): Promise<string | null> {
  if (!config.webhook_secret) return null;

  const { data: decrypted, error: decryptError } = await serviceClient.rpc("decrypt_sensitive", {
    ciphertext: config.webhook_secret,
  });

  if (!decryptError && decrypted === incomingSecret) {
    return decrypted;
  }

  // Legacy repair: older Exact registration stored webhook_secret plaintext.
  if (config.webhook_secret === incomingSecret) {
    const { data: encrypted, error: encryptError } = await serviceClient.rpc("encrypt_sensitive", {
      plaintext: incomingSecret,
    });
    if (!encryptError && encrypted) {
      await serviceClient
        .from("exact_config")
        .update({ webhook_secret: encrypted, updated_at: new Date().toISOString() })
        .eq("id", config.id);
    }
    return incomingSecret;
  }

  return null;
}

export async function verifyExactWebhookSecret(
  req: Request,
  serviceClient: any,
  opts: { requireActive?: boolean } = {},
): Promise<VerifiedExactWebhookConfig | null> {
  const incomingSecret = req.headers.get("X-Webhook-Secret") ?? req.headers.get("x-webhook-secret");
  if (!incomingSecret) return null;

  const organizationId = organizationIdFromRequest(req);
  if (organizationId) {
    let query = serviceClient
      .from("exact_config")
      .select("id, organization_id, tenant_id, webhook_secret, is_active")
      .eq("organization_id", organizationId);
    if (opts.requireActive) query = query.eq("is_active", true);

    const { data: config, error } = await query.maybeSingle();
    if (error || !config) return null;

    const webhookSecret = await storedWebhookSecretMatches(serviceClient, config as ExactWebhookConfig, incomingSecret);
    return webhookSecret ? { config: config as ExactWebhookConfig, webhookSecret } : null;
  }

  // Backward-compatible fallback for old Connect tenants that were registered
  // before webhook_url included organization_id.
  let query = serviceClient
    .from("exact_config")
    .select("id, organization_id, tenant_id, webhook_secret, is_active");
  if (opts.requireActive) query = query.eq("is_active", true);

  const { data: configs } = await query;
  for (const config of (configs ?? []) as ExactWebhookConfig[]) {
    const webhookSecret = await storedWebhookSecretMatches(serviceClient, config, incomingSecret);
    if (webhookSecret) return { config, webhookSecret };
  }

  return null;
}

/**
 * Get a fresh Exact Online access token via SiteJob Connect.
 * Tokens expire after 10 minutes — always call this before each API request.
 */
const tokenCache = new Map<string, ExactTokenResponse>();

export async function getExactToken(tenantId: string, webhookSecret: string): Promise<ExactTokenResponse> {
  const cacheKey = `${tenantId}:${webhookSecret}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && new Date(cached.expires_at).getTime() - Date.now() > 60_000) {
    return cached;
  }

  // SiteJob Connect serialiseert de token-refresh van Exact. Bij een gelijktijdige
  // refresh antwoordt exact-token met HTTP 503 ("busy"). Poll dan 1s en retry
  // (max ~10s) i.p.v. de Exact-call te laten falen — anders krijg je intermitterende
  // sync-fouten zodra twee calls tegelijk een refresh triggeren.
  const MAX_ATTEMPTS = 10;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(getExactConnectUrl("exact-token"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": webhookSecret,
      },
      body: JSON.stringify({ tenant_id: tenantId, secret: webhookSecret, webhook_secret: webhookSecret }),
    });

    if (res.status === 503 && attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.needs_reauth) {
        throw new Error("REAUTH_REQUIRED");
      }
      throw new Error(data.error || (res.status === 503 ? "Connect bleef bezig (503)" : "Token ophalen mislukt"));
    }
    tokenCache.set(cacheKey, data as ExactTokenResponse);
    return data as ExactTokenResponse;
  }
  throw new Error("Token ophalen mislukt: Connect bleef bezig (503)");
}

export function clearExactTokenCache(tenantId: string, webhookSecret: string): void {
  tokenCache.delete(`${tenantId}:${webhookSecret}`);
}

export type GLAccountRow = {
  ID: string;
  Code: string;
  Description?: string | null;
  Type?: number | string | null;
  IsBlocked?: boolean | null;
};

async function exactApi<T = unknown>(
  token: ExactTokenResponse,
  path: string,
  init?: { method?: string; body?: unknown; query?: Record<string, string> },
): Promise<T> {
  const method = init?.method ?? "GET";
  const url = new URL(`${token.base_url}/api/v1/${token.division}/${path}`);
  if (init?.query) {
    for (const [key, value] of Object.entries(init.query)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.error?.message?.value ?? parsed?.error?.message ?? text;
    } catch {
      // keep raw text
    }
    throw new ExactApiError({ method, path, status: res.status, detail });
  }

  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export async function listGLAccountCandidates(
  token: ExactTokenResponse,
  preferredTypes: number[],
  codePrefix: string,
): Promise<GLAccountRow[]> {
  type GLResp = { d?: { results?: GLAccountRow[] } | GLAccountRow[] };
  const response = await exactApi<GLResp>(token, "financial/GLAccounts", {
    query: { $select: "ID,Code,Description,Type,IsBlocked", $top: "1000" },
  });
  const rows = Array.isArray(response.d) ? response.d : (response.d?.results ?? []);
  const active = rows.filter((account) => account.IsBlocked !== true);
  const sortByCode = (a: GLAccountRow, b: GLAccountRow) =>
    (a.Code ?? "").trim().localeCompare((b.Code ?? "").trim());

  const candidates: GLAccountRow[] = [];
  const seen = new Set<string>();
  const push = (account: GLAccountRow) => {
    if (!account.ID || seen.has(account.ID)) return;
    seen.add(account.ID);
    candidates.push(account);
  };

  for (const type of preferredTypes) {
    active
      .filter((account) => Number(account.Type) === type)
      .sort(sortByCode)
      .forEach(push);
  }

  active
    .filter((account) => (account.Code ?? "").trim().startsWith(codePrefix))
    .sort(sortByCode)
    .forEach(push);

  return candidates;
}

/** Register webhook subscriptions in Exact Online for the topics JA Werkt syncs back. */
export async function registerExactWebhookSubscriptions(
  baseUrl: string,
  division: number,
  accessToken: string,
) {
  const topics = ["SalesInvoices", "Accounts"];
  const callbackUrl = getExactWebhookCallbackUrl();
  const results: Array<{ topic: string; ok: boolean; status: number; body?: string }> = [];

  for (const topic of topics) {
    try {
      const existingUrl = new URL(`${baseUrl}/api/v1/${division}/webhooks/WebhookSubscriptions`);
      existingUrl.searchParams.set("$select", "ID,Topic,CallbackURL");
      existingUrl.searchParams.set("$filter", `Topic eq '${topic}'`);
      existingUrl.searchParams.set("$top", "100");
      const existingRes = await fetch(existingUrl.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
      if (existingRes.ok) {
        const existingData = await existingRes.json().catch(() => ({}));
        const existingRows = Array.isArray(existingData?.d)
          ? existingData.d
          : (existingData?.d?.results ?? []);
        const alreadyRegistered = existingRows.some((row: { Topic?: string; CallbackURL?: string }) =>
          row.Topic === topic && row.CallbackURL === callbackUrl
        );
        if (alreadyRegistered) {
          results.push({ topic, ok: true, status: 200, body: "already_registered" });
          continue;
        }
      }

      const res = await fetch(
        `${baseUrl}/api/v1/${division}/webhooks/WebhookSubscriptions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            CallbackURL: callbackUrl,
            Topic: topic,
          }),
        }
      );

      results.push({
        topic,
        ok: res.ok || res.status === 409,
        status: res.status,
        body: res.ok ? undefined : sanitizeExactErrorDetail(await res.text()),
      });
    } catch (err) {
      results.push({ topic, ok: false, status: 0, body: sanitizeExactErrorDetail(err) });
    }
  }

  return { callback_url: callbackUrl, results };
}

/** Standard JSON error response with CORS */
export function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ error: message, ...extra }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/** Standard JSON success response with CORS */
export function jsonOk(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(data),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
