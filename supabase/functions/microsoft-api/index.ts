import { createAdminClient, requireInternalProfile } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function buildGraphUrl(endpoint: string): string | null {
  if (endpoint.startsWith("http")) {
    try {
      const url = new URL(endpoint);
      return url.hostname === "graph.microsoft.com" ? url.toString() : null;
    } catch {
      return null;
    }
  }

  const cleanEndpoint = endpoint.replace(/^\/+/, "");
  if (cleanEndpoint.startsWith("v1.0/") || cleanEndpoint.startsWith("beta/")) {
    return `https://graph.microsoft.com/${cleanEndpoint}`;
  }
  return `https://graph.microsoft.com/v1.0/${cleanEndpoint}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const auth = await requireInternalProfile(req, corsHeaders);
    if (auth instanceof Response) return auth;

    const body = await req.json();
    const { endpoint, method = "GET", payload, user_id } = body;
    const organization_id = auth.organizationId;
    const requestedUserId = user_id || null;

    if (!endpoint) return json({ error: "endpoint is required" }, 400);
    if (requestedUserId && requestedUserId !== auth.userId && auth.role !== "admin") {
      return json({ error: "Je mag alleen je eigen Microsoft-account gebruiken" }, 403);
    }

    const serviceClient = createAdminClient();

    // Get decrypted tokens via RPC (tries user-specific first, falls back to org)
    const { data: tokenData, error: rpcError } = await serviceClient.rpc("get_microsoft_token", {
      p_org_id: organization_id,
      p_user_id: requestedUserId,
    });

    if (rpcError || !tokenData || tokenData.length === 0) {
      return json({ error: "Microsoft 365 niet geconfigureerd. Koppel je account via Instellingen." }, 400);
    }

    const config = tokenData[0];
    if (!config.access_token || !config.refresh_token) {
      return json({ error: "Microsoft 365 tokens ontbreken. Koppel opnieuw via Instellingen." }, 400);
    }

    // Also get the config row ID for targeted updates
    let configQuery = serviceClient.from("microsoft_config").select("id").eq("organization_id", organization_id).eq("is_active", true);
    if (config.is_personal) {
      configQuery = configQuery.eq("user_id", requestedUserId);
    } else {
      configQuery = configQuery.is("user_id", null);
    }
    const { data: configRow } = await configQuery.maybeSingle();
    const configId = configRow?.id;

    // Check token expiry (60s buffer)
    const now = Date.now();
    const expiresAt = new Date(config.token_expires_at).getTime();
    const bufferMs = 60 * 1000;
    let accessToken = config.access_token;

    if (expiresAt - now <= bufferMs) {
      // Token expired — refresh it
      console.log("Token expired, refreshing for config:", configId);

      const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!;
      const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;

      const refreshRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: config.refresh_token,
          client_id: clientId,
          client_secret: clientSecret,
          scope: "openid profile User.Read email Mail.Read Mail.ReadWrite Mail.Send MailboxFolder.Read MailboxFolder.ReadWrite MailboxItem.Read Calendars.Read Calendars.ReadWrite offline_access",
        }),
      });

      if (!refreshRes.ok) {
        const errText = await refreshRes.text();
        console.error("Token refresh failed:", errText);
        return json({
          error: "Microsoft token verlopen. Koppel opnieuw via Instellingen.",
          needs_reauth: true,
          debug: errText.substring(0, 200),
        }, 401);
      }

      const newTokens = await refreshRes.json();
      accessToken = newTokens.access_token;
      const newExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();

      // Encrypt and store new tokens
      const { data: encAccess } = await serviceClient.rpc("encrypt_sensitive", { plaintext: newTokens.access_token });
      const { data: encRefresh } = await serviceClient.rpc("encrypt_sensitive", { plaintext: newTokens.refresh_token });

      if (configId) {
        await serviceClient.from("microsoft_config").update({
          access_token: encAccess,
          refresh_token: encRefresh,
          token_expires_at: newExpiresAt,
          refreshing_at: null,
          updated_at: new Date().toISOString(),
        }).eq("id", configId);
      }

      console.log("Token refreshed successfully for config:", configId);
    }

    // Build Graph API URL
    const fullUrl = buildGraphUrl(String(endpoint));
    if (!fullUrl) return json({ error: "Alleen Microsoft Graph endpoints zijn toegestaan" }, 400);

    // Call Microsoft Graph API
    const graphRes = await fetch(fullUrl, {
      method: String(method).toUpperCase(),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });

    // Handle 401 from Graph
    if (graphRes.status === 401) {
      return json({ error: "Microsoft 365 koppeling verlopen. Koppel opnieuw via Instellingen.", needs_reauth: true }, 401);
    }

    const graphBody = await graphRes.text();
    let parsed;
    try { parsed = JSON.parse(graphBody); } catch { parsed = { raw: graphBody }; }

    return json(parsed, graphRes.status);
  } catch (err) {
    console.error("Microsoft API proxy error:", err);
    return json({ error: (err as Error).message || "Internal server error" }, 500);
  }
});
