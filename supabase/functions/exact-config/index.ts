import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, getExactToken, registerExactWebhookSubscriptions } from "../_shared/exact-helpers.ts";

const regionBaseUrls: Record<string, string> = {
  nl: "https://start.exactonline.nl",
  be: "https://start.exactonline.be",
  de: "https://start.exactonline.de",
  uk: "https://start.exactonline.co.uk",
  fr: "https://start.exactonline.fr",
  es: "https://start.exactonline.es",
};

async function validateWebhookSecret(serviceClient: any, config: any, webhookSecret: string): Promise<string | null> {
  const { data: decrypted, error: decryptError } = await serviceClient.rpc("decrypt_sensitive", {
    ciphertext: config.webhook_secret,
  });

  if (!decryptError && decrypted === webhookSecret) {
    return decrypted;
  }

  // Legacy repair: older exact-register stored webhook_secret in plaintext.
  // Accept it only when it exactly matches the incoming Connect secret, then
  // immediately rewrite the row encrypted so all later reads use the safe path.
  if (config.webhook_secret === webhookSecret) {
    const { data: encrypted, error: encryptError } = await serviceClient.rpc("encrypt_sensitive", {
      plaintext: webhookSecret,
    });
    if (!encryptError && encrypted) {
      await serviceClient
        .from("exact_config")
        .update({ webhook_secret: encrypted, updated_at: new Date().toISOString() })
        .eq("id", config.id);
    }
    return webhookSecret;
  }

  return null;
}

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

    const decryptedWebhookSecret = await validateWebhookSecret(serviceClient, config, webhookSecret);
    if (!decryptedWebhookSecret) {
      console.error("Webhook secret mismatch");
      return new Response("Unauthorized", { status: 401 });
    }

    // Handle disconnect én suspended (admin kill-switch in SiteJob Connect):
    // beide wissen de lokale credentials. Zonder de suspended-tak zou een
    // suspended-push doorvallen naar de config-update hieronder en de koppeling
    // ten onrechte als actief laten staan.
    if (body.action === "disconnect" || body.action === "suspended") {
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

      console.log(`Exact ${body.action} for org:`, config.organization_id);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle config push
    const region = body.region || config.region || "nl";
    const baseUrl = regionBaseUrls[region] || regionBaseUrls.nl;

    const { error: updateError } = await serviceClient
      .from("exact_config")
      .update({
        division: body.division,
        company_name: body.company_name || null,
        region,
        base_url: baseUrl,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);

    if (updateError) {
      console.error("Update error:", updateError);
      return new Response("Internal error", { status: 500 });
    }

    console.log("Exact config updated for org:", config.organization_id, "division:", body.division);

    // Register webhook subscriptions in Exact after successful config push
    if (body.division && config.tenant_id && decryptedWebhookSecret) {
      try {
        const tokenData = await getExactToken(config.tenant_id, decryptedWebhookSecret);
        const webhookResult = await registerExactWebhookSubscriptions(tokenData.base_url, tokenData.division, tokenData.access_token);
        console.log("Exact webhook subscriptions checked:", webhookResult);
      } catch (err) {
        // Non-blocking — webhook registration failure shouldn't break the config push
        console.error("Webhook subscription registration failed (non-blocking):", err);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Config error:", err);
    return new Response("Internal error", { status: 500 });
  }
});
