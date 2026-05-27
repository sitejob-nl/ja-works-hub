// Automated WhatsApp dispatcher — wordt aangeroepen door pg_cron.
// Handelt verschillende jobs af via ?job=<name> query parameter of body.job.
//
// Jobs:
//   - onboarding-reminders: reminder sturen aan kandidaten met een openstaande
//     onboarding-token op dag 1, 3 en 7 na aanmaak. Slaat tokens over die
//     al gebruikt, verlopen of opted-out zijn.
//
// Authenticatie: header X-Automated-Key moet overeenkomen met AUTOMATED_KEY env var.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getWhatsAppCredentials, normalizePhone, META_API_BASE } from "../_shared/whatsapp-utils.ts";
import { getWhatsAppAutomationSettings, mergeTemplate } from "../_shared/whatsapp-automation-settings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automated-key, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function sendWhatsApp(
  service: SupabaseClient,
  orgId: string,
  to: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const creds = await getWhatsAppCredentials(service, orgId);
  if (!creds) return { ok: false, error: "WhatsApp niet geconfigureerd" };

  const res = await fetch(`${META_API_BASE}/${creds.phone_number_id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizePhone(to).replace("+", ""),
      type: "text",
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `Meta ${res.status}: ${body.slice(0, 200)}` };
  }
  return { ok: true };
}

/**
 * Onboarding reminder: voor elke onboarding_token die op dag 1, 3 of 7
 * (±12 uur rond dat tijdstip) is aangemaakt en nog niet gebruikt, stuur
 * een WhatsApp reminder aan de kandidaat.
 *
 * Dedup-check via x-reminder-sent-{dayN} tag in communications body
 * (simpel approach zonder dedicated reminder_sent_at kolom).
 */
async function runOnboardingReminders(service: SupabaseClient) {
  const now = Date.now();
  const windowHours = 12;
  const { data: orgs } = await service
    .from("organizations")
    .select("id, name, settings");

  const results: Record<string, { sent: number; skipped: number; errors: string[] }> = {};

  for (const org of (orgs ?? []) as any[]) {
    const settings = await getWhatsAppAutomationSettings(service, org.id);
    if (!settings.onboarding_reminders_enabled) continue;

    for (const day of settings.onboarding_reminder_days) {
      const key = `${org.id}:day${day}`;
      results[key] = { sent: 0, skipped: 0, errors: [] };
      const center = now - day * 24 * 3600_000;
      const from = new Date(center - windowHours * 3600_000).toISOString();
      const to = new Date(center + windowHours * 3600_000).toISOString();

      const { data: tokens } = await service
        .from("onboarding_tokens")
        .select(`
          id, token, organization_id, candidate_id, created_at, expires_at, used_at,
          candidate:candidate_id(first_name, phone)
        `)
        .eq("organization_id", org.id)
        .gte("created_at", from)
        .lte("created_at", to)
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString());

      for (const t of (tokens ?? []) as any[]) {
        const cand = t.candidate;
        if (!cand?.phone) {
          results[key].skipped++;
          continue;
        }

        // Dedup: check of we al een reminder voor deze token+dag hebben gestuurd
        const marker = `[onboarding-reminder:${t.id}:day${day}]`;
        const { data: existing } = await service
          .from("communications")
          .select("id")
          .eq("candidate_id", t.candidate_id)
          .like("body", `%${marker}%`)
          .limit(1);

        if (existing && existing.length > 0) {
          results[key].skipped++;
          continue;
        }

        // Opt-out check
        const { data: pref } = await service
          .from("communication_preferences")
          .select("opted_out")
          .eq("candidate_id", t.candidate_id)
          .eq("channel", "whatsapp")
          .eq("organization_id", t.organization_id)
          .maybeSingle();
        if (pref?.opted_out) {
          results[key].skipped++;
          continue;
        }

        const hoursLeft = Math.round((new Date(t.expires_at).getTime() - now) / 3600_000);
        const daysLeft = Math.max(1, Math.round(hoursLeft / 24));
        const defaultMessage = day >= 7
          ? `Hoi ${cand.first_name}, je onboarding-link verloopt over ${daysLeft} ${daysLeft === 1 ? "dag" : "dagen"}. Vul je gegevens aan via de link die je eerder hebt ontvangen. Lukt het niet? Laat het ons weten.\n\n— JA Werkt`
          : `Hoi ${cand.first_name}, we missen nog je profielgegevens. Vul ze snel aan via de onboarding-link die je hebt ontvangen, dan kunnen we met plaatsen aan de slag. Lukt het niet? Stuur ons een berichtje.\n\n— JA Werkt`;
        const message = mergeTemplate(defaultMessage, {
          first_name: cand.first_name,
          dagen_over: daysLeft,
          organization: org.name ?? "JA Werkt",
        });

        const result = await sendWhatsApp(service, t.organization_id, cand.phone, message);

        if (result.ok) {
          results[key].sent++;
          await service.from("communications").insert({
            organization_id: t.organization_id,
            candidate_id: t.candidate_id,
            channel: "whatsapp",
            direction: "outbound",
            subject: `Onboarding reminder (dag ${day})`,
            body: `${marker} ${message}`,
            sent_at: new Date().toISOString(),
          });
        } else {
          results[key].errors.push(`${t.candidate_id}: ${result.error}`);
        }
      }
    }
  }

  return results;
}

async function runScheduledCampaigns(service: SupabaseClient, automatedKey: string | null, cronSecret: string | null) {
  const { data: campaigns } = await service
    .from("bulk_campaigns")
    .select("id")
    .eq("channel", "whatsapp")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at")
    .limit(25);

  const results: Array<{ campaign_id: string; ok: boolean; error?: string }> = [];
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  for (const campaign of campaigns ?? []) {
    try {
      const authHeaders = automatedKey
        ? { "X-Automated-Key": automatedKey }
        : { "X-Cron-Secret": cronSecret ?? "" };
      const res = await fetch(`${supabaseUrl}/functions/v1/bulk-campaign-processor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({ campaign_id: campaign.id }),
      });
      const body = await res.text();
      results.push({
        campaign_id: campaign.id,
        ok: res.ok,
        error: res.ok ? undefined : body.slice(0, 250),
      });
    } catch (err) {
      results.push({ campaign_id: campaign.id, ok: false, error: String(err) });
    }
  }

  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const providedKey = req.headers.get("X-Automated-Key");
    const providedCronSecret = req.headers.get("X-Cron-Secret");
    const expectedKey = Deno.env.get("AUTOMATED_KEY");
    const expectedCronSecret = Deno.env.get("CRON_SECRET");
    const hasAutomatedKey = !!expectedKey && providedKey === expectedKey;
    const hasCronSecret = !!expectedCronSecret && providedCronSecret === expectedCronSecret;
    if (!hasAutomatedKey && !hasCronSecret) {
      return json({ error: "Unauthorized" }, 401);
    }

    const url = new URL(req.url);
    let job = url.searchParams.get("job");
    if (!job) {
      try {
        const body = await req.json();
        job = body.job;
      } catch {
        // no body
      }
    }
    if (!job) return json({ error: "job parameter required" }, 400);

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    switch (job) {
      case "onboarding-reminders": {
        const result = await runOnboardingReminders(service);
        return json({ job, result });
      }
      case "scheduled-campaigns": {
        const result = await runScheduledCampaigns(service, expectedKey ?? null, expectedCronSecret ?? null);
        return json({ job, result });
      }
      default:
        return json({ error: `Unknown job: ${job}` }, 400);
    }
  } catch (err: any) {
    console.error("automated-messages error:", err);
    return json({ error: err.message ?? "Unknown error" }, 500);
  }
});
