import {
  buildAccountMatchQueries,
  ExactApiError,
  exactRetryDelayMs,
  normalizeVatPercentage,
  odataResults,
  odataString,
  sanitizeExactErrorDetail,
  selectVatCodeForRate,
  type ExactAccountMatchKeys,
  type ExactVatCodeRow,
} from "./exact-format.ts";

// De pure reken- en classificatieregels staan in exact-format.ts (Deno-vrij, zodat
// ze in vitest getest kunnen worden). Ze horen bij dezelfde publieke API, dus we
// exporteren ze hier door: bestaande imports uit exact-helpers blijven werken.
export * from "./exact-format.ts";

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
      // Connect kent deze tenant niet (meer). Apart van REAUTH_REQUIRED omdat
      // opnieuw autoriseren niet helpt: er moet een nieuwe tenant geregistreerd
      // worden. exact-register/-disconnect gebruiken dit om te herstellen.
      if (res.status === 404 || /tenant\s*not\s*found/i.test(String(data.error ?? ""))) {
        throw new Error("TENANT_NOT_FOUND");
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


const MAX_EXACT_API_ATTEMPTS = 4;

export async function exactApi<T = unknown>(
  token: ExactTokenResponse,
  path: string,
  init?: { method?: string; body?: unknown; query?: Record<string, string> },
): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const url = new URL(`${token.base_url}/api/v1/${token.division}/${path}`);
  if (init?.query) {
    for (const [key, value] of Object.entries(init.query)) {
      url.searchParams.set(key, value);
    }
  }

  for (let attempt = 1; ; attempt++) {
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
    if (res.ok) {
      if (!text) return undefined as T;
      return JSON.parse(text) as T;
    }

    // 429 = door Exact geweigerd, dus gegarandeerd niet uitgevoerd → altijd veilig
    // om te herhalen. Een 5xx is ambigu: bij een schrijvende call kan de boeking
    // tóch zijn aangemaakt, dus die herhalen we bewust NIET (dubbele factuur).
    const retryable = res.status === 429 || (method === "GET" && [500, 502, 503, 504].includes(res.status));
    if (retryable && attempt < MAX_EXACT_API_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, exactRetryDelayMs(res.headers, attempt)));
      continue;
    }

    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.error?.message?.value ?? parsed?.error?.message ?? text;
    } catch {
      // keep raw text
    }
    throw new ExactApiError({ method, path, status: res.status, detail });
  }
}


export async function listExactVatCodes(token: ExactTokenResponse): Promise<ExactVatCodeRow[]> {
  const response = await exactApi(token, "vat/VATCodes", {
    query: {
      $select: "ID,Code,Description,Percentage,Type,VATTransactionType,IsBlocked",
      $top: "500",
    },
  });
  return odataResults<ExactVatCodeRow>(response);
}

