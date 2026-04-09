import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonOk, jsonError } from "../_shared/whatsapp-utils.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const webhookSecret = req.headers.get("X-Webhook-Secret");
    if (!webhookSecret) {
      return jsonError("Unauthorized", 401);
    }

    const body = await req.json();
    const tenantId = body.tenant_id;
    if (!tenantId) {
      return jsonError("Missing tenant_id", 400);
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // O(1) lookup by tenant_id
    const { data: config, error: findError } = await serviceClient
      .from("whatsapp_config")
      .select("id, organization_id, webhook_secret")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (findError || !config) {
      console.error("Config not found for tenant:", tenantId);
      return jsonError("Tenant not found", 404);
    }

    // Decrypt and validate webhook secret
    const { data: decrypted } = await serviceClient.rpc("decrypt_sensitive", {
      ciphertext: config.webhook_secret,
    });

    if (decrypted !== webhookSecret) {
      console.error("Webhook secret mismatch for tenant:", tenantId);
      return jsonError("Unauthorized", 401);
    }

    // Handle disconnect
    if (body.action === "disconnect") {
      await serviceClient
        .from("whatsapp_config")
        .update({
          phone_number_id: null,
          access_token: null,
          display_phone: null,
          waba_id: null,
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", config.id);

      console.log("WhatsApp disconnected for org:", config.organization_id);
      return jsonOk({ status: "disconnected" });
    }

    // Handle credential push
    const { phone_number_id, access_token, display_phone, waba_id } = body;
    if (!phone_number_id || !access_token) {
      return jsonError("Missing credentials", 400);
    }

    // Encrypt access_token before storing (no auto-trigger — must call encrypt_sensitive explicitly)
    const { data: encryptedToken, error: encError } = await serviceClient.rpc("encrypt_sensitive", {
      plaintext: access_token,
    });

    if (encError || !encryptedToken) {
      console.error("Failed to encrypt access_token:", encError);
      return jsonError("Encryption failed", 500);
    }

    const { error: updateError } = await serviceClient
      .from("whatsapp_config")
      .update({
        phone_number_id,
        access_token: encryptedToken,
        display_phone: display_phone ?? null,
        waba_id: waba_id ?? null,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    if (updateError) {
      console.error("Config update failed:", updateError);
      return jsonError("Update failed", 500);
    }

    console.log("WhatsApp configured for org:", config.organization_id);
    return jsonOk({ status: "configured" });
  } catch (err) {
    console.error("whatsapp-config error:", err);
    return jsonOk({ status: "error" }); // Always 200 for webhook endpoints
  }
});
