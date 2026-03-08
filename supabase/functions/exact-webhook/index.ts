import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
      },
    });
  }

  try {
    const webhookSecret = req.headers.get("X-Webhook-Secret");
    if (!webhookSecret) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await req.json();
    console.log("Exact webhook received:", {
      topic: body.Topic,
      division: body.Division,
      action: body.EventAction,
      key: body.Key,
    });

    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Find config by webhook_secret
    const { data: configs } = await serviceClient
      .from("exact_config")
      .select("*")
      .eq("webhook_secret", webhookSecret);

    if (!configs || configs.length === 0) {
      console.error("No config found for webhook secret");
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const config = configs[0];

    // Log the webhook event in audit_log for traceability
    await serviceClient.from("audit_log").insert({
      organization_id: config.organization_id,
      action: "create",
      table_name: "exact_webhook",
      new_values: {
        topic: body.Topic,
        division: body.Division,
        event_action: body.EventAction,
        key: body.Key,
        endpoint: body.ExactOnlineEndpoint,
      },
    });

    console.log("Exact webhook processed for org:", config.organization_id, "topic:", body.Topic);

    // Always return 200
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
});
