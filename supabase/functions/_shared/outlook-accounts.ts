import { createAdminClient } from "./auth.ts";

export const OUTLOOK_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.ReadWrite",
  "Mail.ReadWrite.Shared",
  "Mail.Send",
  "Mail.Send.Shared",
  "Calendars.ReadWrite",
  "Calendars.ReadWrite.Shared",
].join(" ");

export const OUTLOOK_ADMIN_CONSENT_SCOPES = [
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.ReadWrite.Shared",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/Mail.Send.Shared",
  "https://graph.microsoft.com/Calendars.ReadWrite",
  "https://graph.microsoft.com/Calendars.ReadWrite.Shared",
].join(" ");

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

type AdminClient = ReturnType<typeof createAdminClient>;

export type OutlookCapability = "mail_read" | "mail_send" | "mail_delete" | "calendar_read" | "calendar_write" | "any" | "none";

export type MailAccountRow = {
  id: string;
  organization_id: string;
  provider: string;
  scope: "organization" | "personal";
  owner_user_id: string | null;
  auth_account_id: string | null;
  display_name: string | null;
  from_email: string | null;
  reply_to_email: string | null;
  mailbox_mode: "user" | "shared";
  mailbox_email: string | null;
  mailbox_name: string | null;
  calendar_path_kind: "mailbox_primary" | "graph_calendar_id";
  calendar_owner_email: string | null;
  calendar_id: string | null;
  mail_read_enabled: boolean | null;
  mail_send_enabled: boolean | null;
  mail_delete_enabled: boolean | null;
  calendar_read_enabled: boolean | null;
  calendar_write_enabled: boolean | null;
  is_default_for_organization: boolean | null;
  is_default_for_user: boolean | null;
  status: string | null;
  last_error: string | null;
  last_connected_at: string | null;
  refreshing_at: string | null;
  signature_enabled?: boolean | null;
  signature_html?: string | null;
  signature_json?: unknown | null;
  deleted_at: string | null;
};

type AccessGrant = {
  mail_account_id: string;
  user_id: string;
  can_read_mail: boolean | null;
  can_send_mail: boolean | null;
  can_delete_mail: boolean | null;
  can_read_calendar: boolean | null;
  can_write_calendar: boolean | null;
};

type SecretEnvelope = {
  kind?: string;
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: string | null;
  scope?: string | null;
  token_type?: string | null;
  microsoft_user_id?: string | null;
  microsoft_tenant_id?: string | null;
  microsoft_email?: string | null;
};

export type TokenConfig = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  scope: string;
  token_type?: string | null;
};

export type OutlookProvider = {
  account: MailAccountRow;
  credential: MailAccountRow;
  token: TokenConfig;
};

export type OutlookAccountOption = {
  id: string;
  account_id: string;
  credential_account_id: string | null;
  scope: "organization" | "personal";
  mode: "user" | "shared";
  label: string;
  email: string | null;
  name: string | null;
  status: string;
  status_reason: string | null;
  microsoft_access_ok: boolean;
  is_default_for_organization: boolean;
  is_default_for_user: boolean;
  signature_enabled: boolean;
  signature_html: string | null;
  signature_json: unknown | null;
  reply_to_email: string | null;
  capabilities: {
    mail_read: boolean;
    mail_send: boolean;
    mail_delete: boolean;
    calendar_read: boolean;
    calendar_write: boolean;
  };
  ja_grants: {
    mail_read: boolean;
    mail_send: boolean;
    mail_delete: boolean;
    calendar_read: boolean;
    calendar_write: boolean;
  };
};

export class OutlookError extends Error {
  status: number;
  code: string;
  retryAfter?: number;

