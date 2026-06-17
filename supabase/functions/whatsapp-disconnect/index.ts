import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, getAuthenticatedOrg, jsonError, jsonOk } from "../_shared/whatsapp-utils.ts";

const CONNECT_DISCONNECT_URL = "https://xeshjkznwdrxjjhbpisn.supabase.co/functions/v1/tenant-disconnect";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );

    const auth = await getAuthenticatedOrg(req, supabase);
    if (auth instanceof Response) return auth;

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: config } = await service
      .from("whatsapp_config")
      .select("id, tenant_id, webhook_secret")
      .eq("organization_id", auth.orgId)
      .maybeSingle();

    if (!config?.tenant_id || !config?.webhook_secret) {
      return jsonError("WhatsApp is niet geregistreerd", 400);
    }

    const { data: webhookSecret, error: decryptError } = await service.rpc("decrypt_sensitive", {
      ciphertext: config.webhook_secret,
    });
    if (decryptError || !webhookSecret) return jsonError("Webhook secret kan niet worden gelezen", 500);

    const connectApiKey = Deno.env.get("CONNECT_API_KEY");
    if (!connectApiKey) return jsonError("CONNECT_API_KEY not configured", 500);

    const response = await fetch(CONNECT_DISCONNECT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": connectApiKey,
        "Authorization": `Bearer ${connectApiKey}`,
      },
      body: JSON.stringify({
        tenant_id: config.tenant_id,
        webhook_secret: webhookSecret,
        integration: "whatsapp",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Connect disconnect failed:", text);
      return jsonError("Ontkoppelen bij SiteJob Connect mislukt", 502);
    }

    await service
      .from("whatsapp_config")
      .update({
        is_active: false,
        phone_number_id: null,
        access_token: null,
        display_phone: null,
        waba_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    return jsonOk({ success: true });
  } catch (err) {
    console.error("whatsapp-disconnect error:", err);
    return jsonError("Interne fout bij ontkoppelen", 500);
  }
});
