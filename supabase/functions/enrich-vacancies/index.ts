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
// dry_run = berekenen + sample zonder vacaturewijzigingen; echte AI-aanroepen worden wel afgerekend.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AiAccountingError } from "../_shared/ai-accounting.ts";
import { GEMINI_DEFAULT_MODEL } from "../_shared/gemini-cv.ts";
import { extractVacancySkills } from "../_shared/gemini-vacancy.ts";
import { internalFunctionHeaders, isServiceRoleRequest, requireRolePermission } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 50;
// Parallelle provider-aanroepen reserveren hun kosten vooraf atomair.
const CONCURRENCY = 4;
const SOFT_DEADLINE_MS = 70_000;

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
  stop_code?: string;
  http_status?: number;
  request_id?: string;
  cost_pending?: boolean;
}

interface Ctx {
  apiKey: string;
  model: string;
  catalogue: string[];
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

  let res;
  try {
    res = await extractVacancySkills(text, ctx.catalogue, ctx.apiKey, ctx.model, {
      admin, organizationId: v.organization_id, userId: ctx.userId, feature: "vacancy_skills", candidateId: null,
    });
  } catch (e) {
    const usage = e as Error & { costCents?: number; requestId?: string; providerAttempted?: boolean };
    const accountingError = e instanceof AiAccountingError;
    // Een saldo-/registratieblokkade beëindigt de keten; niet vanzelf opnieuw proberen.
    if (!accountingError) await mark();
    return {
      vacancy_id: v.id, status: "failed", reason: usage.message.slice(0, 200),
      stop: accountingError, stop_code: accountingError ? e.code : undefined,
      http_status: accountingError ? e.status : 502,
      cost_cents: usage.costCents, request_id: usage.requestId,
      cost_pending: usage.providerAttempted === true && usage.costCents === undefined,
    };
  }

  const costCents = res.costCents;
  const out: VacResult = {
    vacancy_id: v.id, status: "done", required_skills: res.requiredSkills,
    detected_certifications: res.requiredCertifications, requires_drivers_license: res.requiresDriversLicense,
    cost_cents: costCents, request_id: res.requestId,
  };
  if (ctx.dryRun) return out;

