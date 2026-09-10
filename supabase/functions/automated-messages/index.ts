// Automated WhatsApp dispatcher — wordt aangeroepen door pg_cron.
// Handelt verschillende jobs af via ?job=<name> query parameter of body.job.
//
// Jobs:
//   - onboarding-reminders: reminder sturen aan kandidaten met een openstaande
//     onboarding-token op dag 1, 3 en 7 na aanmaak. Slaat tokens over die
//     al gebruikt, verlopen of opted-out zijn.
//
// Authenticatie: header X-Cron-Secret moet overeenkomen met CRON_SECRET env var.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOutboundWhatsApp } from "../_shared/whatsapp-utils.ts";
import { getWhatsAppAutomationSettings, mergeTemplate } from "../_shared/whatsapp-automation-settings.ts";
import { captureEdgeException, withCronMonitor } from "../_shared/sentry.ts";

const FN = "automated-messages";
// pg_cron leest de crontab in de Postgres-tijdzone, en die staat op productie op UTC.
// Sentry moet dus óók UTC krijgen (de helper default is Europe/Amsterdam) — anders staat
// elke monitor 1-2 uur scheef en meldt Sentry runs als 'gemist' die gewoon gedraaid zijn.
const CRON_TZ = "UTC";

const JOB_ONBOARDING_REMINDERS = "onboarding-reminders";
const JOB_SCHEDULED_CAMPAIGNS = "scheduled-campaigns";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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
          .not("sent_at", "is", null)
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

        const result = await sendOutboundWhatsApp(service, {
          orgId: t.organization_id,
          to: cand.phone,
          type: "text",
          text: { body: message },
          candidateId: t.candidate_id,
          subject: `Onboarding reminder (dag ${day})`,
          communicationBody: `${marker} ${message}`,
        });

        if (result.success) {
          results[key].sent++;
        } else if (result.paused) {
          results[key].skipped++;
        } else {
          results[key].errors.push(`${t.candidate_id}: ${result.error}`);
        }
      }
    }
  }

  return results;
}

async function runScheduledCampaigns(service: SupabaseClient, cronSecret: string | null) {
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
      const authHeaders: Record<string, string> = cronSecret
        ? { "X-Cron-Secret": cronSecret }
        : {};
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
      // Deze job heeft bewust geen check-in-monitor (zie Deno.serve), dus een falende
      // campagne is alleen zichtbaar als we 'm hier expliciet melden. Response ongewijzigd.
      if (!res.ok) {
        await captureEdgeException(
          new Error(`bulk-campaign-processor gaf HTTP ${res.status}`),
          { fn: FN, job: JOB_SCHEDULED_CAMPAIGNS, extra: { campaign_id: campaign.id, status: res.status } },
        );
      }
    } catch (err) {
      results.push({ campaign_id: campaign.id, ok: false, error: String(err) });
      await captureEdgeException(err, {
        fn: FN,
        job: JOB_SCHEDULED_CAMPAIGNS,
        extra: { campaign_id: campaign.id },
      });
    }
  }

  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  // Buiten de try zodat het catch-blok weet welke job faalde, en of withCronMonitor de
  // fout al naar Sentry heeft gestuurd (anders zou hij dubbel binnenkomen).
  let job: string | null = null;
  let reportedByMonitor = false;

  try {
    const providedCronSecret = req.headers.get("X-Cron-Secret");
    const expectedCronSecret = Deno.env.get("CRON_SECRET");
    const hasCronSecret = !!expectedCronSecret && providedCronSecret === expectedCronSecret;
    if (!hasCronSecret) {
      return json({ error: "Unauthorized" }, 401);
    }

    const url = new URL(req.url);
    job = url.searchParams.get("job");
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
      case JOB_ONBOARDING_REMINDERS: {
        // pg_cron-job 'automated-onboarding-reminders' (0 9 * * *): één run per dag, en een
        // gemiste run betekent dat de reminders die dag niet zijn verstuurd → check-in-monitor.
        reportedByMonitor = true;
        const result = await withCronMonitor(
          {
            monitorSlug: "automated-onboarding-reminders",
            schedule: "0 9 * * *",
            timezone: CRON_TZ,
            maxRuntimeMinutes: 10,
            checkinMarginMinutes: 5,
            fn: FN,
          },
          () => runOnboardingReminders(service),
        );
        return json({ job, result });
      }
      case JOB_SCHEDULED_CAMPAIGNS: {
        // BEWUST GEEN check-in-monitor: deze job draait */5 (288 runs/dag) en is self-healing —
        // een overgeslagen run pakt dezelfde 'scheduled' campagnes 5 minuten later alsnog op,
        // dus een 'gemiste run'-alert is ruis die de 6 dagelijkse alerts zou verdringen.
        // Fouten worden wél gemeld via captureEdgeException in runScheduledCampaigns().
        const result = await runScheduledCampaigns(service, expectedCronSecret ?? null);
        return json({ job, result });
      }
      default:
        return json({ error: `Unknown job: ${job}` }, 400);
    }
  } catch (err: any) {
    console.error("automated-messages error:", err);
    // withCronMonitor rapporteert de fouten van het werk dat het omhult al zelf.
    if (!reportedByMonitor) {
      await captureEdgeException(err, { fn: FN, job: job ?? undefined });
    }
    return json({ error: err.message ?? "Unknown error" }, 500);
  }
});
