import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireRolePermission } from "../_shared/auth.ts";
import { corsHeaders, jsonError, jsonOk } from "../_shared/whatsapp-utils.ts";

const CONNECT_DISCONNECT_URL = "https://xeshjkznwdrxjjhbpisn.supabase.co/functions/v1/tenant-disconnect";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireRolePermission(req, "settings.manage", corsHeaders);
    if (auth instanceof Response) return auth;

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: config } = await service
      .from("whatsapp_config")
      .select("id, tenant_id, webhook_secret")
      .eq("organization_id", auth.organizationId)
      .maybeSingle();

    if (!config?.tenant_id || !config?.webhook_secret) {
      return jsonError("WhatsApp is niet geregistreerd", 400);
    }

    const { data: webhookSecret, error: decryptError } = await service.rpc("decrypt_sensitive", {
      ciphertext: config.webhook_secret,
    });
    if (decryptError || !webhookSecret) return jsonError("Webhook secret kan niet worden gelezen", 500);

    const response = await fetch(CONNECT_DISCONNECT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": webhookSecret,
      },
      body: JSON.stringify({
        tenant_id: config.tenant_id,
        integration: "whatsapp",
        secret: webhookSecret,
        webhook_secret: webhookSecret,
      }),
    });

    // Connect's tenant-disconnect is idempotent en veilig. Als Connect onbereikbaar is of de
    // tenant daar al weg is (404), mag de lokale ontkoppeling niet blijven hangen — we wissen
    // lokaal altijd, zodat de admin nooit vastzit met een dode koppeling.
    const connectOk = response.ok;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("Connect disconnect failed (lokaal toch wissen):", response.status, text);
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

    // Opruimen: lokale templates + gespreks-states van de (oude) WABA.
    await service.from("whatsapp_templates").delete().eq("organization_id", auth.organizationId);
    await service.from("whatsapp_conversation_states").delete().eq("organization_id", auth.organizationId);

    return jsonOk({ success: true, connect_warning: !connectOk });
  } catch (err) {
    console.error("whatsapp-disconnect error:", err);
    return jsonError("Interne fout bij ontkoppelen", 500);
  }
});