  // Schrijf alleen required_skills + de marker. requires_drivers_license alleen op true zetten
  // (nooit een handmatig gezette true terug naar false overschrijven). Certs NIET wegschrijven.
  const update: Record<string, unknown> = { required_skills: res.requiredSkills, skills_enriched_at: new Date().toISOString() };
  if (res.requiresDriversLicense) update.requires_drivers_license = true;
  const { error: updErr } = await admin.from("vacancies").update(update).eq("id", v.id).eq("organization_id", v.organization_id);
  if (updErr) return { ...out, status: "failed", reason: `db-update: ${updErr.message}`, stop: true, stop_code: "storage_failed", http_status: 500 };

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

// Bouwt de verwerkingscontext (Gemini-key, org-skill-catalogus en model) voor één org.
async function buildCtx(admin: Admin, orgId: string, body: any, userId: string | null, dryRun: boolean): Promise<{ ctx: Ctx } | { error: string; status: number }> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) return { error: "GEMINI_API_KEY ontbreekt", status: 500 };
  const { data: orgSkills } = await admin.from("skills").select("name").eq("organization_id", orgId).eq("is_active", true).order("name");
  const catalogue = (orgSkills ?? []).map((s: { name: string }) => s.name).filter(Boolean);
  if (catalogue.length === 0) return { error: "Geen skills-catalogus voor deze organisatie", status: 400 };
  const model = (typeof body.model === "string" && body.model) || Deno.env.get("GEMINI_MODEL") || GEMINI_DEFAULT_MODEL;
  return { ctx: { apiKey: GEMINI_API_KEY, model, catalogue, userId, dryRun } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    if (body.max_vacancies !== undefined && (!Number.isInteger(body.max_vacancies) || body.max_vacancies < 0)) {
      return json({ error: "max_vacancies moet een geheel getal van 0 of hoger zijn" }, 400);
    }
    const maxVacancies = body.max_vacancies ?? 0;
    const batchSize = Math.min(Math.max(1, Number(body.batch_size) || DEFAULT_BATCH_SIZE), MAX_BATCH_SIZE);

    // ── Enkele vacature (bij opslaan / handmatige knop) ──────────────────────
    // Verrijkt precies één vacature, ongeacht de skills_enriched_at-marker. Auth via RLS:
    // een ingelogde user mag alleen vacatures van de eigen org lezen → impliciete autorisatie
    // (elke rol, niet alleen admin — intercedenten maken ook vacatures aan).
    const singleVacancyId = typeof body.vacancy_id === "string" ? body.vacancy_id : null;
    if (singleVacancyId) {
      let vac: VacRow | null = null;
      let uid: string | null = null;
      if (isServiceRoleRequest(req)) {
        const { data } = await admin.from("vacancies").select("id, organization_id, title, description").eq("id", singleVacancyId).maybeSingle();
        vac = data as VacRow | null;
      } else {
        const auth = await requireRolePermission(req, "vacancies.edit", corsHeaders);
        if (auth instanceof Response) return auth;
        uid = auth.userId;
        const { data } = await admin.from("vacancies")
          .select("id, organization_id, title, description")
          .eq("id", singleVacancyId)
          .eq("organization_id", auth.organizationId)
          .maybeSingle();
        vac = data as VacRow | null;
      }
      if (!vac) return json({ error: "Vacature niet gevonden of geen toegang" }, 404);
      const built = await buildCtx(admin, vac.organization_id, body, uid, dryRun);
      if ("error" in built) return json({ error: built.error }, built.status);
      const result = await processVacancy(admin, vac, built.ctx);
      return json({ success: result.status !== "failed", single: true, result }, result.http_status ?? 200);
    }

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
      const { data: profile } = await admin.from("profiles")
        .select("organization_id, role, is_active")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.is_active === false) return json({ error: "Account is uitgeschakeld" }, 403);
      const { data: isSuper } = await userClient.rpc("is_superadmin");
      if (isSuper) {
        if (!orgId) return json({ error: "organization_id verplicht voor superadmin" }, 400);
      } else {
        if (!profile || profile.is_active !== true || profile.role !== "admin") return json({ error: "Alleen admins of superadmins" }, 403);
        orgId = profile.organization_id;
      }
    }
    if (!orgId) return json({ error: "organization_id onbekend" }, 400);

    const built = await buildCtx(admin, orgId, body, userId, dryRun);
    if ("error" in built) return json({ error: built.error }, built.status);
    const ctx = built.ctx;
    const model = ctx.model;

    const started = Date.now();
    let done = 0, skipped = 0, failed = 0, costTotal = 0, pendingCosts = 0, stopped = false;
    let stopCode: string | undefined;
    const sample: VacResult[] = [];

    while (!stopped) {
      if (!dryRun && Date.now() - started > SOFT_DEADLINE_MS) {
        if (maxVacancies > 0) { stopped = true; stopCode = "deadline"; break; }
        const maybe = scheduleSelfTrigger(orgId, model);
        if (maybe) await maybe;
        return json({ success: true, continued: true, done, skipped, failed, cost_cents: costTotal, costs_pending: pendingCosts, sample: sample.slice(0, 25) });
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
        return json({ success: true, done_all: true, done, skipped, failed, cost_cents: costTotal, costs_pending: pendingCosts, sample: sample.slice(0, 25) });
      }

      const rows = vacs as VacRow[];
      for (let i = 0; i < rows.length; i += CONCURRENCY) {
        const remaining = maxVacancies > 0 ? maxVacancies - done - skipped - failed : CONCURRENCY;
        const chunk = rows.slice(i, i + Math.min(CONCURRENCY, remaining));
        const settled = await Promise.all(chunk.map((v) => processVacancy(admin, v, ctx)));
        for (const r of settled) {
          costTotal += r.cost_cents ?? 0;
          if (r.cost_pending) pendingCosts++;
          if (r.status === "done") done++;
          else if (r.status === "skipped") skipped++;
          else failed++;
          if (sample.length < 25) sample.push(r);
          if (r.stop) { stopped = true; stopCode ??= r.stop_code; }
        }
        if (maxVacancies && (done + skipped + failed) >= maxVacancies) stopped = true;
        if (stopped) break;
        if (!dryRun && Date.now() - started > SOFT_DEADLINE_MS) break; // mid-batch deadline → buitenste while self-triggert; onverwerkte rijen blijven NULL → opnieuw geselecteerd
      }

      if (dryRun) {
        return json({ success: true, dry_run: true, stopped_reason: stopCode, done, skipped, failed, cost_cents: costTotal, costs_pending: pendingCosts, sample: sample.slice(0, 25) });
      }
      // niet-dry: loop opnieuw; volgende fetch pakt de eerstvolgende niet-verrijkte vacatures.
    }

    const reachedMax = maxVacancies > 0 && (done + skipped + failed) >= maxVacancies;
    return json({
      success: true, stopped_reason: stopCode ?? (reachedMax ? "max_vacancies bereikt" : "saldo onvoldoende"),
      done, skipped, failed, cost_cents: costTotal, costs_pending: pendingCosts, sample: sample.slice(0, 25),
    });
  } catch (e) {
    console.error("[enrich-vacancies] fatal:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
