import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const userId = claimsData.claims.sub;

    // Get user's organization
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404, headers: corsHeaders });
    }

    const orgId = profile.organization_id;
    const CONNECT_API_KEY = Deno.env.get("CONNECT_API_KEY");
    if (!CONNECT_API_KEY) {
      return new Response(JSON.stringify({ error: "CONNECT_API_KEY not configured" }), { status: 500, headers: corsHeaders });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const webhookUrl = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;

    // Register tenant with SiteJob Connect
    const registerRes = await fetch(
      "https://xeshjkznwdrxjjhbpisn.supabase.co/functions/v1/whatsapp-register-tenant",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": CONNECT_API_KEY,
        },
        body: JSON.stringify({
          name: `Org ${orgId}`,
          webhook_url: webhookUrl,
        }),
      }
    );

    const registerBody = await registerRes.json();

    if (!registerRes.ok) {
      console.error("Register tenant failed:", registerBody);
      return new Response(JSON.stringify({ error: "Failed to register tenant", details: registerBody }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { tenant_id, webhook_secret } = registerBody;

    // Store in whatsapp_config using service role for encrypted storage
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error: upsertError } = await serviceClient
      .from("whatsapp_config")
      .upsert(
        {
          organization_id: orgId,
          tenant_id,
          webhook_secret,
          is_active: false,
        },
        { onConflict: "organization_id" }
      );

    if (upsertError) {
      console.error("Upsert error:", upsertError);
      return new Response(JSON.stringify({ error: "Failed to save config" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        tenant_id,
        setup_url: `https://connect.sitejob.nl/whatsapp-setup?tenant_id=${tenant_id}`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
