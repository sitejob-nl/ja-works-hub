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

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Use RPC to get decrypted credentials
    const { data: exactTokenData, error: rpcError } = await serviceClient.rpc('get_exact_token', {
      p_org_id: profile.organization_id,
    });

    if (rpcError || !exactTokenData || exactTokenData.length === 0) {
      return new Response(JSON.stringify({ error: "Exact Online niet geconfigureerd" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = exactTokenData[0];
    if (!config.tenant_id || !config.decrypted_webhook_secret) {
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

    // Get fresh token using decrypted webhook secret
    let tokenData;
    try {
      tokenData = await getExactToken(config.tenant_id, config.decrypted_webhook_secret);
    } catch (err: unknown) {
      if ((err as Error).message === "REAUTH_REQUIRED") {
        return new Response(JSON.stringify({
          error: "Exact Online koppeling verlopen. Koppel opnieuw via Instellingen.",
          needs_reauth: true,
          setup_url: `https://connect.sitejob.nl/exact-setup?tenant_id=${config.tenant_id}`,
        }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
