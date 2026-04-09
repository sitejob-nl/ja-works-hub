import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  jsonOk,
  jsonError,
  getAuthenticatedOrg,
  normalizePhone,
  getWhatsAppCredentials,
  META_API_BASE,
} from "../_shared/whatsapp-utils.ts";

const BATCH_SIZE = 50;
const MAX_CONCURRENT = 5;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [60, 300, 900]; // 1min, 5min, 15min in seconds

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
    );

    const auth = await getAuthenticatedOrg(req, supabase);
    if (auth instanceof Response) return auth;
    const { orgId, userId } = auth;

    const { campaign_id } = await req.json();
    if (!campaign_id) return jsonError("campaign_id is verplicht", 400);

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load campaign — verify org ownership and valid status
    const { data: campaign, error: campError } = await serviceClient
      .from("bulk_campaigns")
      .select("*")
      .eq("id", campaign_id)
      .eq("organization_id", orgId)
      .single();

    if (campError || !campaign) return jsonError("Campagne niet gevonden", 404);
    if (campaign.status !== "running" && campaign.status !== "scheduled") {
      return jsonError("Campagne is niet actief (verwacht: running of scheduled)", 400);
    }

    // Set status to running with timestamp
    await serviceClient
      .from("bulk_campaigns")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", campaign_id);

    // Get WhatsApp credentials
    const creds = await getWhatsAppCredentials(serviceClient, orgId);
    if (!creds) {
      await serviceClient
        .from("bulk_campaigns")
        .update({ status: "cancelled" })
        .eq("id", campaign_id);
      return jsonError("WhatsApp niet geconfigureerd voor deze organisatie", 400);
    }

    // Load recipients: pending OR (failed AND retry_count < MAX_RETRIES)
    const { data: recipients } = await serviceClient
      .from("campaign_recipients")
      .select("id, candidate_id, status, retry_count, candidates!inner(first_name, last_name, phone)")
      .eq("campaign_id", campaign_id)
      .or(`status.eq.pending,and(status.eq.failed,retry_count.lt.${MAX_RETRIES})`)
      .order("id");

    if (!recipients?.length) {
      await serviceClient
        .from("bulk_campaigns")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", campaign_id);
      return jsonOk({ status: "completed", sent: 0, failed: 0 });
    }

    let sentCount = 0;
    let failedCount = 0;

    // Process in batches of BATCH_SIZE
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      // Check if campaign was paused or cancelled between batches
      const { data: currentCampaign } = await serviceClient
        .from("bulk_campaigns")
        .select("status")
        .eq("id", campaign_id)
        .single();

      if (currentCampaign?.status === "paused" || currentCampaign?.status === "cancelled") {
        console.log(`Campaign ${campaign_id} stopped: status=${currentCampaign.status}`);
        break;
      }

      const batch = recipients.slice(i, i + BATCH_SIZE);

      // Process batch with concurrency limit of MAX_CONCURRENT
      const results = await processWithConcurrency(
        batch,
        MAX_CONCURRENT,
        async (recipient: any) => {
          const candidate = recipient.candidates;
          if (!candidate?.phone) {
            return { recipientId: recipient.id, success: false, error: "Geen telefoonnummer" };
          }

          const phone = normalizePhone(candidate.phone);

          // Merge template fields
          let messageBody = campaign.message_template ?? "";
          messageBody = messageBody.replace(/\{\{first_name\}\}/g, candidate.first_name ?? "");
          messageBody = messageBody.replace(/\{\{last_name\}\}/g, candidate.last_name ?? "");
          messageBody = messageBody.replace(
            /\{\{full_name\}\}/g,
            `${candidate.first_name ?? ""} ${candidate.last_name ?? ""}`.trim()
          );

          try {
            // Send directly to Meta API — avoids double rate limiting via whatsapp-send
            const metaResponse = await fetch(
              `${META_API_BASE}/${creds.phone_number_id}/messages`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${creds.access_token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  messaging_product: "whatsapp",
                  recipient_type: "individual",
                  to: phone.replace("+", ""),
                  type: "text",
                  text: { body: messageBody },
                }),
              }
            );

            const result = await metaResponse.json();

            if (metaResponse.ok) {
              const waMessageId = result.messages?.[0]?.id;

              // Log communication record on success
              const { data: comm } = await serviceClient
                .from("communications")
                .insert({
                  organization_id: orgId,
                  channel: "whatsapp",
                  direction: "outbound",
                  subject: `WhatsApp campagne naar ${phone}`,
                  body: messageBody,
                  candidate_id: recipient.candidate_id,
                  sent_by: userId,
                  sent_at: new Date().toISOString(),
                  whatsapp_message_id: waMessageId,
                  whatsapp_status: "pending",
                  message_type: "text",
                })
                .select("id")
                .single();

              return {
                recipientId: recipient.id,
                success: true,
                communicationId: comm?.id,
              };
            } else {
              return {
                recipientId: recipient.id,
                success: false,
                error: result?.error?.message ?? "Meta API error",
              };
            }
          } catch (err) {
            return { recipientId: recipient.id, success: false, error: String(err) };
          }
        }
      );

      // Persist recipient statuses and update batch counts
      for (const result of results) {
        if (result.success) {
          sentCount++;
          await serviceClient
            .from("campaign_recipients")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              communication_id: result.communicationId,
            })
            .eq("id", result.recipientId);
        } else {
          failedCount++;
          const recipient = batch.find((r: any) => r.id === result.recipientId);
          const retryCount = (recipient?.retry_count ?? 0) + 1;
          const nextRetry =
            retryCount < MAX_RETRIES
              ? new Date(Date.now() + RETRY_DELAYS[retryCount - 1] * 1000).toISOString()
              : null;

          await serviceClient
            .from("campaign_recipients")
            .update({
              status: "failed",
              error_message: result.error,
              retry_count: retryCount,
              next_retry_at: nextRetry,
            })
            .eq("id", result.recipientId);
        }
      }

      // Update running totals on campaign after each batch
      await serviceClient
        .from("bulk_campaigns")
        .update({
          sent_count: (campaign.sent_count ?? 0) + sentCount,
          failed_count: (campaign.failed_count ?? 0) + failedCount,
        })
        .eq("id", campaign_id);

      // 2-second delay between batches for rate limiting
      if (i + BATCH_SIZE < recipients.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Mark completed only if no pending recipients remain
    const { data: remaining } = await serviceClient
      .from("campaign_recipients")
      .select("id")
      .eq("campaign_id", campaign_id)
      .eq("status", "pending")
      .limit(1);

    if (!remaining?.length) {
      await serviceClient
        .from("bulk_campaigns")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", campaign_id);
    }

    return jsonOk({ status: "ok", sent: sentCount, failed: failedCount });
  } catch (err) {
    console.error("bulk-campaign-processor error:", err);
    return jsonError("Interne fout", 500);
  }
});

/**
 * Process an array of items with a maximum concurrency limit.
 * Uses a semaphore approach: maintains a pool of active promises,
 * waits for one to complete before starting the next when at capacity.
 */
async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const executing = new Set<Promise<void>>();

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const itemIdx = idx;

    const task = fn(item).then((result) => {
      results[itemIdx] = result;
    });

    const wrapper: Promise<void> = task.finally(() => {
      executing.delete(wrapper);
    });
    executing.add(wrapper);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}
