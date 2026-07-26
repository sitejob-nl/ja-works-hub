import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders,
  jsonOk,
  jsonError,
  isOutboundWhatsAppConfigured,
  isOutboundWhatsAppPaused,
  normalizePhone,
  sendOutboundWhatsApp,
} from "../_shared/whatsapp-utils.ts";
import { getWhatsAppAutomationSettings } from "../_shared/whatsapp-automation-settings.ts";
import { requireInternalProfile } from "../_shared/auth.ts";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [60, 300, 900]; // 1min, 5min, 15min in seconds

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { campaign_id } = await req.json();
    if (!campaign_id) return jsonError("campaign_id is verplicht", 400);

    const cronSecret = req.headers.get("X-Cron-Secret");
    const expectedCronSecret = Deno.env.get("CRON_SECRET");
    let orgId: string;
    let userId: string | null;

    if (expectedCronSecret && cronSecret === expectedCronSecret) {
      const { data: camp } = await serviceClient
        .from("bulk_campaigns")
        .select("organization_id, created_by")
        .eq("id", campaign_id)
        .single();
      if (!camp) return jsonError("Campagne niet gevonden", 404);
      orgId = camp.organization_id;
      userId = camp.created_by ?? null;
    } else {
      const auth = await requireInternalProfile(req, corsHeaders);
      if (auth instanceof Response) return auth;
      orgId = auth.organizationId;
      userId = auth.userId;
    }

    // Load campaign — verify org ownership and valid status
    const { data: campaign, error: campError } = await serviceClient
      .from("bulk_campaigns")
      .select("*")
      .eq("id", campaign_id)
      .eq("organization_id", orgId)
      .single();

    if (campError || !campaign) return jsonError("Campagne niet gevonden", 404);
    if (!["draft", "running", "scheduled", "paused"].includes(campaign.status)) {
      return jsonError("Campagne kan niet worden verwerkt vanuit deze status", 400);
    }

    const automation = await getWhatsAppAutomationSettings(serviceClient, orgId);
    if (!automation.bulk_enabled) {
      return jsonError("WhatsApp bulkcommunicatie is uitgeschakeld voor deze organisatie", 403);
    }

    const rateLimitPerMinute = automation.bulk_rate_limit_per_minute;
    const rateLimitPerHour = automation.bulk_rate_limit_per_hour;
    const batchSize = Math.max(1, automation.bulk_batch_size);
    const maxConcurrent = Math.max(1, automation.bulk_max_concurrent);
    const delayBetweenBatchesMs = Math.max(0, automation.bulk_delay_between_batches_ms);

    if (campaign.status === "scheduled" && campaign.scheduled_at && new Date(campaign.scheduled_at).getTime() > Date.now()) {
      return jsonError("Campagne staat gepland voor later", 400);
    }

    // Kill-switch: globale WhatsApp-pauze blokkeert de hele campagne (geen bulk-blast).
    if (await isOutboundWhatsAppPaused(serviceClient, orgId)) {
      await serviceClient.from("bulk_campaigns").update({ status: "paused" }).eq("id", campaign_id);
      return jsonOk({ paused: true, message: "WhatsApp staat op pauze (kill-switch). Campagne niet verwerkt." });
    }

    if (!await isOutboundWhatsAppConfigured(serviceClient, orgId)) {
      await serviceClient
        .from("bulk_campaigns")
        .update({ status: "cancelled" })
        .eq("id", campaign_id);
      return jsonError("WhatsApp niet geconfigureerd voor deze organisatie", 400);
    }

    // Set status to running with timestamp
    await serviceClient
      .from("bulk_campaigns")
      .update({
        status: "running",
        started_at: campaign.started_at ?? new Date().toISOString(),
        rate_limit_per_minute: rateLimitPerMinute,
        rate_limit_per_hour: rateLimitPerHour,
      })
      .eq("id", campaign_id);

    await ensureRecipients(serviceClient, campaign, orgId);

    // Load recipients: pending OR (failed AND retry_count < MAX_RETRIES and retry time has passed)
    const { data: recipients } = await serviceClient
      .from("campaign_recipients")
      .select("id, candidate_id, status, retry_count, candidates!inner(first_name, last_name, phone)")
      .eq("campaign_id", campaign_id)
      .or(`status.eq.pending,and(status.eq.failed,retry_count.lt.${MAX_RETRIES})`)
      .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
      .order("id");

    if (!recipients?.length) {
      const { data: deferredRetries } = await serviceClient
        .from("campaign_recipients")
        .select("id")
        .eq("campaign_id", campaign_id)
        .eq("status", "failed")
        .lt("retry_count", MAX_RETRIES)
        .gt("next_retry_at", new Date().toISOString())
        .limit(1);

      if (deferredRetries?.length) {
        return jsonOk({ status: "waiting_for_retry", sent: 0, failed: 0 });
      }

      await serviceClient
        .from("bulk_campaigns")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", campaign_id);
      return jsonOk({ status: "completed", sent: 0, failed: 0 });
    }

    let sentCount = 0;
    let failedCount = 0;

    // Process in configurable batches
    for (let i = 0; i < recipients.length; i += batchSize) {
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

      const batch = recipients.slice(i, i + batchSize);

      // Process batch with concurrency limit of MAX_CONCURRENT
      const results = await processWithConcurrency(
        batch,
        maxConcurrent,
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
            const { data: withinMinute } = await serviceClient.rpc("check_rate_limit", {
              p_org_id: orgId,
              p_channel: "whatsapp",
              p_window_type: "minute",
            });
            const { data: withinHour } = await serviceClient.rpc("check_rate_limit", {
              p_org_id: orgId,
              p_channel: "whatsapp",
              p_window_type: "hour",
            });
            if (withinMinute === false || withinHour === false) {
              return { recipientId: recipient.id, success: false, retryable: true, error: "Rate limit bereikt" };
            }

            const result = await sendOutboundWhatsApp(serviceClient, {
              orgId,
              to: candidate.phone,
              type: "text",
              text: { body: messageBody },
              candidateId: recipient.candidate_id,
              sentBy: userId,
              subject: `WhatsApp campagne naar ${phone}`,
            });

            if (result.success) {
              return {
                recipientId: recipient.id,
                success: true,
                communicationId: result.communicationId,
              };
            }

            return {
              recipientId: recipient.id,
              success: false,
              paused: result.paused,
              reason: result.reason,
              retryable: result.reason === "provider_error" && result.httpStatus !== 400,
              error: result.error ?? "WhatsApp versturen mislukt",
            };
          } catch (err) {
            return { recipientId: recipient.id, success: false, error: String(err) };
          }
        }
      );

      // Persist recipient statuses and update batch counts
      for (const result of results) {
        if (result.success) {
          sentCount++;
          await serviceClient.rpc("record_rate_limit", {
            p_org_id: orgId,
            p_channel: "whatsapp",
          });
          await serviceClient
            .from("campaign_recipients")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              communication_id: result.communicationId,
            })
            .eq("id", result.recipientId);
        } else if ((result as any).paused) {
          await serviceClient.from("bulk_campaigns").update({ status: "paused" }).eq("id", campaign_id);
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

      // Update progress — count actuals from DB to avoid stale snapshot issues
      const { count: sentTotal } = await serviceClient
        .from("campaign_recipients")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign_id)
        .eq("status", "sent");

      const { count: failedTotal } = await serviceClient
        .from("campaign_recipients")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign_id)
        .eq("status", "failed");

      await serviceClient
        .from("bulk_campaigns")
        .update({
          sent_count: sentTotal ?? sentCount,
          failed_count: failedTotal ?? failedCount,
        })
        .eq("id", campaign_id);

      // Configurable delay between batches for rate limiting
      if (i + batchSize < recipients.length && delayBetweenBatchesMs > 0) {
        await new Promise((r) => setTimeout(r, delayBetweenBatchesMs));
      }
    }

    // Mark completed only if no pending or retryable recipients remain
    const { data: remaining } = await serviceClient
      .from("campaign_recipients")
      .select("id")
      .eq("campaign_id", campaign_id)
      .or(`status.eq.pending,and(status.eq.failed,retry_count.lt.${MAX_RETRIES})`)
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

async function ensureRecipients(serviceClient: any, campaign: any, orgId: string) {
  const { count } = await serviceClient
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id);

  if ((count ?? 0) > 0) return;

  const { data: candidates, error } = await serviceClient.rpc("get_campaign_candidates", {
    p_org_id: orgId,
    p_filter: campaign.segment_filter ?? {},
    p_channel: "whatsapp",
  });

  if (error) throw error;

  const rows = (candidates ?? []).map((candidate: any) => ({
    organization_id: orgId,
    campaign_id: campaign.id,
    candidate_id: candidate.candidate_id,
    status: "pending",
  }));

  if (rows.length > 0) {
    await serviceClient
      .from("campaign_recipients")
      .upsert(rows, { onConflict: "campaign_id,candidate_id", ignoreDuplicates: true });
  }

  await serviceClient
    .from("bulk_campaigns")
    .update({ total_recipients: rows.length })
    .eq("id", campaign.id);
}

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
