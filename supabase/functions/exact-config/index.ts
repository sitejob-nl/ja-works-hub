import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, getExactToken } from "../_shared/exact-helpers.ts";

const CONNECT_WEBHOOK_ROUTER = "https://xeshjkznwdrxjjhbpisn.supabase.co/functions/v1/exact-webhook-router";

const regionBaseUrls: Record<string, string> = {
  nl: "https://start.exactonline.nl",
  be: "https://start.exactonline.be",
  de: "https://start.exactonline.de",
  uk: "https://start.exactonline.co.uk",
  fr: "https://start.exactonline.fr",
  es: "https://start.exactonline.es",
};

/** Register webhook subscriptions in Exact Online for key topics */
async function registerWebhookSubscriptions(
  baseUrl: string,
  division: number,
  accessToken: string,
) {
  const topics = ["SalesInvoices", "Accounts"];

  for (const topic of topics) {
    try {
      const res = await fetch(
        `${baseUrl}/api/v1/${division}/webhooks/WebhookSubscriptions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            CallbackURL: CONNECT_WEBHOOK_ROUTER,
            Topic: topic,
          }),
        }
      );

      if (res.ok) {
        console.log(`Webhook subscription registered for topic: ${topic}`);
      } else {
        const errBody = await res.text();
        // 409 or duplicate is fine — subscription may already exist
        console.warn(`Webhook subscription for ${topic} response ${res.status}:`, errBody);
      }
    } catch (err) {
      console.error(`Failed to register webhook for ${topic}:`, err);
    }
  }
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

    // Decrypt webhook_secret via RPC and compare
    const { data: decrypted } = await serviceClient.rpc("get_exact_token", {
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
    if (body.division && config.tenant_id && decrypted[0].decrypted_webhook_secret) {
      try {
        const tokenData = await getExactToken(config.tenant_id, decrypted[0].decrypted_webhook_secret);
        await registerWebhookSubscriptions(tokenData.base_url, tokenData.division, tokenData.access_token);
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