  constructor(code: string, status = 400, message = code, retryAfter?: number) {
    super(message);
    this.name = "OutlookError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function isConsentError(message: string | null | undefined): boolean {
  return /AADSTS65001|AADSTS65004|consent_required|not consented|has not consented/i.test(String(message ?? ""));
}

export function consentRequiredMessage(): string {
  return "Microsoft admin consent ontbreekt voor SiteJob Uitzend HUB. Geef als tenant-admin toestemming en koppel daarna het hoofdaccount opnieuw.";
}

export function json(body: unknown, status = 200, corsHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function graphUrl(path: string, params?: Record<string, string | number | boolean | undefined | null>): URL {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${GRAPH_BASE}${normalized}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

export function cleanEmail(input: unknown): string | null {
  const value = String(input ?? "").trim().toLowerCase();
  const hasUnsafeChar = [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 31 || code === 127 || /\s|[<>]/.test(char);
  });
  if (!value || hasUnsafeChar) return null;
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(value)) return null;
  return value;
}

// Graph `replyTo`-recipients uit het reply_to_email van het mailaccount (EM1). Gevalideerd via
// cleanEmail; leeg → [] (geen replyTo-header). Hiermee landen antwoorden op het ingestelde adres
// (bv. info@) i.p.v. de verzendende mailbox.
export function buildReplyTo(account: MailAccountRow): Array<{ emailAddress: { address: string } }> {
  const address = cleanEmail(account.reply_to_email);
  return address ? [{ emailAddress: { address } }] : [];
}

function accountName(account: MailAccountRow): string | null {
  if (account.mailbox_mode === "shared") return account.mailbox_name || account.display_name || account.mailbox_email;
  return account.display_name || account.from_email;
}

function accountEmail(account: MailAccountRow): string | null {
  if (account.mailbox_mode === "shared") return account.mailbox_email;
  return account.from_email;
}

function accountLabel(account: MailAccountRow): string {
  if (account.scope === "personal") return "Mijn mailbox";
  if (account.mailbox_mode === "shared") return "Gedeelde mailbox";
  return "Bedrijfsmail";
}

function accountHasCapability(account: MailAccountRow, capability: OutlookCapability): boolean {
  if (capability === "none") return true;
  if (capability === "mail_read") return Boolean(account.mail_read_enabled);
  if (capability === "mail_send") return Boolean(account.mail_send_enabled);
  if (capability === "mail_delete") return Boolean(account.mail_delete_enabled);
  if (capability === "calendar_read") return Boolean(account.calendar_read_enabled);
  if (capability === "calendar_write") return Boolean(account.calendar_write_enabled);
  return Boolean(
    account.mail_read_enabled ||
      account.mail_send_enabled ||
      account.mail_delete_enabled ||
      account.calendar_read_enabled ||
      account.calendar_write_enabled,
  );
}

function grantAllows(grant: AccessGrant | null, capability: OutlookCapability): boolean {
  if (capability === "none") return true;
  if (!grant) return false;
  if (capability === "mail_read") return Boolean(grant.can_read_mail);
  if (capability === "mail_send") return Boolean(grant.can_send_mail);
  if (capability === "mail_delete") return Boolean(grant.can_delete_mail);
  if (capability === "calendar_read") return Boolean(grant.can_read_calendar);
  if (capability === "calendar_write") return Boolean(grant.can_write_calendar);
  return Boolean(
    grant.can_read_mail ||
      grant.can_send_mail ||
      grant.can_delete_mail ||
      grant.can_read_calendar ||
      grant.can_write_calendar,
  );
}

// JA-rechten per mailbox. De expliciete grants in `mail_account_user_access` zijn leidend: de
// admin-rol geeft géén impliciet lees-/verzendrecht op bedrijfsmailboxen (admins beheren de
// koppelingen en de rechten-matrix, maar hebben net als iedereen een eigen vinkje nodig).
// Alleen de eigenaar van een persoonlijke koppeling heeft altijd toegang tot die mailbox.
function grantOption(grant: AccessGrant | null, account: MailAccountRow, userId: string, _role?: string | null): OutlookAccountOption["ja_grants"] {
  const personalOwner = account.scope === "personal" && account.owner_user_id === userId;
  return {
    mail_read: personalOwner ? true : Boolean(grant?.can_read_mail),
    mail_send: personalOwner ? true : Boolean(grant?.can_send_mail),
    mail_delete: personalOwner ? Boolean(account.mail_delete_enabled) : Boolean(grant?.can_delete_mail),
    calendar_read: personalOwner ? true : Boolean(grant?.can_read_calendar),
    calendar_write: personalOwner ? true : Boolean(grant?.can_write_calendar),
  };
}

export function toAccountOption(account: MailAccountRow, grant: AccessGrant | null, userId: string, role?: string | null): OutlookAccountOption {
  const ja = grantOption(grant, account, userId, role);
  return {
    id: account.id,
    account_id: account.id,
    credential_account_id: account.auth_account_id,
    scope: account.scope,
    mode: account.mailbox_mode,
    label: accountLabel(account),
    email: accountEmail(account),
    name: accountName(account),
    status: account.status || "draft",
    status_reason: account.last_error,
    microsoft_access_ok: account.status === "connected",
    is_default_for_organization: Boolean(account.is_default_for_organization),
    is_default_for_user: Boolean(account.is_default_for_user),
    signature_enabled: account.signature_enabled !== false,
    signature_html: account.signature_html ?? null,
    signature_json: account.signature_json ?? null,
    reply_to_email: account.reply_to_email ?? null,
    capabilities: {
      mail_read: Boolean(account.mail_read_enabled),
      mail_send: Boolean(account.mail_send_enabled),
      mail_delete: Boolean(account.mail_delete_enabled),
      calendar_read: Boolean(account.calendar_read_enabled),
      calendar_write: Boolean(account.calendar_write_enabled),
    },
    ja_grants: ja,
  };
}

export async function listVisibleAccounts(
  admin: AdminClient,
  organizationId: string,
  userId: string,
  capability: OutlookCapability = "any",
  role?: string | null,
): Promise<OutlookAccountOption[]> {
  const { data: accountsRaw, error } = await admin
    .from("mail_accounts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("provider", "outlook")
    .is("deleted_at", null)
    .order("scope", { ascending: false })
    .order("display_name");
  if (error) throw error;

  const accounts = (accountsRaw ?? []) as MailAccountRow[];
  const { data: grantsRaw, error: grantsError } = await admin
    .from("mail_account_user_access")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (grantsError) throw grantsError;

  const grants = new Map((grantsRaw ?? []).map((g: any) => [g.mail_account_id, g as AccessGrant]));
  const visible: OutlookAccountOption[] = [];
  for (const account of accounts) {
    const grant = grants.get(account.id) ?? null;
    const personalOwner = account.scope === "personal" && account.owner_user_id === userId;
    const hasJaAccess = personalOwner || grantAllows(grant, capability);
    const hasCapability = accountHasCapability(account, capability);
    if (!hasJaAccess) continue;
    if (!hasCapability && account.status === "connected") continue;
    if (account.scope === "personal" && !personalOwner) continue;

    visible.push(toAccountOption(account, grant, userId, role));
  }

  return visible.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "personal" ? -1 : 1;
    if (a.is_default_for_user !== b.is_default_for_user) return a.is_default_for_user ? -1 : 1;
    if (a.is_default_for_organization !== b.is_default_for_organization) return a.is_default_for_organization ? -1 : 1;
    return (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "");
  });
}