// ── Dagboek (Journal) ────────────────────────────────────────────────────────
/** Verkoopdagboek = Journal met Type 20. Geeft de Code terug (bv. "80"). */
export async function findSalesJournalCode(token: ExactTokenResponse): Promise<string | null> {
  const response = await exactApi(token, "financial/Journals", {
    query: { $select: "Code,Description,Type", $filter: "Type eq 20", $top: "50" },
  });
  const rows = odataResults<{ Code?: string }>(response);
  const codes = rows
    .map((row) => String(row.Code ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return codes[0] ?? null;
}

// ── Artikel (Item) ───────────────────────────────────────────────────────────
/**
 * Exact vereist een Item op een verkoopfactuurregel. Wij factureren uren, geen
 * artikelen, dus zoeken we één generiek dienstartikel op (en maken het alleen aan
 * als het écht niet bestaat). Faalt dit, dan geven we null terug en laat de
 * sync het veld weg — dan bepaalt Exact zelf of dat acceptabel is.
 */
export async function findOrCreateGenericItem(token: ExactTokenResponse): Promise<string | null> {
  const findByCode = async (code: string) => {
    const response = await exactApi(token, "logistics/Items", {
      query: { $select: "ID,Code", $filter: `Code eq '${odataString(code)}'`, $top: "1" },
    });
    return odataResults<{ ID?: string }>(response)[0]?.ID ?? null;
  };

  try {
    const existing = await findByCode("DIVERSEN");
    if (existing) return existing;

    const anySalesItem = await exactApi(token, "logistics/Items", {
      query: { $select: "ID,Code", $filter: "IsSalesItem eq true", $top: "1" },
    });
    const fallback = odataResults<{ ID?: string }>(anySalesItem)[0]?.ID;
    if (fallback) return fallback;

    const created = await exactApi<{ d?: { ID?: string } }>(token, "logistics/Items", {
      method: "POST",
      body: { Code: "DIVERSEN", Description: "Diversen", IsSalesItem: true },
    });
    return created?.d?.ID ?? null;
  } catch (err) {
    console.warn("Exact: generiek artikel niet beschikbaar:", sanitizeExactErrorDetail(err));
    return null;
  }
}


/**
 * Zoekt een bestaande relatie in Exact. Accepteert alleen een **eenduidige**
 * treffer: bij meerdere hits op dezelfde sleutel weten we niet welke bedoeld is
 * en gaan we door naar de volgende (of laten we de beller een nieuwe aanmaken).
 */
export async function findExactAccountId(
  token: ExactTokenResponse,
  keys: ExactAccountMatchKeys,
): Promise<{ id: string; matchedOn: string } | null> {
  for (const { key, filter } of buildAccountMatchQueries(keys)) {
    try {
      const response = await exactApi(token, "crm/Accounts", {
        query: { $select: "ID,Name", $filter: filter, $top: "2" },
      });
      const rows = odataResults<{ ID?: string }>(response);
      if (rows.length === 1 && rows[0].ID) {
        return { id: rows[0].ID, matchedOn: key };
      }
    } catch (err) {
      // Een onbruikbare sleutel (bv. veld niet gevuld in deze administratie) mag
      // de hele sync niet blokkeren — probeer gewoon de volgende.
      console.warn(`Exact account-zoekactie op ${key} mislukt:`, sanitizeExactErrorDetail(err));
    }
  }
  return null;
}

// ── Administratie-defaults (journal / omzet-GL / artikel / BTW) ──────────────
export type ExactDefaults = {
  journal: string | null;
  glAccountId: string | null;
  itemId: string | null;
  vatCodes: Record<string, string>;
};

/**
 * Vult ontbrekende administratie-defaults aan en slaat ze op, zodat een volgende
 * sync ze niet opnieuw hoeft te ontdekken. Elk onderdeel is best-effort: wat niet
 * gevonden wordt blijft leeg en wordt door de sync weggelaten.
 */
export async function ensureExactDefaults(
  serviceClient: any,
  organizationId: string,
  token: ExactTokenResponse,
  stored: {
    default_journal?: string | null;
    default_glaccount_id?: string | null;
    default_item_id?: string | null;
    default_vat_codes?: Record<string, string> | null;
  },
  options: { vatRates?: Array<number | string> } = {},
): Promise<ExactDefaults> {
  const defaults: ExactDefaults = {
    journal: stored.default_journal ?? null,
    glAccountId: stored.default_glaccount_id ?? null,
    itemId: stored.default_item_id ?? null,
    vatCodes: { ...(stored.default_vat_codes ?? {}) },
  };

  const updates: Record<string, unknown> = {};

  if (!defaults.journal) {
    try {
      defaults.journal = await findSalesJournalCode(token);
      if (defaults.journal) updates.default_journal = defaults.journal;
    } catch (err) {
      console.warn("Exact: verkoopdagboek niet gevonden:", sanitizeExactErrorDetail(err));
    }
  }

  if (!defaults.glAccountId) {
    try {
      const candidates = await listGLAccountCandidates(token, [110], "8");
      defaults.glAccountId = candidates[0]?.ID ?? null;
      if (defaults.glAccountId) updates.default_glaccount_id = defaults.glAccountId;
    } catch (err) {
      console.warn("Exact: omzetrekening niet gevonden:", sanitizeExactErrorDetail(err));
    }
  }

  if (!defaults.itemId) {
    defaults.itemId = await findOrCreateGenericItem(token);
    if (defaults.itemId) updates.default_item_id = defaults.itemId;
  }

  const wantedRates = (options.vatRates ?? [])
    .map((rate) => normalizeVatPercentage(rate))
    .filter((rate): rate is number => rate !== null)
    .map((rate) => String(rate));
  const missingRates = wantedRates.filter((rate) => !defaults.vatCodes[rate]);

  if (missingRates.length > 0) {
    try {
      const vatRows = await listExactVatCodes(token);
      for (const rate of missingRates) {
        const code = selectVatCodeForRate(vatRows, rate);
        if (code) defaults.vatCodes[rate] = code;
      }
      updates.default_vat_codes = defaults.vatCodes;
    } catch (err) {
      console.warn("Exact: BTW-codes niet gevonden:", sanitizeExactErrorDetail(err));
    }
  }

  if (Object.keys(updates).length > 0) {
    updates.defaults_discovered_at = new Date().toISOString();
    const { error } = await serviceClient
      .from("exact_config")
      .update(updates)
      .eq("organization_id", organizationId);
    if (error) console.warn("Exact: defaults opslaan mislukt:", error.message);
  }

  return defaults;
}

// ── Sync-audittrail ──────────────────────────────────────────────────────────
export type ExactSyncLogEntry = {
  organizationId: string;
  direction: "outbound" | "inbound";
  entityType: string;
  entityId?: string | null;
  operation: string;
  status: "success" | "failed" | "skipped";
  exactId?: string | null;
  httpStatus?: number | null;
  errorDetail?: string | null;
  durationMs?: number | null;
  payload?: Record<string, unknown> | null;
};

/** Logt een sync-actie. Faalt stil: een kapotte logregel mag nooit een sync breken. */
export async function logExactSync(serviceClient: any, entry: ExactSyncLogEntry): Promise<void> {
  try {
    await serviceClient.from("exact_sync_log").insert({
      organization_id: entry.organizationId,
      direction: entry.direction,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      operation: entry.operation,
      status: entry.status,
      exact_id: entry.exactId ?? null,
      http_status: entry.httpStatus ?? null,
      error_detail: entry.errorDetail ? sanitizeExactErrorDetail(entry.errorDetail) : null,
      duration_ms: entry.durationMs ?? null,
      payload: entry.payload ?? null,
    });
  } catch (err) {
    console.warn("Exact sync-log schrijven mislukt:", (err as Error).message);
  }
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
