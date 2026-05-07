import { createAdminClient } from "../_shared/auth.ts";
import { OUTLOOK_SCOPES, storeTokenSecret } from "../_shared/outlook-accounts.ts";

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_ME_URL = "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName";

type StatePayload = {
  organization_id: string;
  user_id: string;
  scope: "organization" | "personal";
  return_to: string;
  nonce: string;
  iat: number;
};

function utf8(value: string) {
  return new TextEncoder().encode(value);
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", utf8(value));
  return base64Url(new Uint8Array(digest));
}

async function hmac(input: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, utf8(input));
  return base64Url(new Uint8Array(sig));
}

async function verifyState(raw: string, secret: string): Promise<StatePayload | null> {
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  if (await hmac(body, secret) !== sig) return null;
  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as StatePayload;
  const age = Math.floor(Date.now() / 1000) - payload.iat;
  if (!payload.organization_id || !payload.user_id || !payload.nonce || age < 0 || age > 10 * 60) return null;
  return payload;
}

function redirectUri() {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/outlook-callback`;
}

function errorPage(message: string) {
  const clean = message.replace(/[<>&"]/g, "");
  return new Response(`<!doctype html><html lang="nl"><meta charset="utf-8"><body style="font-family:system-ui;padding:32px"><h1>Outlook koppeling mislukt</h1><p>${clean}</p></body></html>`, {
    status: 400,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}

function connectedRedirect(returnTo: string, scope: string) {
  const url = new URL(returnTo);
  url.searchParams.set("outlook_connected", "1");
  url.searchParams.set("outlook_scope", scope);
  return new Response(null, { status: 303, headers: { Location: url.toString(), "Cache-Control": "no-store" } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const rawState = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (oauthError) return errorPage(oauthError);
  if (!code || !rawState) return errorPage("OAuth response mist code of state.");

  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET");
  const stateSecret = Deno.env.get("OUTLOOK_OAUTH_STATE_SECRET") || clientSecret;
  if (!clientId || !clientSecret || !stateSecret) return errorPage("Outlook secrets ontbreken.");

  const state = await verifyState(rawState, stateSecret);
  if (!state) return errorPage("Ongeldige of verlopen OAuth state.");

  const admin = createAdminClient();
  const stateHash = await sha256(rawState);
  const nonceHash = await sha256(state.nonce);
  const { data: stored, error: stateLookupError } = await admin
    .from("outlook_oauth_states")
    .select("id, expires_at, used_at")
    .eq("state_hash", stateHash)
    .eq("nonce_hash", nonceHash)
    .eq("organization_id", state.organization_id)
    .eq("user_id", state.user_id)
    .maybeSingle();
  if (stateLookupError || !stored) return errorPage("OAuth state is niet bekend.");
  if (stored.used_at) return errorPage("OAuth state is al gebruikt.");
  if (new Date(stored.expires_at).getTime() < Date.now()) return errorPage("OAuth state is verlopen.");

  await admin.from("outlook_oauth_states").update({ used_at: new Date().toISOString() }).eq("id", stored.id);

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      scope: OUTLOOK_SCOPES,
    }),
  });
  const tokenData = await tokenRes.json().catch(() => ({})) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    error?: string;
  };
  if (!tokenRes.ok || !tokenData.access_token || !tokenData.refresh_token || !tokenData.expires_in) {
    return errorPage(tokenData.error || "Token exchange mislukt.");
  }

  const meRes = await fetch(GRAPH_ME_URL, { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
  const me = await meRes.json().catch(() => ({})) as { id?: string; displayName?: string; mail?: string | null; userPrincipalName?: string | null };
  if (!meRes.ok || !me.id) return errorPage("Microsoft profiel ophalen mislukt.");
  const email = (me.mail || me.userPrincipalName || "").toLowerCase();
  if (!email) return errorPage("Microsoft account heeft geen e-mailadres.");

  const now = new Date().toISOString();
  let accountId: string | undefined;
  if (state.scope === "personal") {
    const { data: existing } = await admin
      .from("mail_accounts")
      .select("id")
      .eq("organization_id", state.organization_id)
      .eq("provider", "outlook")
      .eq("scope", "personal")
      .eq("owner_user_id", state.user_id)
      .is("deleted_at", null)
      .maybeSingle();

    await admin
      .from("mail_accounts")
      .update({ is_default_for_user: false })
      .eq("organization_id", state.organization_id)
      .eq("scope", "personal")
      .eq("owner_user_id", state.user_id)
      .is("deleted_at", null);

    const payload = {
      organization_id: state.organization_id,
      provider: "outlook",
      scope: "personal",
      owner_user_id: state.user_id,
      display_name: me.displayName || email,
      from_email: email,
      mailbox_mode: "user",
      mailbox_email: email,
      mailbox_name: me.displayName || email,
      calendar_owner_email: email,
      mail_read_enabled: true,
      mail_send_enabled: true,
      mail_delete_enabled: true,
      calendar_read_enabled: true,
      calendar_write_enabled: true,
      is_default_for_user: true,
      status: "connected",
      last_error: null,
      last_connected_at: now,
      created_by: state.user_id,
    };
    const result = existing?.id
      ? await admin.from("mail_accounts").update(payload).eq("id", existing.id).select("id").single()
      : await admin.from("mail_accounts").insert(payload).select("id").single();
    if (result.error) return errorPage(`Persoonlijke mailbox opslaan mislukt: ${result.error.message}`);
    accountId = result.data.id;
  } else {
    const { data: existing } = await admin
      .from("mail_accounts")
      .select("id")
      .eq("organization_id", state.organization_id)
      .eq("provider", "outlook")
      .eq("scope", "organization")
      .eq("mailbox_mode", "user")
      .is("auth_account_id", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    await admin
      .from("mail_accounts")
      .update({ is_default_for_organization: false })
      .eq("organization_id", state.organization_id)
      .eq("scope", "organization")
      .is("deleted_at", null);

    const payload = {
      organization_id: state.organization_id,
      provider: "outlook",
      scope: "organization",
      owner_user_id: null,
      display_name: me.displayName || email,
      from_email: email,
      mailbox_mode: "user",
      mailbox_email: email,
      mailbox_name: me.displayName || email,
      calendar_owner_email: email,
      mail_read_enabled: true,
      mail_send_enabled: true,
      mail_delete_enabled: false,
      calendar_read_enabled: true,
      calendar_write_enabled: true,
      is_default_for_organization: true,
      status: "connected",
      last_error: null,
      last_connected_at: now,
      created_by: state.user_id,
    };
    const result = existing?.id
      ? await admin.from("mail_accounts").update(payload).eq("id", existing.id).select("id").single()
      : await admin.from("mail_accounts").insert(payload).select("id").single();
    if (result.error) return errorPage(`Bedrijfsmail opslaan mislukt: ${result.error.message}`);
    accountId = result.data.id;

    await admin.from("mail_accounts").update({
      status: "needs_test",
      last_error: "Opnieuw testen na herkoppeling",
      mail_read_enabled: false,
      mail_send_enabled: false,
      calendar_read_enabled: false,
      calendar_write_enabled: false,
    }).eq("organization_id", state.organization_id).eq("auth_account_id", accountId).is("deleted_at", null);
  }

  await storeTokenSecret(admin, accountId!, {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
    scope: tokenData.scope || OUTLOOK_SCOPES,
    token_type: tokenData.token_type || "Bearer",
  }, {
    microsoft_user_id: me.id,
    microsoft_email: email,
  });

  await admin.from("audit_log").insert({
    organization_id: state.organization_id,
    action: "create",
    table_name: "mail_accounts",
    record_id: accountId,
    new_values: { event: "outlook_connected", scope: state.scope, microsoft_email: email },
  } as any).then(() => {});

  return connectedRedirect(state.return_to || `${Deno.env.get("FRONTEND_URL") || "https://ja-werkt.lovable.app"}/instellingen`, state.scope);
});
