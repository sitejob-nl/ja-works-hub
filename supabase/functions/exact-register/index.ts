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

    const userId = user.id;
    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", userId).single();
    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const orgId = profile.organization_id;
    const CONNECT_API_KEY = Deno.env.get("CONNECT_API_KEY");
    if (!CONNECT_API_KEY) {
      return new Response(JSON.stringify({ error: "CONNECT_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const webhookUrl = `${SUPABASE_URL}/functions/v1/exact-webhook`;

    const registerRes = await fetch(
      "https://xeshjkznwdrxjjhbpisn.supabase.co/functions/v1/exact-register-tenant",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": CONNECT_API_KEY,
        },
        body: JSON.stringify({
          name: `Org ${orgId}`,
          webhook_url: webhookUrl,
          region: "nl",
        }),
      }
    );

    const registerBody = await registerRes.json();
    if (!registerRes.ok) {
      console.error("Register tenant failed:", registerBody);
      return new Response(JSON.stringify({ error: "Failed to register tenant", details: registerBody }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { tenant_id, webhook_secret } = registerBody;

    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { error: upsertError } = await serviceClient
      .from("exact_config")
      .upsert({ organization_id: orgId, tenant_id, webhook_secret, is_active: false }, { onConflict: "organization_id" });

    if (upsertError) {
      console.error("Upsert error:", upsertError);
      return new Response(JSON.stringify({ error: "Failed to save config" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(
      JSON.stringify({ success: true, tenant_id, setup_url: `https://connect.sitejob.nl/exact-setup?tenant_id=${tenant_id}` }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
