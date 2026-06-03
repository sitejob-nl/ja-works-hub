// Vacature-skill-verrijking (batch).
//
// Leest per OPEN vacature de titel + description en kent met Gemini required_skills toe
// (UITSLUITEND uit de org-catalogus, zodat ze 1-op-1 matchen met candidate.skills in
// calculate-match), plus requires_drivers_license. Certificaten worden wel gedetecteerd
// en in de sample getoond, maar NIET weggeschreven — required_certifications is in
// calculate-match een harde blokker en een over-specifieke/ongevalideerde certstring zou
// geschikte kandidaten onterecht uitsluiten (review-finding). Die laten we aan recruiters.
//
// Convergentie/idempotentie: STATUS-CURSOR i.p.v. offset (zoals analyze-cv-batch). We
// filteren op skills_enriched_at IS NULL en zetten die marker bij ELKE terminale uitkomst
// (done/skipped/failed), zodat verwerkte vacatures uit de selectie vallen — ook bij []
// skills, een mid-batch deadline-break of een self-trigger-keten. Saldo-stop markeert NIET
// (zodat na bijladen verder gegaan kan worden).
//
// Auth: org-admin (eigen org), superadmin (org via body) of service-role (self-trigger).
// dry_run = berekenen + sample, niets wegschrijven/markeren.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { calculateCostCents } from "../_shared/anthropic-cv.ts";
import { GEMINI_DEFAULT_MODEL, geminiPricingForModel } from "../_shared/gemini-cv.ts";
import { extractVacancySkills } from "../_shared/gemini-vacancy.ts";
import { internalFunctionHeaders, isServiceRoleRequest } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 50;
// Lichte concurrency. De preflight-saldocheck is per vacature (niet over de chunk), dus op
// de saldo-rand kunnen tot CONCURRENCY-1 betaalde Gemini-calls plaatsvinden zonder dat er
// krediet voor wordt afgeschreven. consume_ai_credits is race-safe (FOR UPDATE) → geen
// overdraft; de marge van enkele centen is bewust geaccepteerd (idem analyze-cv-batch).
const CONCURRENCY = 4;
const SOFT_DEADLINE_MS = 70_000;
const PREFLIGHT_RESERVATION_CENTS = 5;

// deno-lint-ignore no-explicit-any
type Admin = any;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

interface VacRow {
  id: string;
  organization_id: string;
  title: string | null;
  description: string | null;
}

interface VacResult {
  vacancy_id: string;
  status: "done" | "skipped" | "failed";
  required_skills?: string[];
  detected_certifications?: string[];
  requires_drivers_license?: boolean;
  reason?: string;
  cost_cents?: number;
  stop?: boolean;
}

interface Ctx {
  apiKey: string;
  model: string;
  catalogue: string[];
  pricingIn: number;
  pricingOut: number;
  userId: string | null;
  dryRun: boolean;
}

