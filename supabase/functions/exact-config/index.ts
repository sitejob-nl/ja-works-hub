import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const webhookSecret = req.headers.get("X-Webhook-Secret");
    if (!webhookSecret) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await req.json();
    console.log("Exact config received:", { action: body.action, tenant_id: body.tenant_id });

    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Find config by tenant_id
    const { data: config, error: findError } = await serviceClient
      .from("exact_config")
      .select("*")
      .eq("tenant_id", body.tenant_id)
      .single();

    if (findError || !config) {
      console.error("Config not found for tenant:", body.tenant_id);
      return new Response("Not found", { status: 404 });
    }

    // Decrypt webhook_secret via RPC and compare
    const { data: decrypted } = await serviceClient.rpc('get_exact_token', {
      p_org_id: config.organization_id,
    });

    if (!decrypted?.[0] || decrypted[0].decrypted_webhook_secret !== webhookSecret) {
      console.error("Webhook secret mismatch");
      return new Response("Unauthorized", { status: 401 });
    }

    // Handle disconnect
    if (body.action === "disconnect") {
      await serviceClient
        .from("exact_config")
        .update({
          division: null,
          company_name: null,
          base_url: null,
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", config.id);

      console.log("Exact disconnected for org:", config.organization_id);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Handle config push
    const regionBaseUrls: Record<string, string> = {
      nl: "https://start.exactonline.nl",
      be: "https://start.exactonline.be",
      de: "https://start.exactonline.de",
      uk: "https://start.exactonline.co.uk",
      fr: "https://start.exactonline.fr",
      es: "https://start.exactonline.es",
    };

    const { error: updateError } = await serviceClient
      .from("exact_config")
      .update({
        division: body.division,
        company_name: body.company_name || null,
        region: body.region || config.region || "nl",
        base_url: regionBaseUrls[body.region || config.region || "nl"] || regionBaseUrls.nl,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    if (updateError) {
      console.error("Update error:", updateError);
      return new Response("Internal error", { status: 500 });
    }

    console.log("Exact config updated for org:", config.organization_id, "division:", body.division);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Config error:", err);
    return new Response("Internal error", { status: 500 });
  }
});
