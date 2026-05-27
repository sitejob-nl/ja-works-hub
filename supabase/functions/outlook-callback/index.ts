import { createAdminClient } from "../_shared/auth.ts";
import { OUTLOOK_SCOPES, isConsentError, consentRequiredMessage, storeTokenSecret } from "../_shared/outlook-accounts.ts";
import { buildOrganizationPublicUrl } from "../_shared/public-url.ts";

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_ME_URL = "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName";

type StatePayload = {
  organization_id: string;
  user_id: string;
  target_user_id?: string;
  scope: "organization" | "personal";
  consent_flow?: "admin" | "oauth";
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

function statusRedirect(returnTo: string, params: Record<string, string>) {
  const url = new URL(returnTo);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Response(null, { status: 303, headers: { Location: url.toString(), "Cache-Control": "no-store" } });
}

async function fallbackReturnTo(admin: ReturnType<typeof createAdminClient>, organizationId: string) {
  return await buildOrganizationPublicUrl(admin, organizationId, "/instellingen");
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const rawState = url.searchParams.get("state");
  const adminConsent = url.searchParams.get("admin_consent");
  const tenant = url.searchParams.get("tenant");
  const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error");

  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET");
  const stateSecret = Deno.env.get("OUTLOOK_OAUTH_STATE_SECRET") || clientSecret;
  if (!clientId || !clientSecret || !stateSecret) return errorPage("Outlook secrets ontbreken.");

  const state = rawState ? await verifyState(rawState, stateSecret) : null;
  if (oauthError) {
    if (state?.return_to) {
      return statusRedirect(state.return_to, {
        outlook_error: isConsentError(oauthError) ? "consent_required" : "oauth_error",
        outlook_error_description: isConsentError(oauthError) ? consentRequiredMessage() : oauthError.slice(0, 500),
      });
    }
    return errorPage(oauthError);
  }
  if (!rawState || !state) return errorPage("Ongeldige of verlopen OAuth state.");

  if (state.consent_flow === "admin") {
    if (adminConsent !== "True") return statusRedirect(state.return_to, {
      outlook_error: "admin_consent_denied",
      outlook_error_description: "Microsoft admin consent is niet bevestigd.",
    });
  } else if (!code) {
    return errorPage("OAuth response mist code.");
  }

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

  if (state.consent_flow === "admin") {
    await admin.from("audit_log").insert({
      organization_id: state.organization_id,
      action: "update",
      table_name: "mail_accounts",
      record_id: null,
      user_id: state.user_id,
      new_values: {
        event: "outlook_admin_consent",
        tenant,
      },
    } as any).then(() => {});

    return statusRedirect(state.return_to || await fallbackReturnTo(admin, state.organization_id), {
      outlook_admin_consent: "1",
      outlook_scope: state.scope,
    });
  }
  const authCode = code!;

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authCode,
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
    const ownerUserId = state.target_user_id || state.user_id;
    const { data: existing } = await admin
      .from("mail_accounts")
      .select("id")
      .eq("organization_id", state.organization_id)
      .eq("provider", "outlook")
      .eq("scope", "personal")
      .eq("owner_user_id", ownerUserId)
      .is("deleted_at", null)
      .maybeSingle();

    await admin
      .from("mail_accounts")
      .update({ is_default_for_user: false })
      .eq("organization_id", state.organization_id)
      .eq("scope", "personal")
      .eq("owner_user_id", ownerUserId)
      .is("deleted_at", null);

    const payload = {
      organization_id: state.organization_id,
      provider: "outlook",
      scope: "personal",
      owner_user_id: ownerUserId,
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
    new_values: {
      event: "outlook_connected",
      scope: state.scope,
      microsoft_email: email,
      actor_user_id: state.user_id,
      owner_user_id: state.scope === "personal" ? state.target_user_id || state.user_id : null,
    },
  } as any).then(() => {});

  return connectedRedirect(state.return_to || await fallbackReturnTo(admin, state.organization_id), state.scope);
});