export async function loadAccount(admin: AdminClient, organizationId: string, accountId: string): Promise<MailAccountRow | null> {
  const { data, error } = await admin
    .from("mail_accounts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", accountId)
    .eq("provider", "outlook")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as MailAccountRow | null) ?? null;
}

export async function loadDefaultOrganizationSender(admin: AdminClient, organizationId: string): Promise<MailAccountRow | null> {
  const { data, error } = await admin
    .from("mail_accounts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("provider", "outlook")
    .eq("scope", "organization")
    .eq("mail_send_enabled", true)
    .eq("is_default_for_organization", true)
    .is("deleted_at", null)
    .order("last_connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as MailAccountRow | null) ?? null;
}

async function loadCredential(admin: AdminClient, organizationId: string, account: MailAccountRow): Promise<MailAccountRow> {
  const credentialId = account.auth_account_id ?? account.id;
  const credential = await loadAccount(admin, organizationId, credentialId);
  if (!credential) throw new OutlookError("outlook_credential_not_found", 404, "Microsoft hoofdaccount niet gevonden");
  if (credential.mailbox_mode !== "user" || credential.auth_account_id) {
    throw new OutlookError("outlook_credential_invalid", 400, "Microsoft hoofdaccount is ongeldig");
  }
  return credential;
}

async function decryptSecret(admin: AdminClient, secretEncrypted: string): Promise<TokenConfig> {
  const envelope = JSON.parse(secretEncrypted) as SecretEnvelope;
  if (envelope.kind !== "oauth_vault_v1") throw new OutlookError("outlook_secret_invalid", 400, "Outlook secret is ongeldig");
  if (!envelope.access_token || !envelope.refresh_token) {
    throw new OutlookError("outlook_secret_missing_tokens", 400, "Outlook tokens ontbreken");
  }

  const { data: accessToken, error: accessError } = await admin.rpc("decrypt_sensitive", { ciphertext: envelope.access_token });
  if (accessError) throw accessError;
  const { data: refreshToken, error: refreshError } = await admin.rpc("decrypt_sensitive", { ciphertext: envelope.refresh_token });
  if (refreshError) throw refreshError;

  return {
    access_token: String(accessToken ?? ""),
    refresh_token: String(refreshToken ?? ""),
    expires_at: String(envelope.expires_at ?? new Date(0).toISOString()),
    scope: String(envelope.scope ?? OUTLOOK_SCOPES),
    token_type: envelope.token_type ?? "Bearer",
  };
}

async function encryptSecret(admin: AdminClient, token: TokenConfig, extra: Record<string, unknown> = {}): Promise<string> {
  const { data: encAccess, error: accessError } = await admin.rpc("encrypt_sensitive", { plaintext: token.access_token });
  if (accessError) throw accessError;
  const { data: encRefresh, error: refreshError } = await admin.rpc("encrypt_sensitive", { plaintext: token.refresh_token });
  if (refreshError) throw refreshError;

  return JSON.stringify({
    kind: "oauth_vault_v1",
    access_token: encAccess,
    refresh_token: encRefresh,
    expires_at: token.expires_at,
    scope: token.scope,
    token_type: token.token_type ?? "Bearer",
    ...extra,
  });
}

async function loadToken(admin: AdminClient, credential: MailAccountRow): Promise<TokenConfig> {
  const { data, error } = await admin
    .from("mail_account_secrets")
    .select("secret_encrypted")
    .eq("mail_account_id", credential.id)
    .maybeSingle();
  if (error) throw error;
  if (!data?.secret_encrypted) throw new OutlookError("outlook_not_connected", 404, "Microsoft 365 is niet gekoppeld");
  return decryptSecret(admin, data.secret_encrypted);
}

function shouldRefresh(token: TokenConfig): boolean {
  const expiresAt = Date.parse(token.expires_at);
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt - Date.now() < 120_000;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshToken(admin: AdminClient, credential: MailAccountRow, token: TokenConfig): Promise<TokenConfig> {
  const claimed = await admin.rpc("claim_mail_account_refresh", { p_mail_account_id: credential.id, p_lock_timeout_seconds: 90 });
  if (claimed.error) throw claimed.error;

  if (!claimed.data) {
    // Een andere thread vernieuwt het token al. Wacht tot dat klaar is (max ~3s) en geef het
    // verse token terug zodra het niet meer ververst hoeft. Lukt dat niet op tijd, dan geven we
    // het laatst geladen token terug als best effort (een volgende Graph-call probeert opnieuw).
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(750);
      const fresh = await loadToken(admin, credential);
      if (!shouldRefresh(fresh)) return fresh;
    }
    return await loadToken(admin, credential);
  }

  try {
    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
    const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new OutlookError("outlook_client_secrets_missing", 500, "Microsoft client secrets ontbreken");

    // Timeout op de token-refresh: Microsoft mag de edge function niet eindeloos laten hangen.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: controller.signal,
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: token.refresh_token,
          client_id: clientId,
          client_secret: clientSecret,
          scope: token.scope || OUTLOOK_SCOPES,
        }),
      });
    } catch (fetchErr) {
      const aborted = (fetchErr as Error)?.name === "AbortError";
      throw new OutlookError("outlook_refresh_failed", aborted ? 504 : 502, aborted ? "Microsoft reageerde niet op tijd (token-refresh time-out)" : "Token-refresh kon Microsoft niet bereiken");
    } finally {
      clearTimeout(timeout);
    }

    const body = await res.json().catch(() => ({})) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
      error?: string;
      error_description?: string;
    };

    if (!res.ok || !body.access_token || !body.expires_in) {
      const message = body.error_description || body.error || "outlook_refresh_failed";
      if (res.status === 400 || body.error === "invalid_grant") {
        await admin.from("mail_accounts").update({
          status: "needs_reconnect",
          last_error: isConsentError(message) ? consentRequiredMessage() : message,
          refreshing_at: null,
        }).eq("id", credential.id);
      }
      throw new OutlookError("outlook_refresh_failed", 401, message);
    }

    const next: TokenConfig = {
      access_token: body.access_token,
      refresh_token: body.refresh_token || token.refresh_token,
      expires_at: new Date(Date.now() + body.expires_in * 1000).toISOString(),
      scope: body.scope || token.scope || OUTLOOK_SCOPES,
      token_type: body.token_type || token.token_type || "Bearer",
    };

    const encrypted = await encryptSecret(admin, next);
    const { error: secretError } = await admin
      .from("mail_account_secrets")
      .upsert({ mail_account_id: credential.id, secret_encrypted: encrypted, secret_kind: "oauth" }, { onConflict: "mail_account_id" });
    if (secretError) throw secretError;

    await admin.from("mail_accounts").update({
      status: "connected",
      last_error: null,
      refreshing_at: null,
    }).eq("id", credential.id);

    return next;
  } finally {
    await admin.rpc("release_mail_account_refresh", { p_mail_account_id: credential.id });
  }
}