async function processVacancy(admin: Admin, v: VacRow, ctx: Ctx): Promise<VacResult> {
  // Zet de "verwerkt"-marker (+ optionele extra velden). No-op in dry-run.
  const mark = async (extra: Record<string, unknown> = {}) => {
    if (ctx.dryRun) return;
    await admin.from("vacancies")
      .update({ skills_enriched_at: new Date().toISOString(), ...extra })
      .eq("id", v.id).eq("organization_id", v.organization_id);
  };

  // Carerix-vacatures hebben vaak een lege description maar een sprekende titel
  // ("TIG Lasser RVS"). Titel alleen is voor blue-collar genoeg om skills af te leiden.
  const text = [v.title, v.description].filter(Boolean).join("\n\n").trim();
  if (text.length < 5) {
    await mark(); // markeer: niet opnieuw proberen
    return { vacancy_id: v.id, status: "skipped", reason: "geen bruikbare vacaturetekst (titel leeg)" };
  }

  if (!ctx.dryRun) {
    const { data: credits } = await admin.from("organization_credits").select("balance_cents").eq("organization_id", v.organization_id).single();
    if ((credits?.balance_cents ?? 0) < PREFLIGHT_RESERVATION_CENTS) {
      return { vacancy_id: v.id, status: "failed", reason: "saldo onvoldoende", stop: true }; // NIET marken → retry na bijladen
    }
  }

  let res;
  try {
    res = await extractVacancySkills(text, ctx.catalogue, ctx.apiKey, ctx.model);
  } catch (e) {
    await mark(); // markeer mislukte zodat de keten niet blijft hangen; reset om te retryen
    return { vacancy_id: v.id, status: "failed", reason: (e as Error).message.slice(0, 200) };
  }

  const costCents = calculateCostCents(res.inputTokens, res.outputTokens, ctx.pricingIn, ctx.pricingOut);
  const out: VacResult = {
    vacancy_id: v.id, status: "done", required_skills: res.requiredSkills,
    detected_certifications: res.requiredCertifications, requires_drivers_license: res.requiresDriversLicense,
    cost_cents: costCents,
  };
  if (ctx.dryRun) return out;

  const { data: consumeResult, error: consumeErr } = await admin.rpc("consume_ai_credits", {
    p_org_id: v.organization_id, p_amount_cents: costCents,
  });
  if (consumeErr) { await mark(); return { vacancy_id: v.id, status: "failed", reason: `credits: ${consumeErr.message}` }; }
  const consume = Array.isArray(consumeResult) ? consumeResult[0] : consumeResult;
  if (!consume?.ok) return { vacancy_id: v.id, status: "failed", reason: "saldo onvoldoende tijdens afschrijving", stop: true }; // NIET marken

  // Schrijf alleen required_skills + de marker. requires_drivers_license alleen op true zetten
  // (nooit een handmatig gezette true terug naar false overschrijven). Certs NIET wegschrijven.
  const update: Record<string, unknown> = { required_skills: res.requiredSkills, skills_enriched_at: new Date().toISOString() };
  if (res.requiresDriversLicense) update.requires_drivers_license = true;
  const { error: updErr } = await admin.from("vacancies").update(update).eq("id", v.id).eq("organization_id", v.organization_id);
  if (updErr) return { vacancy_id: v.id, status: "failed", reason: `db-update: ${updErr.message}` };

  try {
    await admin.from("ai_usage_log").insert({
      feature: "vacancy_skills", organization_id: v.organization_id, user_id: ctx.userId,
      provider: "gemini", model: res.model, input_tokens: res.inputTokens, output_tokens: res.outputTokens,
      cost_cents: costCents, candidate_id: null, duration_ms: res.durationMs,
    });
  } catch (_e) { /* usage-log mag de flow niet breken */ }

  return out;
}

