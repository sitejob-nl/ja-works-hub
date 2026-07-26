// check-vehicle-apk — flags vehicles whose APK expires within 60 days as recruiter_tasks
//
// Modes:
//   - **User mode** (default): active internal user, scoped to own org.
//   - **Cron mode**: triggered by pg_cron with `x-cron-secret` header, loops all active orgs.
//
// Idempotent: skips creating a task if an open recruiter_task with the same
// related_entity_id + category already exists.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalProfile } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const REMINDER_WINDOW_DAYS = 60;
const CATEGORY_APK = "voertuig_apk";

interface CheckResult {
  org_id: string;
  apk_tasks_created: number;
  skipped_existing: number;
}

async function runForOrg(admin: any, orgId: string): Promise<CheckResult> {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + REMINDER_WINDOW_DAYS);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  let created = 0;
  let skipped = 0;

  const { data: vehicles } = await admin
    .from("vehicles")
    .select("id, license_plate, brand, model, apk_expiry, status")
    .eq("organization_id", orgId)
    .neq("status", "uit_dienst")
    .not("apk_expiry", "is", null)
    .lte("apk_expiry", cutoffStr);

  for (const v of (vehicles ?? []) as any[]) {
    const { data: existing } = await admin
      .from("recruiter_tasks")
      .select("id")
      .eq("organization_id", orgId)
      .eq("related_entity_type", "vehicle")
      .eq("related_entity_id", v.id)
      .eq("category", CATEGORY_APK)
      .eq("status", "open")
      .maybeSingle();
    if (existing) {
      skipped++;
      continue;
    }

    const isExpired = v.apk_expiry < todayStr;
    const label = [v.brand, v.model].filter(Boolean).join(" ") || v.license_plate;
    const priority = isExpired ? "high" : "medium";
    const title = isExpired
      ? `APK verlopen: ${v.license_plate}`
      : `APK verloopt: ${v.license_plate}`;
    const description = isExpired
      ? `De APK van voertuig "${label}" (${v.license_plate}) is verlopen op ${v.apk_expiry}. Plan direct een keuring.`
      : `De APK van voertuig "${label}" (${v.license_plate}) verloopt op ${v.apk_expiry}. Plan tijdig een keuring.`;

    await admin.from("recruiter_tasks").insert({
      organization_id: orgId,
      title,
      description,
      category: CATEGORY_APK,
      priority,
      status: "open",
      related_entity_type: "vehicle",
      related_entity_id: v.id,
      due_date: v.apk_expiry,
      ai_generated: true,
      ai_reasoning: `Auto-gegenereerd door check-vehicle-apk (apk_expiry <= ${REMINDER_WINDOW_DAYS} dagen).`,
    } as any);
    created++;
  }

  return { org_id: orgId, apk_tasks_created: created, skipped_existing: skipped };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const cronSecret = Deno.env.get("CRON_SECRET");
    const provided = req.headers.get("x-cron-secret");
    const isCron = !!cronSecret && provided === cronSecret;

    if (isCron) {
      const { data: orgs } = await admin
        .from("organizations")
        .select("id")
        .eq("is_active", true);
      const results: CheckResult[] = [];
      for (const o of (orgs ?? []) as any[]) {
        results.push(await runForOrg(admin, o.id));
      }
      return json({ mode: "cron", results });
    }

    const auth = await requireInternalProfile(req, corsHeaders);
    if (auth instanceof Response) return auth;
    const result = await runForOrg(admin, auth.organizationId);
    return json({ mode: "user", result });
  } catch (err: any) {
    console.error("check-vehicle-apk error:", err);
    return json({ error: err.message ?? String(err) }, 500);
  }
});