export async function accessTokenForCredential(admin: AdminClient, credential: MailAccountRow): Promise<string> {
  let token = await loadToken(admin, credential);
  if (shouldRefresh(token)) token = await refreshToken(admin, credential, token);
  if (!token.access_token) throw new OutlookError("outlook_access_token_missing", 400, "Outlook access token ontbreekt");
  return token.access_token;
}

export async function loadProviderForAccount(
  admin: AdminClient,
  organizationId: string,
  options: {
    accountId?: string | null;
    userId?: string | null;
    role?: string | null;
    require?: OutlookCapability;
    allowSystemDefault?: boolean;
    allowUnready?: boolean;
    bypassJaGrants?: boolean;
  },
): Promise<OutlookProvider> {
  const required = options.require ?? "none";
  let account: MailAccountRow | null = null;

  if (options.accountId) {
    account = await loadAccount(admin, organizationId, options.accountId);
  } else if (options.allowSystemDefault) {
    account = await loadDefaultOrganizationSender(admin, organizationId);
  }

  if (!account) throw new OutlookError("outlook_account_not_found", 404, "Geen Outlook-account gevonden");
  if (account.status !== "connected" && !options.allowUnready) {
    throw new OutlookError(account.status || "outlook_not_connected", 400, account.last_error || "Outlook-account is niet klaar voor gebruik");
  }
  if (!accountHasCapability(account, required)) {
    throw new OutlookError("outlook_capability_disabled", 403, "Deze mailbox heeft deze actie niet ingeschakeld");
  }

  if (required !== "none" && options.userId && !options.bypassJaGrants) {
    const { data: grantRaw, error: grantError } = await admin
      .from("mail_account_user_access")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("mail_account_id", account.id)
      .eq("user_id", options.userId)
      .maybeSingle();
    if (grantError) throw grantError;
    const personalOwner = account.scope === "personal" && account.owner_user_id === options.userId;
    if (!personalOwner && !grantAllows((grantRaw as AccessGrant | null) ?? null, required)) {
      throw new OutlookError("mail_account_forbidden", 403, "Je hebt geen JA-rechten voor deze mailbox of agenda");
    }
  }

  const credential = await loadCredential(admin, organizationId, account);
  const token = await loadToken(admin, credential);
  return { account, credential, token };
}

