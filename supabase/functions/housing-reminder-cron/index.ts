// housing-reminder-cron — flags housing issues as recruiter_tasks
//
// Two checks per organization:
//   1. Properties whose `rental_contract_end_date` is within 90 days from today.
//   2. Units whose `current_occupancy` exceeds `capacity` (overbooking).
//   3. Active properties older than 90 days whose monthly cost fields are still empty.
//   4. Properties whose `indexation_date` falls within 14 days (punt 22 van de buglijst).
//
// Modes:
//   - **User mode** (default): caller is an active internal user, runs only for their org.
//   - **Cron mode**: triggered by pg_cron with `x-cron-secret` header, runs over all orgs.
//
// Idempotent: skips creating a task if an open recruiter_task with the same
// related_entity_id + category already exists.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalProfile } from "../_shared/auth.ts";
import { captureEdgeException, withCronMonitor } from "../_shared/sentry.ts";

const FN = "housing-reminder-cron";
// pg_cron leest de crontab in de Postgres-tijdzone, en die staat op productie op UTC.
// Sentry moet dus óók UTC krijgen (de helper default is Europe/Amsterdam) — anders staat
// de monitor 1-2 uur scheef en meldt Sentry runs als 'gemist' die gewoon gedraaid zijn.
const CRON_TZ = "UTC";

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
// Punt 22 — "melding 2 weken voordat de indexatie plaats zou moeten vinden".
const INDEXATION_WINDOW_DAYS = 14;
const CATEGORY_CONTRACT = "huisvesting_huurcontract";
const CATEGORY_INDEXATION = "huisvesting_indexatie";
const CATEGORY_OVERBOOKING = "huisvesting_overbezetting";
const CATEGORY_MISSING_COSTS = "huisvesting_kosten_ontbreken";

interface CheckResult {
  org_id: string;
  contract_tasks_created: number;
  indexation_tasks_created: number;
  overbooking_tasks_created: number;
  missing_cost_tasks_created: number;
  skipped_existing: number;
}

