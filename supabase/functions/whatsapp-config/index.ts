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
    console.log("WhatsApp config received:", { action: body.action, tenant_id: body.tenant_id });

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find org by tenant_id
    const { data: config, error: findError } = await serviceClient
      .from("whatsapp_config")
      .select("*")
      .eq("tenant_id", body.tenant_id)
      .single();

    if (findError || !config) {
      console.error("Config not found for tenant:", body.tenant_id);
      return new Response("Not found", { status: 404 });
    }

    // Decrypt and compare webhook_secret
    const { data: decrypted } = await serviceClient.rpc('get_whatsapp_token', {
      p_org_id: config.organization_id,
    });

    if (!decrypted?.[0] || decrypted[0].decrypted_webhook_secret !== webhookSecret) {
      console.error("Webhook secret mismatch");
      return new Response("Unauthorized", { status: 401 });
    }

    // Handle disconnect
    if (body.action === "disconnect") {
      await serviceClient
        .from("whatsapp_config")
        .update({
          access_token: null,
          phone_number_id: null,
          display_phone: null,
          waba_id: null,
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", config.id);

      console.log("WhatsApp disconnected for org:", config.organization_id);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle config push (OAuth credentials)
    const { error: updateError } = await serviceClient
      .from("whatsapp_config")
      .update({
        phone_number_id: body.phone_number_id,
        access_token: body.access_token,
        display_phone: body.display_phone,
        waba_id: body.waba_id,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    if (updateError) {
      console.error("Update error:", updateError);
      return new Response("Internal error", { status: 500 });
    }

    console.log("WhatsApp config updated for org:", config.organization_id);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Config error:", err);
    return new Response("Internal error", { status: 500 });
  }
});
