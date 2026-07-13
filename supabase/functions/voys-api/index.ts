import { corsHeaders, jsonResponse, jsonError, callVoysApi, isSafeVoysEndpoint } from "../_shared/voys-helpers.ts";
import { createAdminClient, requireRolePermission } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate on EVERY path — the proxy forwards a Bearer credential and can
    // reach external hosts, so it must never run anonymously. An internal role is
    // required; medewerker/opdrachtgever portal users have no business calling Voys.
    const auth = await requireRolePermission(req, "settings.manage", corsHeaders);
    if (auth instanceof Response) return auth;

    const body = await req.json();
    const { endpoint, method = "GET", payload, api_token: directToken } = body;

    if (!endpoint) {
      return jsonError("endpoint is required", 400);
    }
    if (!isSafeVoysEndpoint(endpoint)) {
      return jsonError("Ongeldig endpoint", 400);
    }

    // Token source: a freshly pasted token from the settings connect/test flow,
    // otherwise the caller's OWN org token (decrypted server-side). directToken
    // can no longer be used to skip authentication or to act on another org.
    let apiToken: string | null =
      typeof directToken === "string" && directToken.length > 0 ? directToken : null;

    if (!apiToken) {
      const serviceClient = createAdminClient();
      const { data: tokenData, error: rpcError } = await serviceClient.rpc("get_voys_token", {
        p_org_id: auth.organizationId,
      });

      if (rpcError || !tokenData || tokenData.length === 0) {
        return jsonError("Voys niet geconfigureerd. Ga naar Instellingen om Voys te koppelen.", 400);
      }

      apiToken = tokenData[0].api_token;
    }

    if (!apiToken) {
      return jsonError("No API token available", 400);
    }

    // Call Voys API
    const { data, status } = await callVoysApi(apiToken, endpoint, method, payload);

    return jsonResponse(data, status);
  } catch (err) {
    console.error("Voys API proxy error:", err);
    return jsonError("Internal server error", 500);
  }
});