async function runForOrg(admin: any, orgId: string): Promise<CheckResult> {
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + REMINDER_WINDOW_DAYS);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  const indexationCutoff = new Date(today);
  indexationCutoff.setDate(indexationCutoff.getDate() + INDEXATION_WINDOW_DAYS);
  const indexationCutoffStr = indexationCutoff.toISOString().split("T")[0];

  let contractTasks = 0;
  let indexationTasks = 0;
  let overbookingTasks = 0;
  let missingCostTasks = 0;
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

  // 1b) Indexatiedatum binnen twee weken (punt 22)
  const { data: indexationProps } = await admin
    .from("properties")
    .select("id, name, address_street, address_city, indexation_date")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .not("indexation_date", "is", null)
    .lte("indexation_date", indexationCutoffStr);

  for (const p of (indexationProps ?? []) as any[]) {
    const { data: existing } = await admin
      .from("recruiter_tasks")
      .select("id")
      .eq("organization_id", orgId)
      .eq("related_entity_type", "property")
      .eq("related_entity_id", p.id)
      .eq("category", CATEGORY_INDEXATION)
      .eq("status", "open")
      .maybeSingle();
    if (existing) {
      skipped++;
      continue;
    }
    const label = p.name?.trim() || `${p.address_street}, ${p.address_city}`;
    await admin.from("recruiter_tasks").insert({
      organization_id: orgId,
      title: `Huurindexatie komt eraan: ${label}`,
      description: `De huur van pand "${label}" wordt geindexeerd op ${p.indexation_date}. Stem het nieuwe bedrag af met de eigenaar en pas daarna de maandlasten en de inhoudingen aan.`,
      category: CATEGORY_INDEXATION,
      priority: "medium",
      status: "open",
      related_entity_type: "property",
      related_entity_id: p.id,
      due_date: p.indexation_date,
      ai_generated: true,
      ai_reasoning: `Auto-gegenereerd door housing-reminder-cron (indexatie <= ${INDEXATION_WINDOW_DAYS} dagen).`,
    } as any);
    indexationTasks++;
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

  // 3) Properties without cost fields after the initial onboarding window.
  const costCutoff = new Date(today);
  costCutoff.setDate(costCutoff.getDate() - 90);
  const costCutoffIso = costCutoff.toISOString();

  const { data: missingCostProperties } = await admin
    .from("properties")
    .select("id, name, address_street, address_city, created_at, monthly_rent, cost_gas, cost_water, cost_electra, cost_municipal_tax, cost_other")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .lte("created_at", costCutoffIso)
    .is("monthly_rent", null)
    .is("cost_gas", null)
    .is("cost_water", null)
    .is("cost_electra", null)
    .is("cost_municipal_tax", null)
    .is("cost_other", null);

  for (const p of (missingCostProperties ?? []) as any[]) {
    const { data: existing } = await admin
      .from("recruiter_tasks")
      .select("id")
      .eq("organization_id", orgId)
      .eq("related_entity_type", "property")
      .eq("related_entity_id", p.id)
      .eq("category", CATEGORY_MISSING_COSTS)
      .eq("status", "open")
      .maybeSingle();
    if (existing) {
      skipped++;
      continue;
    }

    const label = p.name?.trim() || `${p.address_street}, ${p.address_city}`;
    await admin.from("recruiter_tasks").insert({
      organization_id: orgId,
      title: `Kosten aanvullen: ${label}`,
      description: `Pand "${label}" staat langer dan 90 dagen actief, maar de maandelijkse kostenvelden zijn nog leeg. Vul huur, gas, water, elektra en overige kosten aan.`,
      category: CATEGORY_MISSING_COSTS,
      priority: "medium",
      status: "open",
      related_entity_type: "property",
      related_entity_id: p.id,
      due_date: today.toISOString().split("T")[0],
      ai_generated: true,
      ai_reasoning: "Auto-gegenereerd door housing-reminder-cron (kostenvelden leeg na 90 dagen).",
    } as any);
    missingCostTasks++;
  }

  return {
    org_id: orgId,
    contract_tasks_created: contractTasks,
    indexation_tasks_created: indexationTasks,
    overbooking_tasks_created: overbookingTasks,
    missing_cost_tasks_created: missingCostTasks,
    skipped_existing: skipped,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Buiten de try zodat het catch-blok weet of withCronMonitor de fout al heeft gemeld.
  let reportedByMonitor = false;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const cronSecret = Deno.env.get("CRON_SECRET");
    const provided = req.headers.get("x-cron-secret");
    const isCron = !!cronSecret && provided === cronSecret;

    if (isCron) {
      // Cron mode: loop all active organizations. Alleen dit pad krijgt een check-in-monitor;
      // een handmatige aanroep uit de UI is geen geplande run.
      reportedByMonitor = true;
      return await withCronMonitor(
        {
          monitorSlug: "housing-reminder-daily",
          schedule: "30 2 * * *",
          timezone: CRON_TZ,
          maxRuntimeMinutes: 10,
          checkinMarginMinutes: 5,
          fn: FN,
        },
        async () => {
          const { data: orgs } = await admin
            .from("organizations")
            .select("id")
            .eq("is_active", true);
          const results: CheckResult[] = [];
          for (const o of (orgs ?? []) as any[]) {
            results.push(await runForOrg(admin, o.id));
          }
          return json({ mode: "cron", results });
        },
      );
    }

    // User mode: require auth + scope to user's org
    const auth = await requireInternalProfile(req, corsHeaders);
    if (auth instanceof Response) return auth;
    const result = await runForOrg(admin, auth.organizationId);
    return json({ mode: "user", result });
  } catch (err: any) {
    console.error("housing-reminder-cron error:", err);
    // withCronMonitor rapporteert de fouten van het werk dat het omhult al zelf.
    if (!reportedByMonitor) {
      await captureEdgeException(err, { fn: FN });
    }
    return json({ error: err.message ?? String(err) }, 500);
  }
});
