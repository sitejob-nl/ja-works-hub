import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getExactConnectUrl } from "../_shared/exact-helpers.ts";

import { CORS_HEADERS as corsHeaders } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Self-auth: verify Bearer token, derive org_id from profile ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await authClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile, error: profileError } = await authClient
      .from("profiles")
      .select("organization_id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.organization_id) {
      return new Response(JSON.stringify({ error: "Missing organization" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (profile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden — admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Derive org_id from the authenticated user; ignore any body.organization_id.
    const organization_id = profile.organization_id;

    const CONNECT_API_KEY = Deno.env.get("CONNECT_API_KEY");
    if (!CONNECT_API_KEY) {
      return new Response(JSON.stringify({ error: "CONNECT_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const webhookUrl = `${SUPABASE_URL}/functions/v1/exact-webhook`;

    const registerRes = await fetch(
      getExactConnectUrl("exact-register-tenant"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": CONNECT_API_KEY,
        },
        body: JSON.stringify({
          name: `Org ${organization_id}`,
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
      .upsert({ organization_id, tenant_id, webhook_secret, is_active: false }, { onConflict: "organization_id" });

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