export function mailboxBasePath(account: MailAccountRow): string {
  if (account.mailbox_mode === "shared") {
    if (!account.mailbox_email) throw new OutlookError("shared_mailbox_missing", 400, "Gedeelde mailbox mist e-mailadres");
    return `/users/${encodeURIComponent(account.mailbox_email)}`;
  }
  return "/me";
}

export function calendarBasePath(account: MailAccountRow): string {
  if (account.calendar_path_kind === "graph_calendar_id") {
    if (!account.calendar_id) throw new OutlookError("calendar_id_missing", 400, "Agenda-id ontbreekt");
    return `/me/calendars/${encodeURIComponent(account.calendar_id)}`;
  }
  return `${mailboxBasePath(account)}/calendar`;
}

export function calendarViewPath(account: MailAccountRow): string {
  return `${calendarBasePath(account)}/calendarView`;
}

export function calendarEventsPath(account: MailAccountRow): string {
  return `${calendarBasePath(account)}/events`;
}

export async function graphFetch(
  admin: AdminClient,
  provider: OutlookProvider,
  pathOrUrl: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const accessToken = await accessTokenForCredential(admin, provider.credential);
  const url = typeof pathOrUrl === "string" ? graphUrl(pathOrUrl) : pathOrUrl;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let res = await fetch(url, { ...init, headers });
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After") || "0");
    if (retryAfter > 0 && retryAfter <= 5) {
      await sleep(retryAfter * 1000);
      res = await fetch(url, { ...init, headers });
    }
  }
  return res;
}