async function selfTrigger(orgId: string, model: string): Promise<void> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/enrich-vacancies`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, ...internalFunctionHeaders() },
    body: JSON.stringify({ organization_id: orgId, model }),
  });
  if (!res.ok) throw new Error(`enrich-vacancies self-trigger failed (${res.status})`);
}

function scheduleSelfTrigger(orgId: string, model: string): Promise<void> | void {
  const trigger = selfTrigger(orgId, model).catch((e: unknown) => console.error("[enrich-vacancies] self-trigger faalde:", e));
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er?.waitUntil) { er.waitUntil(trigger); return; }
  return trigger;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const maxVacancies = Math.max(0, Number(body.max_vacancies) || 0);
    const batchSize = Math.min(Math.max(1, Number(body.batch_size) || DEFAULT_BATCH_SIZE), MAX_BATCH_SIZE);

    // --- Auth ---
    let orgId: string | null = body.organization_id || null;
    let userId: string | null = null;
    if (isServiceRoleRequest(req)) {
      if (!orgId) return json({ error: "organization_id verplicht voor interne jobs" }, 400);
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ error: "Niet geautoriseerd" }, 401);
      const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error: authErr } = await userClient.auth.getUser();
      if (authErr || !user) return json({ error: "Ongeldige sessie" }, 401);
      userId = user.id;
      const { data: isSuper } = await userClient.rpc("is_superadmin");
      if (isSuper) {
        if (!orgId) return json({ error: "organization_id verplicht voor superadmin" }, 400);
      } else {
        const { data: profile } = await admin.from("profiles").select("organization_id, role").eq("id", user.id).single();
        if (!profile || profile.role !== "admin") return json({ error: "Alleen admins of superadmins" }, 403);
        orgId = profile.organization_id;
      }
    }
    if (!orgId) return json({ error: "organization_id onbekend" }, 400);

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) return json({ error: "GEMINI_API_KEY ontbreekt" }, 500);

    const { data: orgSkills } = await admin.from("skills").select("name").eq("organization_id", orgId).eq("is_active", true).order("name");
    const catalogue = (orgSkills ?? []).map((s: { name: string }) => s.name).filter(Boolean);
    if (catalogue.length === 0) return json({ error: "Geen skills-catalogus voor deze organisatie" }, 400);

    const model = (typeof body.model === "string" && body.model) || Deno.env.get("GEMINI_MODEL") || GEMINI_DEFAULT_MODEL;
    const gp = geminiPricingForModel(model);
    const ctx: Ctx = { apiKey: GEMINI_API_KEY, model, catalogue, pricingIn: gp.inputCentsPerMtok, pricingOut: gp.outputCentsPerMtok, userId, dryRun };

    const started = Date.now();
    let done = 0, skipped = 0, failed = 0, costTotal = 0, stopped = false;
    const sample: VacResult[] = [];

    while (!stopped) {
      if (!dryRun && Date.now() - started > SOFT_DEADLINE_MS) {
        const maybe = scheduleSelfTrigger(orgId, model);
        if (maybe) await maybe;
        return json({ success: true, continued: true, done, skipped, failed, cost_cents: costTotal, sample: sample.slice(0, 25) });
      }

      // STATUS-CURSOR: open vacatures met description die nog niet verrijkt zijn. Verwerkte
      // krijgen skills_enriched_at en vallen vanzelf uit deze selectie → convergeert.
      const { data: vacs, error: selErr } = await admin
        .from("vacancies")
        .select("id, organization_id, title, description")
        .eq("organization_id", orgId)
        .eq("status", "open")
        .not("title", "is", null)
        .is("skills_enriched_at", null)
        .order("created_at", { ascending: true })
        .limit(batchSize);
      if (selErr) return json({ error: selErr.message }, 500);
      if (!vacs || vacs.length === 0) {
        return json({ success: true, done_all: true, done, skipped, failed, cost_cents: costTotal, sample: sample.slice(0, 25) });
      }

      const rows = vacs as VacRow[];
      for (let i = 0; i < rows.length; i += CONCURRENCY) {
        const chunk = rows.slice(i, i + CONCURRENCY);
        const settled = await Promise.all(chunk.map((v) => processVacancy(admin, v, ctx)));
        for (const r of settled) {
          if (r.status === "done") { done++; costTotal += r.cost_cents ?? 0; }
          else if (r.status === "skipped") skipped++;
          else failed++;
          if (sample.length < 25) sample.push(r);
          if (r.stop) stopped = true;
        }
        if (maxVacancies && (done + skipped + failed) >= maxVacancies) stopped = true;
        if (stopped) break;
        if (!dryRun && Date.now() - started > SOFT_DEADLINE_MS) break; // mid-batch deadline → buitenste while self-triggert; onverwerkte rijen blijven NULL → opnieuw geselecteerd
      }

      if (dryRun) {
        return json({ success: true, dry_run: true, done, skipped, failed, cost_cents: costTotal, sample: sample.slice(0, 25) });
      }
      // niet-dry: loop opnieuw; volgende fetch pakt de eerstvolgende niet-verrijkte vacatures.
    }

    const reachedMax = maxVacancies > 0 && (done + skipped + failed) >= maxVacancies;
    return json({
      success: true, stopped_reason: reachedMax ? "max_vacancies bereikt" : "saldo onvoldoende",
      done, skipped, failed, cost_cents: costTotal, sample: sample.slice(0, 25),
    });
  } catch (e) {
    console.error("[enrich-vacancies] fatal:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
