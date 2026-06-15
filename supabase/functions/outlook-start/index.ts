import { createAdminClient, requireInternalProfile } from "../_shared/auth.ts";
import { OUTLOOK_ADMIN_CONSENT_SCOPES, OUTLOOK_SCOPES, json } from "../_shared/outlook-accounts.ts";
import { getOrganizationPublicBaseUrl } from "../_shared/public-url.ts";

import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

const AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const ADMIN_CONSENT_URL = "https://login.microsoftonline.com/organizations/v2.0/adminconsent";

function utf8(value: string) {
  return new TextEncoder().encode(value);
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

async function signedState(payload: Record<string, unknown>, secret: string) {
  const body = base64Url(utf8(JSON.stringify(payload)));
  const sig = await hmac(body, secret);
  return `${body}.${sig}`;
}

function redirectUri() {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/outlook-callback`;
}

async function safeReturnTo(admin: ReturnType<typeof createAdminClient>, organizationId: string, input: unknown) {
  const fallback = await getOrganizationPublicBaseUrl(admin, organizationId);
  if (!input) return `${fallback}/instellingen`;
  try {
    const url = new URL(String(input));
    const allowed = [new URL(fallback).origin, "http://localhost:8080", "http://127.0.0.1:8080"];
    return allowed.includes(url.origin) ? url.toString() : `${fallback}/instellingen`;
  } catch {
    return `${fallback}/instellingen`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, corsHeaders);

  const auth = await requireInternalProfile(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
  const stateSecret = Deno.env.get("OUTLOOK_OAUTH_STATE_SECRET") || Deno.env.get("MICROSOFT_CLIENT_SECRET");
  if (!clientId || !stateSecret) return json({ error: "outlook_secrets_missing" }, 500, corsHeaders);

  const admin = createAdminClient();
  const body = await req.json().catch(() => ({}));
  const scope = body.scope === "personal" ? "personal" : "organization";
  if (scope === "organization" && auth.role !== "admin") return json({ error: "Alleen admins kunnen bedrijfsmail koppelen" }, 403, corsHeaders);
  const consentFlow = scope === "organization" && body.consent_flow === "admin" ? "admin" : "oauth";

  let targetUserId = auth.userId;
  if (scope === "personal" && body.target_user_id && body.target_user_id !== auth.userId) {
    if (auth.role !== "admin") return json({ error: "Alleen admins kunnen voor een andere medewerker koppelen" }, 403, corsHeaders);
    const { data: targetProfile, error: targetError } = await admin
      .from("profiles")
      .select("id")
      .eq("id", String(body.target_user_id))
      .eq("organization_id", auth.organizationId)
      .in("role", ["admin", "intercedent", "backoffice", "finance"])
      .maybeSingle();
    if (targetError) return json({ error: targetError.message }, 400, corsHeaders);
    if (!targetProfile?.id) return json({ error: "Medewerker niet gevonden" }, 404, corsHeaders);
    targetUserId = targetProfile.id;
  }

  const nonce = crypto.randomUUID();
  const payload = {
    organization_id: auth.organizationId,
    user_id: auth.userId,
    target_user_id: targetUserId,
    scope,
    consent_flow: consentFlow,
    return_to: await safeReturnTo(admin, auth.organizationId, body.return_to),
    nonce,
    iat: Math.floor(Date.now() / 1000),
  };
  const state = await signedState(payload, stateSecret);

  const { error } = await admin.from("outlook_oauth_states").insert({
    organization_id: auth.organizationId,
    user_id: auth.userId,
    state_hash: await sha256(state),
    nonce_hash: await sha256(nonce),
    scope,
    return_to: payload.return_to,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (error) return json({ error: error.message }, 400, corsHeaders);

  const url = new URL(consentFlow === "admin" ? ADMIN_CONSENT_URL : AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", state);

  if (consentFlow === "admin") {
    url.searchParams.set("scope", OUTLOOK_ADMIN_CONSENT_SCOPES);
  } else {
    url.searchParams.set("response_type", "code");
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", OUTLOOK_SCOPES);
    url.searchParams.set("prompt", body.force_consent ? "consent" : "select_account");
    if (typeof body.login_hint === "string" && body.login_hint.includes("@")) {
      url.searchParams.set("login_hint", body.login_hint.trim());
    }
  }

  return json({ authorization_url: url.toString() }, 200, corsHeaders);
});