export async function graphJson<T>(
  admin: AdminClient,
  provider: OutlookProvider,
  pathOrUrl: string | URL,
  init: RequestInit = {},
): Promise<T> {
  const res = await graphFetch(admin, provider, pathOrUrl, init);
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const message = data?.error?.message || data?.error?.code || `graph_http_${res.status}`;
    await markGraphFailure(admin, provider, res.status, message);
    const retryAfter = Number(res.headers.get("Retry-After") || "0") || undefined;
    throw new OutlookError(`graph_${res.status}`, res.status, message, retryAfter);
  }

  return data as T;
}

export async function markGraphFailure(admin: AdminClient, provider: OutlookProvider, status: number, message: string) {
  if (isConsentError(message)) {
    const last_error = consentRequiredMessage();
    await admin.from("mail_accounts").update({
      status: "needs_reconnect",
      last_error,
    }).in("id", [provider.credential.id, provider.account.id]);
    return;
  }

  if (status === 401) {
    await admin.from("mail_accounts").update({
      status: "needs_reconnect",
      last_error: message.slice(0, 500),
    }).eq("id", provider.credential.id);
    return;
  }

  if (status === 403) {
    await admin.from("mail_accounts").update({
      status: "failed",
      last_error: message.slice(0, 500),
    }).eq("id", provider.account.id);
  }
}

export async function storeTokenSecret(
  admin: AdminClient,
  accountId: string,
  token: TokenConfig,
  extra: Record<string, unknown> = {},
) {
  const encrypted = await encryptSecret(admin, token, extra);
  const { error } = await admin
    .from("mail_account_secrets")
    .upsert({ mail_account_id: accountId, secret_encrypted: encrypted, secret_kind: "oauth" }, { onConflict: "mail_account_id" });
  if (error) throw error;
}

export async function auditOutlookAction(
  admin: AdminClient,
  input: {
    organizationId: string;
    userId?: string | null;
    action: string;
    accountId?: string | null;
    values?: Record<string, unknown>;
  },
) {
  await admin.from("audit_log").insert({
    organization_id: input.organizationId,
    action: input.action,
    table_name: "mail_accounts",
    record_id: input.accountId ?? null,
    new_values: input.values ?? {},
    user_id: input.userId ?? null,
  } as any).then(() => {});
}
