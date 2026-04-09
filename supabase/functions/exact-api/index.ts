import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, getExactToken, jsonError } from "../_shared/exact-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonError("Unauthorized", 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonError("Unauthorized", 401);
    }

    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
    if (!profile) {
      return jsonError("Profile not found", 404);
    }

    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Use RPC to get decrypted credentials
    const { data: exactTokenData, error: rpcError } = await serviceClient.rpc('get_exact_token', {
      p_org_id: profile.organization_id,
    });

    if (rpcError || !exactTokenData || exactTokenData.length === 0) {
      return jsonError("Exact Online niet geconfigureerd", 400);
    }

    const config = exactTokenData[0];
    if (!config.tenant_id || !config.decrypted_webhook_secret) {
      return jsonError("Exact Online niet geconfigureerd", 400);
    }

    const body = await req.json();
    const { endpoint, method = "GET", payload } = body;

    if (!endpoint) {
      return jsonError("endpoint is required", 400);
    }

    // Get fresh token using decrypted webhook secret
    let tokenData;
    try {
      tokenData = await getExactToken(config.tenant_id, config.decrypted_webhook_secret);
    } catch (err: unknown) {
      if ((err as Error).message === "REAUTH_REQUIRED") {
        return jsonError("Exact Online koppeling verlopen. Koppel opnieuw via Instellingen.", 401, {
          needs_reauth: true,
          setup_url: `https://connect.sitejob.nl/exact-setup?tenant_id=${config.tenant_id}`,
        });
      }
      throw err;
    }

    // Build the full URL
    let fullUrl: string;
    if (endpoint.startsWith("http")) {
      fullUrl = endpoint;
    } else {
      fullUrl = `${tokenData.base_url}/api/v1/${tokenData.division}/${endpoint}`;
    }

    // Call Exact API
    const exactRes = await fetch(fullUrl, {
      method: method.toUpperCase(),
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });

    const exactBody = await exactRes.text();
    let parsed;
    try {
      parsed = JSON.parse(exactBody);
    } catch {
      parsed = { raw: exactBody };
    }

    return new Response(JSON.stringify(parsed), {
      status: exactRes.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Exact API proxy error:", err);
    return jsonError("Internal server error", 500);
  }
});
