import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  exactApi,
  getExactToken,
  logExactSync,
  odataResults,
  parseExactDate,
  sanitizeExactErrorDetail,
  verifyExactWebhookSecret,
} from "../_shared/exact-helpers.ts";

// Invoice status progression order (higher = later in lifecycle)
const STATUS_ORDER: Record<string, number> = {
  concept: 0,
  definitief: 1,
  verzonden: 2,
  betaald: 3,
  gecrediteerd: 4,
};

/**
 * Exact levert een notificatie tot 10× opnieuw wanneer een eerdere poging faalde.
 * Binnen dit venster beschouwen we hetzelfde event als een herlevering en slaan we
 * het over. Bewust géén permanente dedup: een échte latere wijziging (factuur
 * wordt betaald) heeft hetzelfde event_id en moet wél verwerkt worden.
 */
const WEBHOOK_DEDUP_WINDOW_MS = 5 * 60 * 1000;

type LocalInvoice = {
  id: string;
  status: string | null;
  total: number | null;
  exact_invoice_id: string | null;
};

const ok = () =>
  new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });

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
    const verified = await verifyExactWebhookSecret(req, serviceClient, { requireActive: true });
    if (!verified?.config.tenant_id) {
      console.error("No active Exact config found for webhook");
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const matchedConfig = {
      id: verified.config.id,
      organization_id: verified.config.organization_id,
      tenant_id: verified.config.tenant_id,
    };
    const decryptedSecret = verified.webhookSecret;

    // ── Idempotentie ──────────────────────────────────────────────────────────
    const eventId = `${body.Division ?? "?"}:${body.Topic ?? "?"}:${body.EventAction ?? "?"}:${body.Key ?? "?"}`;
    const { data: previous } = await serviceClient
      .from("exact_webhook_events")
      .select("id, processed_at")
      .eq("organization_id", matchedConfig.organization_id)
      .eq("event_id", eventId)
      .maybeSingle();

    if (previous?.processed_at) {
      const age = Date.now() - new Date(previous.processed_at).getTime();
      if (age >= 0 && age < WEBHOOK_DEDUP_WINDOW_MS) {
        console.log("Exact webhook duplicate binnen retry-venster, overgeslagen:", eventId);
        return ok();
      }
    }

    await serviceClient
      .from("exact_webhook_events")
      .upsert(
        {
          organization_id: matchedConfig.organization_id,
          event_id: eventId,
          topic: body.Topic ?? null,
          event_action: body.EventAction ?? null,
          exact_key: body.Key ?? null,
          processed_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,event_id" },
      );

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

    if (body.Topic === "SalesInvoices" && (body.EventAction === "Update" || body.EventAction === "Create")) {
      await handleSalesInvoiceEvent(serviceClient, matchedConfig, decryptedSecret!, body);
    }

    // Always return 200
    return ok();
  } catch (err) {
    console.error("Webhook error:", sanitizeExactErrorDetail(err));
    // Always return 200 to prevent Exact retry storms
    return ok();
  }
});

/**
 * Bepaalt of de factuur volledig betaald is. Exact's SalesInvoice-status zegt
 * daar niets over (50 = "verwerkt", niet "betaald"); de openstaande post leeft op
 * cashflow/Receivables. Geeft null terug wanneer we het niet zeker weten.
 */
async function isInvoiceFullyPaid(
  tokenData: Parameters<typeof exactApi>[0],
  invoiceNumber: unknown,
): Promise<{ paid: boolean; paidAt: Date | null } | null> {
  const number = Number(invoiceNumber);
  if (!Number.isFinite(number) || number <= 0) return null;

  try {
    const response = await exactApi(tokenData, "cashflow/Receivables", {
      query: {
        $select: "InvoiceNumber,IsFullyPaid,Status,EndDate",
        $filter: `InvoiceNumber eq ${number}`,
        $top: "10",
      },
    });
    const rows = odataResults<{ IsFullyPaid?: boolean; EndDate?: unknown }>(response);
    if (rows.length === 0) return null;

    const settled = rows.find((row) => row.IsFullyPaid === true);
    if (!settled) return { paid: false, paidAt: null };
    return { paid: true, paidAt: parseExactDate(settled.EndDate) };
  } catch (err) {
    // Ontbrekende scope of een tijdelijke fout mag de statusverwerking niet breken.
    console.warn("Exact: betaalstatus niet op te halen:", sanitizeExactErrorDetail(err));
    return null;
  }
}

/**
 * Handle SalesInvoice update/create webhook.
 * Maps Exact status + openstaande post to JA Werkt invoice status (forward-only).
 */
async function handleSalesInvoiceEvent(
  serviceClient: any,
  config: { organization_id: string; tenant_id: string },
  webhookSecret: string,
  webhook: { Key: string; EventAction: string },
) {
  const startedAt = Date.now();
  try {
    const { data: invoiceRaw } = await serviceClient
      .from("invoices")
      .select("id, status, total, exact_invoice_id")
      .eq("exact_invoice_id", webhook.Key)
      .eq("organization_id", config.organization_id)
      .single();
    const invoice = invoiceRaw as LocalInvoice | null;

    if (!invoice) {
      console.log("No local invoice found for Exact Key:", webhook.Key);
      return;
    }

    let tokenData;
    try {
      tokenData = await getExactToken(config.tenant_id, webhookSecret);
    } catch (err) {
      console.error("Could not get token for webhook processing:", sanitizeExactErrorDetail(err));
      await logExactSync(serviceClient, {
        organizationId: config.organization_id,
        direction: "inbound",
        entityType: "invoice",
        entityId: invoice.id,
        operation: "status_sync",
        status: "failed",
        errorDetail: sanitizeExactErrorDetail(err),
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const exactInvoice = await exactApi<{ d?: Record<string, unknown> }>(
      tokenData,
      `salesinvoice/SalesInvoices(guid'${webhook.Key}')`,
      { query: { $select: "InvoiceID,InvoiceNumber,StatusCode,AmountDC" } },
    ).then((response) => response?.d ?? null).catch((err) => {
      console.error("Failed to fetch Exact invoice:", sanitizeExactErrorDetail(err));
      return null;
    });

    if (!exactInvoice) return;

    // Exact SalesInvoice StatusCode: 10=Concept, 20=Open, 50=Verwerkt (geboekt).
    // 50 betekent NIET betaald — betaald leiden we af uit de openstaande post.
    const statusCode = Number(exactInvoice.StatusCode);
    let newStatus: string | null = null;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (statusCode === 20 || statusCode === 50) {
      newStatus = "verzonden";
    }

    if (statusCode === 50) {
      const payment = await isInvoiceFullyPaid(tokenData, exactInvoice.InvoiceNumber);
      if (payment?.paid) {
        newStatus = "betaald";
        updates.paid_at = (payment.paidAt ?? new Date()).toISOString();
        if (invoice.total !== null && invoice.total !== undefined) {
          updates.paid_amount = invoice.total;
        }
      }
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

    await logExactSync(serviceClient, {
      organizationId: config.organization_id,
      direction: "inbound",
      entityType: "invoice",
      entityId: invoice.id,
      operation: "status_sync",
      status: "success",
      exactId: webhook.Key,
      durationMs: Date.now() - startedAt,
      payload: { from: currentStatus, to: newStatus, exact_status_code: statusCode },
    });
  } catch (err) {
    console.error("Error processing SalesInvoice webhook:", sanitizeExactErrorDetail(err));
  }
}
