import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper to get a fresh Exact token via SiteJob Connect
async function getExactToken(tenantId: string, webhookSecret: string) {
  const res = await fetch("https://xeshjkznwdrxjjhbpisn.supabase.co/functions/v1/exact-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: tenantId, secret: webhookSecret }),
  });

  const data = await res.json();
  if (!res.ok) {
    if (data.needs_reauth) {
      throw new Error("REAUTH_REQUIRED");
    }
    throw new Error(data.error || "Token ophalen mislukt");
  }
  return data as { access_token: string; division: number; region: string; base_url: string; expires_at: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userId = claimsData.claims.sub;
    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", userId).single();
    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: config } = await serviceClient
      .from("exact_config")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("is_active", true)
      .single();

    if (!config || !config.tenant_id || !config.webhook_secret) {
      return new Response(JSON.stringify({ error: "Exact Online niet geconfigureerd" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { endpoint, method = "GET", payload } = body;

    if (!endpoint) {
      return new Response(JSON.stringify({ error: "endpoint is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get fresh token
    let tokenData;
    try {
      tokenData = await getExactToken(config.tenant_id, config.webhook_secret);
    } catch (err: any) {
      if (err.message === "REAUTH_REQUIRED") {
        return new Response(JSON.stringify({
          error: "Exact Online koppeling verlopen. Koppel opnieuw via Instellingen.",
          needs_reauth: true,
          setup_url: `https://connect.sitejob.nl/exact-setup?tenant_id=${config.tenant_id}`,
        }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw err;
    }

    // Build the full URL — endpoint can be relative (e.g., "crm/Accounts") or include division
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
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
