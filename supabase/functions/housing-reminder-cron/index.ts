// housing-reminder-cron — flags housing issues as recruiter_tasks
//
// Two checks per organization:
//   1. Properties whose `rental_contract_end_date` is within 90 days from today.
//   2. Units whose `current_occupancy` exceeds `capacity` (overbooking).
//
// Modes:
//   - **User mode** (default): caller is an authenticated user, runs only for their org.
//   - **Cron mode**: triggered by pg_cron with `x-cron-secret` header, runs over all orgs.
//
// Idempotent: skips creating a task if an open recruiter_task with the same
// related_entity_id + category already exists.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const REMINDER_WINDOW_DAYS = 90;
const CATEGORY_CONTRACT = "huisvesting_huurcontract";
const CATEGORY_OVERBOOKING = "huisvesting_overbezetting";

interface CheckResult {
  org_id: string;
  contract_tasks_created: number;
  overbooking_tasks_created: number;
  skipped_existing: number;
}

async function runForOrg(admin: any, orgId: string): Promise<CheckResult> {
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + REMINDER_WINDOW_DAYS);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  let contractTasks = 0;
  let overbookingTasks = 0;
  let skipped = 0;

  // 1) Rental contracts expiring within window
  const { data: properties } = await admin
    .from("properties")
    .select("id, name, address_street, address_city, rental_contract_end_date")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .not("rental_contract_end_date", "is", null)
    .lte("rental_contract_end_date", cutoffStr);

  for (const p of (properties ?? []) as any[]) {
    const { data: existing } = await admin
      .from("recruiter_tasks")
      .select("id")
      .eq("organization_id", orgId)
      .eq("related_entity_type", "property")
      .eq("related_entity_id", p.id)
      .eq("category", CATEGORY_CONTRACT)
      .eq("status", "open")
      .maybeSingle();
    if (existing) {
      skipped++;
      continue;
    }
    const label = p.name?.trim() || `${p.address_street}, ${p.address_city}`;
    await admin.from("recruiter_tasks").insert({
      organization_id: orgId,
      title: `Huurcontract verloopt: ${label}`,
      description: `Het huurcontract voor pand "${label}" verloopt op ${p.rental_contract_end_date}. Onderhandel verlenging of organiseer einde-bewoning.`,
      category: CATEGORY_CONTRACT,
      priority: "medium",
      status: "open",
      related_entity_type: "property",
      related_entity_id: p.id,
      due_date: p.rental_contract_end_date,
      ai_generated: true,
      ai_reasoning: `Auto-gegenereerd door housing-reminder-cron (huurcontract <= ${REMINDER_WINDOW_DAYS} dagen).`,
    } as any);
    contractTasks++;
  }

  // 2) Overbooked units (current_occupancy > capacity)
  const { data: units } = await admin
    .from("v_unit_occupancy")
    .select("unit_id, unit_name, property_name, capacity, current_occupancy")
    .eq("organization_id", orgId);

  for (const u of (units ?? []) as any[]) {
    if (Number(u.current_occupancy) <= Number(u.capacity)) continue;
    const { data: existing } = await admin
      .from("recruiter_tasks")
      .select("id")
      .eq("organization_id", orgId)
      .eq("related_entity_type", "unit")
      .eq("related_entity_id", u.unit_id)
      .eq("category", CATEGORY_OVERBOOKING)
      .eq("status", "open")
      .maybeSingle();
    if (existing) {
      skipped++;
      continue;
    }
    await admin.from("recruiter_tasks").insert({
      organization_id: orgId,
      title: `Overbezetting: ${u.property_name} - ${u.unit_name}`,
      description: `Unit "${u.unit_name}" in pand "${u.property_name}" heeft ${u.current_occupancy} bewoners voor capaciteit ${u.capacity}. Verplaats een bewoner of pas de capaciteit aan.`,
      category: CATEGORY_OVERBOOKING,
      priority: "high",
      status: "open",
      related_entity_type: "unit",
      related_entity_id: u.unit_id,
      ai_generated: true,
      ai_reasoning: "Auto-gegenereerd door housing-reminder-cron (current_occupancy > capacity).",
    } as any);
    overbookingTasks++;
  }

  return {
    org_id: orgId,
    contract_tasks_created: contractTasks,
    overbooking_tasks_created: overbookingTasks,
    skipped_existing: skipped,
  };
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
      // Cron mode: loop all active organizations
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

    // User mode: require auth + scope to user's org
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const anon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await anon.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("id", userData.user.id)
      .single();
    if (!profile?.organization_id) return json({ error: "No organization" }, 403);

    const result = await runForOrg(admin, profile.organization_id);
    return json({ mode: "user", result });
  } catch (err: any) {
    console.error("housing-reminder-cron error:", err);
    return json({ error: err.message ?? String(err) }, 500);
  }
});
