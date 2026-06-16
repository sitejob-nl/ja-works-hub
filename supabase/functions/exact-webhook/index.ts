import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, getExactToken } from "../_shared/exact-helpers.ts";

// Invoice status progression order (higher = later in lifecycle)
const STATUS_ORDER: Record<string, number> = {
  concept: 0,
  definitief: 1,
  verzonden: 2,
  betaald: 3,
  gecrediteerd: 4,
};

type LocalInvoice = {
  id: string;
  status: string | null;
  exact_invoice_id: string | null;
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
    console.log("Exact webhook received:", {
      topic: body.Topic,
      division: body.Division,
      action: body.EventAction,
      key: body.Key,
    });

    const serviceClient = createClient<any>(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get all active exact configs and decrypt to find match
    const { data: configs } = await serviceClient
      .from("exact_config")
      .select("id, organization_id, tenant_id, is_active")
      .eq("is_active", true);

    if (!configs || configs.length === 0) {
      console.error("No active exact configs found");
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Decrypt webhook_secret for each config and find match
    let matchedConfig: { id: string; organization_id: string; tenant_id: string } | null = null;
    let decryptedSecret: string | null = null;
    for (const c of configs) {
      const { data: decrypted } = await serviceClient.rpc("get_exact_token", {
        p_org_id: c.organization_id,
      });
      if (decrypted?.[0]?.decrypted_webhook_secret === webhookSecret) {
        matchedConfig = { id: c.id, organization_id: c.organization_id, tenant_id: c.tenant_id };
        decryptedSecret = decrypted[0].decrypted_webhook_secret;
        break;
      }
    }

    if (!matchedConfig) {
      console.error("No config found for webhook secret");
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Log the webhook event in audit_log for traceability
    await serviceClient.from("audit_log").insert({
      organization_id: matchedConfig.organization_id,
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

    console.log("Exact webhook processed for org:", matchedConfig.organization_id, "topic:", body.Topic);

    // Process topic-specific events
    if (body.Topic === "SalesInvoices" && (body.EventAction === "Update" || body.EventAction === "Create")) {
      await handleSalesInvoiceEvent(serviceClient, matchedConfig, decryptedSecret!, body);
    }

    // Always return 200
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Webhook error:", err);
    // Always return 200 to prevent Exact retry storms
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
});

/**
 * Handle SalesInvoice update/create webhook.
 * Maps Exact StatusCode to JA Werkt invoice status (forward-only).
 */
async function handleSalesInvoiceEvent(
  serviceClient: any,
  config: { organization_id: string; tenant_id: string },
  webhookSecret: string,
  webhook: { Key: string; EventAction: string },
) {
  try {
    // Find local invoice by exact_invoice_id
    const { data: invoiceRaw } = await serviceClient
      .from("invoices")
      .select("id, status, exact_invoice_id")
      .eq("exact_invoice_id", webhook.Key)
      .eq("organization_id", config.organization_id)
      .single();
    const invoice = invoiceRaw as LocalInvoice | null;

    if (!invoice) {
      console.log("No local invoice found for Exact Key:", webhook.Key);
      return;
    }

    // Get fresh token to query Exact for current invoice status
    let tokenData;
    try {
      tokenData = await getExactToken(config.tenant_id, webhookSecret);
    } catch (err) {
      console.error("Could not get token for webhook processing:", err);
      return;
    }

    // Fetch invoice status from Exact
    const exactRes = await fetch(
      `${tokenData.base_url}/api/v1/${tokenData.division}/salesinvoice/SalesInvoices(guid'${webhook.Key}')?$select=InvoiceID,StatusCode,AmountDC`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: "application/json",
        },
      }
    );

    if (!exactRes.ok) {
      console.error("Failed to fetch Exact invoice:", exactRes.status, await exactRes.text());
      return;
    }

    const exactData = await exactRes.json();
    const exactInvoice = exactData?.d;
    if (!exactInvoice) return;

    // Map Exact StatusCode to JA Werkt status
    // Exact: 10=Concept, 20=Open, 50=Verwerkt
    let newStatus: string | null = null;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (exactInvoice.StatusCode === 20) {
      newStatus = "verzonden";
    } else if (exactInvoice.StatusCode === 50) {
      newStatus = "betaald";
      updates.paid_amount = Number(exactInvoice.AmountDC) || null;
      updates.paid_at = new Date().toISOString();
    }

    if (!newStatus) return;

    // Forward-only: only update if new status is further in the lifecycle
    const currentStatus = invoice.status ?? "concept";
    const currentOrder = STATUS_ORDER[currentStatus] ?? -1;
    const newOrder = STATUS_ORDER[newStatus] ?? -1;

    if (newOrder <= currentOrder) {
      console.log(`Skipping status update: ${currentStatus} (${currentOrder}) → ${newStatus} (${newOrder}) — not forward`);
      return;
    }

    updates.status = newStatus;

    await serviceClient.from("invoices").update(updates as any).eq("id", invoice.id);
    console.log(`Invoice ${invoice.id} status updated: ${currentStatus} → ${newStatus}`);

  } catch (err) {
    console.error("Error processing SalesInvoice webhook:", err);
  }
}
